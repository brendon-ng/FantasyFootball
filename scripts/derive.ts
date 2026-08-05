/**
 * Turns raw Sleeper dumps in `data/raw/` into the shapes the site renders,
 * writing them to `data/derived/`. Run with `npm run derive` (or `npm run data`).
 *
 * Pure transformation: this script makes no network calls and never touches
 * `data/raw/`. Delete `data/derived/` and re-run to rebuild it from scratch.
 *
 * The keeper resolver is the interesting part — see `resolveKeepers` below.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type {
  BracketMatch,
  CombinedRecord,
  DraftPickRecord,
  KeeperContract,
  LeagueRecords,
  Matchup,
  MatchupSide,
  Owner,
  OwnerRecord,
  PlayerScoreRecord,
  PlayerTransaction,
  ScoreRecord,
  SeasonKeepers,
  SeasonSummary,
  StandingsRow,
  WeeklyLow,
} from "../lib/types.ts";
import { byAllTimeRank } from "../lib/ranking.ts";
import type {
  SleeperBracketMatch,
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
} from "../lib/sleeper.ts";
import { ROOT, log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues, type ScriptLeague } from "./lib/league.ts";

// Set per league by deriveLeague(); every helper below reads these. Definite
// assignment because nothing runs outside a league pass.
let CONFIG_DIR!: string;
let DATA_DIR!: string;
let RAW_DIR!: string;
let DERIVED_DIR!: string;

interface OwnerConfig {
  slug: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  active: boolean;
  espnNames?: string[];
}
interface LeagueConfig {
  leagueName: string;
  shortName: string;
  owners: OwnerConfig[];
}
interface Rules {
  season: number;
  regularSeasonWeeks: number;
  playoffWeekStart: number;
  playoffTeams: number;
  finalWeek: number;
  draftRounds: number;
  keepers: {
    enabled: boolean;
    maxKeepers: number;
    maxKeepsAtOriginalCost: number;
    undraftedFreeAgentRound: number;
    reAcquiredValueRule: string;
    selfReclaimResetsContract: boolean;
    tradeInheritsContract: boolean;
  };
}
interface SeasonIndex {
  seasons: Array<{
    season: string;
    leagueId: string;
    status: string;
    finalized: boolean;
    finalizedThroughWeek: number;
  }>;
}

let config!: LeagueConfig;
let index!: SeasonIndex;

/**
 * Manual corrections, see config/keeper-overrides.json.
 *
 * Placeholder picks are applied at LOAD time rather than patched afterwards: a
 * stand-in player drafted into a keeper's slot is a defect in the source
 * record, so correcting the record leaves every downstream consumer — resolver,
 * draft history, player pages — with nothing to special-case.
 */
interface PlaceholderPick {
  season: number;
  pickNo: number;
  placeholderPlayerId: string;
  actualPlayerId: string;
  note?: string;
}
interface Overrides {
  placeholderPicks?: PlaceholderPick[];
  ignorePlayerIds?: string[];
  contracts?: Record<string, Partial<KeeperContract>>;
}
let overrides: Overrides = {};
let ignoredPlayers = new Set<string>();

/**
 * A season's rules, inheriting the previous year's when it has none of its own.
 *
 * Most years nothing changes, and requiring a hand-written file for each one made
 * a new season a manual chore that BREAKS THE BUILD when forgotten — a bad
 * failure for something that happens while nobody is looking, on a schedule.
 * Carrying the last file forward is what the league actually does.
 *
 * Only ever inherits FORWARD, and only for a season with no file. History stays
 * immutable: a past season keeps whatever its own file said, and changing next
 * year's rules is still just writing `rules/<year>.json`.
 *
 * Throws when there is nothing to inherit from — a season older than every rules
 * file is a genuine gap, not a new year.
 */
const rulesCache = new Map<number, Rules>();

function rulesFor(season: number): Rules {
  const hit = rulesCache.get(season);
  if (hit) return hit;

  const own = readJson<Rules>(join(CONFIG_DIR, "rules", `${season}.json`));
  if (own) {
    rulesCache.set(season, own);
    return own;
  }

  const dir = join(CONFIG_DIR, "rules");
  const years = (existsSync(dir) ? readdirSync(dir) : [])
    .map((f) => Number(f.replace(".json", "")))
    .filter((y) => Number.isFinite(y) && y < season)
    .sort((a, b) => b - a);

  if (!years.length) {
    throw new Error(
      `No rules file for ${season} and nothing earlier to inherit — add ${CONFIG_DIR}/rules/${season}.json`,
    );
  }

  const inheritedFrom = years[0];
  const inherited = readJson<Rules>(join(dir, `${inheritedFrom}.json`))!;
  log.info(
    `${season}: no rules file — inheriting ${inheritedFrom}'s (write rules/${season}.json to change them)`,
  );
  const rules = { ...inherited, season };
  rulesCache.set(season, rules);
  return rules;
}

// --- owner identity ---------------------------------------------------------

/**
 * EVERY PERSON IS A FIRST-CLASS OWNER, co-owners included.
 *
 * A co-owned team's record is credited to each of its owners, so Maddy is
 * credited for Jake's seasons and Katie for Jaymie's. The consequence is that
 * summing all-time wins across owners double-counts co-owned seasons; these are
 * personal records, not a league ledger, and the UI says so.
 */
const slugByUserId = new Map<string, string>();
const owners = new Map<string, Owner>();

/** Rebuilds the owner registry for the league currently being derived. */
function loadOwners(): void {
  slugByUserId.clear();
  owners.clear();
  for (const o of config.owners) {
    owners.set(o.slug!, {
      slug: o.slug!,
      name: `${o.firstName} ${o.lastName}`,
      firstName: o.firstName,
      userId: o.userId,
      active: o.active,
      seasons: [],
      coOwnedWith: [],
    });
    if (o.userId) slugByUserId.set(o.userId, o.slug!);
  }
}

// --- per-season loading -----------------------------------------------------

interface SeasonData {
  season: number;
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  draft: SleeperDraft | null;
  picks: SleeperDraftPick[];
  winners: SleeperBracketMatch[];
  losers: SleeperBracketMatch[];
  matchups: Map<number, SleeperMatchup[]>;
  transactions: Map<number, SleeperTransaction[]>;
  /** roster_id -> primary owner slug (franchise key). */
  rosterToOwner: Map<number, string>;
  /** roster_id -> every owner credited, primary first. */
  rosterToOwners: Map<number, string[]>;
  rules: Rules;
}

function loadSeason(season: number): SeasonData | null {
  const dir = join(RAW_DIR, String(season));
  const league = readJson<SleeperLeague>(join(dir, "league.json"));
  if (!league) return null;

  const rosters = readJson<SleeperRoster[]>(join(dir, "rosters.json")) ?? [];
  const rosterToOwner = new Map<number, string>();
  const rosterToOwners = new Map<number, string[]>();
  for (const r of rosters) {
    const slug = r.owner_id ? slugByUserId.get(r.owner_id) : undefined;
    if (!slug) {
      throw new Error(
        `${season}: roster ${r.roster_id} has owner_id ${r.owner_id}, which is not in config/league.json. Add them.`,
      );
    }
    rosterToOwner.set(r.roster_id, slug);
    // Sleeper lists co-owners separately from the primary owner_id.
    const co = (r.co_owners ?? [])
      .map((id) => slugByUserId.get(id))
      .filter((x): x is string => Boolean(x));
    rosterToOwners.set(r.roster_id, [...new Set([slug, ...co])]);
  }

  const matchups = new Map<number, SleeperMatchup[]>();
  const transactions = new Map<number, SleeperTransaction[]>();
  for (const kind of ["matchups", "transactions"] as const) {
    const sub = join(dir, kind);
    if (!existsSync(sub)) continue;
    for (const f of readdirSync(sub).sort()) {
      const week = Number(f.replace(".json", ""));
      const body = readJson<unknown[]>(join(sub, f)) ?? [];
      if (kind === "matchups") matchups.set(week, body as SleeperMatchup[]);
      else transactions.set(week, body as SleeperTransaction[]);
    }
  }

  // Swap any placeholder pick for the keeper it stood in for.
  const rawPicks = readJson<SleeperDraftPick[]>(join(dir, "draft-picks.json")) ?? [];
  const picks = rawPicks.map((p) => {
    const sub = (overrides.placeholderPicks ?? []).find(
      (x) =>
        x.season === season &&
        x.pickNo === p.pick_no &&
        String(x.placeholderPlayerId) === String(p.player_id),
    );
    if (!sub) return p;
    log.info(
      `${season}: pick ${p.pick_no} — substituting ${sub.actualPlayerId} for placeholder ${sub.placeholderPlayerId}, flagged as a keeper`,
    );
    return { ...p, player_id: sub.actualPlayerId, is_keeper: true };
  });

  return {
    season,
    league,
    users: readJson<SleeperUser[]>(join(dir, "users.json")) ?? [],
    rosters,
    draft: readJson<SleeperDraft>(join(dir, "draft.json")),
    picks,
    winners: readJson<SleeperBracketMatch[]>(join(dir, "winners-bracket.json")) ?? [],
    losers: readJson<SleeperBracketMatch[]>(join(dir, "losers-bracket.json")) ?? [],
    matchups,
    transactions,
    rosterToOwner,
    rosterToOwners,
    rules: rulesFor(season),
  };
}

/** Sleeper splits scores: fpts 1617 + fpts_decimal 78 means 1617.78. */
const pts = (whole: number | undefined, dec: number | undefined): number =>
  Number(((whole ?? 0) + (dec ?? 0) / 100).toFixed(2));

const round2 = (n: number): number => Number(n.toFixed(2));

// --- standings & brackets ---------------------------------------------------

/**
 * Converts a Sleeper bracket into owner-slug terms and works out which overall
 * placement each match decides.
 *
 * THE TOILET BOWL IS AN ANTI-TOURNAMENT and Sleeper encodes it confusingly.
 * `w` always means "the team that advances", but in the losers bracket the team
 * that advances is the one that LOST the game — you play your way down to last
 * place, not up. Verified against 2024 match 1: Sleeper reports `w: 2`
 * (davidrcollier, 109.66) over brendonn8 (110.56); the lower scorer advanced.
 *
 * Placement therefore counts in opposite directions:
 *
 *   Winners bracket   p:1 -> [1st, 2nd]     w takes the better place
 *   Losers bracket    p:1 -> [10th, 9th]    w takes the WORSE place
 *                     p:3 -> [8th,  7th]
 *
 * So for the losers bracket, winner = totalTeams - p + 1 and loser one better.
 * Getting this backwards silently swaps the champion of the toilet bowl with
 * the team that escaped it.
 */
function buildBracket(
  raw: SleeperBracketMatch[],
  rosterToOwner: Map<number, string>,
  opts: {
    inverted: boolean;
    totalTeams: number;
    playoffWeekStart: number;
    pointsByWeek: Map<number, Map<string, number>>;
  },
): BracketMatch[] {
  const slug = (rid: number | null | undefined) =>
    rid == null ? null : (rosterToOwner.get(rid) ?? null);

  return raw
    .slice()
    .sort((a, b) => a.r - b.r || a.m - b.m)
    .map((m) => {
      // Bracket round N is played in playoff week N. Both brackets start in the
      // same week; the toilet bowl simply finishes a week earlier.
      const week = opts.playoffWeekStart + m.r - 1;
      const t1 = slug(m.t1);
      const t2 = slug(m.t2);

      const points: Record<string, number> = {};
      const weekPoints = opts.pointsByWeek.get(week);
      for (const t of [t1, t2]) {
        if (t && weekPoints?.has(t)) points[t] = weekPoints.get(t)!;
      }

      const placesFor: [number, number] | null =
        m.p == null
          ? null
          : opts.inverted
            ? [opts.totalTeams - m.p + 1, opts.totalTeams - m.p]
            : [m.p, m.p + 1];

      return {
        round: m.r,
        matchId: m.m,
        week,
        team1: t1,
        team2: t2,
        winner: slug(m.w),
        loser: slug(m.l),
        team1From: m.t1_from ? { winnerOf: m.t1_from.w, loserOf: m.t1_from.l } : null,
        team2From: m.t2_from ? { winnerOf: m.t2_from.w, loserOf: m.t2_from.l } : null,
        placesFor,
        points,
        inverted: opts.inverted,
      };
    });
}

function summariseSeason(d: SeasonData, finalizedThroughWeek: number): SeasonSummary {
  const teamNameByUser = new Map(
    d.users.map((u) => [u.user_id, u.metadata?.team_name ?? u.display_name]),
  );

  // Seeding: wins first, then total points for (bylaws 1.8.2.4).
  const ordered = d.rosters.slice().sort((a, b) => {
    const aw = a.settings.wins - b.settings.wins;
    if (aw !== 0) return -aw;
    return (
      pts(b.settings.fpts, b.settings.fpts_decimal) -
      pts(a.settings.fpts, a.settings.fpts_decimal)
    );
  });

  // Per-week scores, so the bracket can render real numbers like Sleeper does.
  const pointsByWeek = new Map<number, Map<string, number>>();
  for (const [week, rows] of d.matchups) {
    const byOwner = new Map<string, number>();
    for (const r of rows) {
      const slug = d.rosterToOwner.get(r.roster_id);
      if (slug) byOwner.set(slug, round2(r.custom_points ?? r.points ?? 0));
    }
    pointsByWeek.set(week, byOwner);
  }

  const bracketOpts = {
    totalTeams: d.rosters.length,
    playoffWeekStart: d.rules.playoffWeekStart,
    pointsByWeek,
  };
  const winners = buildBracket(d.winners, d.rosterToOwner, { ...bracketOpts, inverted: false });
  const losers = buildBracket(d.losers, d.rosterToOwner, { ...bracketOpts, inverted: true });

  // Final placement comes from whichever match declared it.
  const placeByOwner = new Map<string, number>();
  for (const m of [...winners, ...losers]) {
    if (!m.placesFor) continue;
    const [winPlace, losePlace] = m.placesFor;
    if (m.winner) placeByOwner.set(m.winner, winPlace);
    if (m.loser) placeByOwner.set(m.loser, losePlace);
  }

  const standings: StandingsRow[] = ordered.map((r, i) => {
    const slug = d.rosterToOwner.get(r.roster_id)!;
    return {
      ownerSlug: slug,
      ownerSlugs: d.rosterToOwners.get(r.roster_id) ?? [slug],
      rosterId: r.roster_id,
      teamName: r.owner_id ? (teamNameByUser.get(r.owner_id) ?? null) : null,
      seed: i + 1,
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
      pointsFor: pts(r.settings.fpts, r.settings.fpts_decimal),
      pointsAgainst: pts(r.settings.fpts_against, r.settings.fpts_against_decimal),
      finalPlace: placeByOwner.get(slug) ?? null,
      madePlayoffs: i + 1 <= d.rules.playoffTeams,
    };
  });

  const at = (place: number) => standings.find((s) => s.finalPlace === place)?.ownerSlug ?? null;

  return {
    season: d.season,
    leagueId: d.league.league_id,
    leagueName: d.league.name,
    status: d.league.status,
    finalized: d.league.status === "complete",
    imported: false,
    teams: d.rosters.length,
    regularSeasonWeeks: d.rules.regularSeasonWeeks,
    finalizedThroughWeek,
    // Bench slots are not part of the starting lineup ordering.
    rosterPositions: (d.league.roster_positions ?? []).filter((x) => x !== "BN"),
    standings,
    winnersBracket: winners,
    losersBracket: losers,
    extraBrackets: [],
    ladderConsolation: false,
    champion: at(1),
    runnerUp: at(2),
    thirdPlace: at(3),
    lastPlace: at(d.rosters.length),
  };
}

// --- matchups ---------------------------------------------------------------

/**
 * The lowest-scoring team of each regular-season week.
 *
 * Regular season only, because a postseason week is not every team playing — the
 * "lowest of the week" in a six-team playoff field would be compared against a
 * twelve-team regular-season field and mean nothing.
 *
 * Computed for EVERY league even though only some attach a punishment to it: the
 * low scorer is a fact, and `features.weeklyLowPunishment` only decides whether
 * the UI says anything about it. That keeps enabling the rule a config change.
 *
 * A tie produces one row per tied team, since a shared low is shared.
 */
function buildWeeklyLows(matchups: Matchup[], summaries: SeasonSummary[]): WeeklyLow[] {
  const regularWeeks = new Map(summaries.map((s) => [s.season, s.regularSeasonWeeks]));
  const byWeek = new Map<string, Array<{ ownerSlug: string; points: number }>>();

  for (const m of matchups) {
    if (m.kind !== "regular") continue;
    if (m.week > (regularWeeks.get(m.season) ?? 0)) continue;
    const key = `${m.season}:${m.week}`;
    const list = byWeek.get(key) ?? [];
    for (const side of [m.home, m.away]) {
      if (side.ownerSlug) list.push({ ownerSlug: side.ownerSlug, points: side.points });
    }
    byWeek.set(key, list);
  }

  const out: WeeklyLow[] = [];
  for (const [key, teams] of byWeek) {
    if (!teams.length) continue;
    const [season, week] = key.split(":").map(Number);
    const low = Math.min(...teams.map((t) => t.points));
    for (const t of teams.filter((t) => t.points === low)) {
      out.push({ season, week, ownerSlug: t.ownerSlug, points: t.points });
    }
  }
  return out.sort((a, b) => a.season - b.season || a.week - b.week || a.ownerSlug.localeCompare(b.ownerSlug));
}

function buildMatchups(d: SeasonData, throughWeek: number): Matchup[] {
  const out: Matchup[] = [];

  for (const [week, rows] of [...d.matchups].sort((a, b) => a[0] - b[0])) {
    if (week > throughWeek) continue;

    // Playoff weeks pair teams via the bracket, but Sleeper still emits
    // matchup_id groupings, so the same pairing logic works throughout.
    const byMatchup = new Map<number, SleeperMatchup[]>();
    for (const r of rows) {
      if (r.matchup_id == null) continue;
      const list = byMatchup.get(r.matchup_id) ?? [];
      list.push(r);
      byMatchup.set(r.matchup_id, list);
    }

    const playoffTeams = new Set(
      [...d.winners.flatMap((m) => [m.t1, m.t2, m.w, m.l])].filter(
        (x): x is number => x != null,
      ),
    );

    for (const [matchupId, pair] of byMatchup) {
      if (pair.length !== 2) continue;
      const side = (m: SleeperMatchup): MatchupSide => ({
        ownerSlug: d.rosterToOwner.get(m.roster_id)!,
        // custom_points is a commissioner override and wins when present.
        points: round2(m.custom_points ?? m.points ?? 0),
        starters: m.starters ?? [],
        playerPoints: m.players_points ?? {},
      });
      const [a, b] = [side(pair[0]), side(pair[1])];

      const isPlayoffWeek = week >= d.rules.playoffWeekStart;
      const kind: Matchup["kind"] = !isPlayoffWeek
        ? "regular"
        : playoffTeams.has(pair[0].roster_id)
          ? "playoff"
          : "consolation";

      out.push({
        season: d.season,
        week,
        kind,
        matchupId,
        home: a,
        away: b,
        winner: a.points === b.points ? null : a.points > b.points ? a.ownerSlug : b.ownerSlug,
      });
    }
  }
  return out;
}

// --- season timeline ---------------------------------------------------------

type SeasonEvent =
  | { kind: "pick"; ts: number; week: 0; preseason: true; pick: SleeperDraftPick }
  | { kind: "txn"; ts: number; week: number; preseason: boolean; txn: SleeperTransaction };

/**
 * Merges a season's draft and transactions into one chronologically ordered
 * stream.
 *
 * This exists because processing the draft first and transactions second is
 * WRONG. Sleeper stamps every preseason move as `leg: 1`, but many of them
 * happen before the draft — 15 across 2024-25, including the trade that sent
 * Joe Burrow from Lauren to Brendon four days before the 2025 draft, after
 * which Brendon kept him. Replaying draft-first claims Brendon kept a player
 * he did not yet own.
 *
 * Draft picks are timestamped `start_time + pick_no`, which keeps them in pick
 * order and anchored to the draft. A transaction takes effect when it is
 * processed, so `status_updated` wins over `created`.
 */
function seasonTimeline(d: SeasonData): SeasonEvent[] {
  const draftStart = d.draft?.start_time ?? 0;
  const events: SeasonEvent[] = [];

  for (const p of d.picks) {
    events.push({ kind: "pick", ts: draftStart + p.pick_no, week: 0, preseason: true, pick: p });
  }

  for (const [week, txns] of d.transactions) {
    for (const txn of txns) {
      if (txn.status !== "complete") continue;
      const ts = txn.status_updated || txn.created;
      events.push({
        kind: "txn",
        ts,
        week,
        preseason: draftStart > 0 && ts < draftStart,
        txn,
      });
    }
  }

  return events.sort((a, b) => a.ts - b.ts);
}

// --- keeper resolver --------------------------------------------------------

/**
 * Replays every draft and transaction in chronological order to derive each
 * player's keeper contract.
 *
 * Sleeper models none of this — `is_keeper` is a bare boolean with no round,
 * no contract length, and no lineage — so the whole thing is reconstructed from
 * event history. The rules implemented here are bylaws 1.7.2:
 *
 *   - Drafted (not kept)      -> new contract at that round, 0 keeps used
 *   - Kept (is_keeper)        -> same contract, keeps used + 1
 *   - Undrafted free agent    -> new contract at `undraftedFreeAgentRound` (11)
 *   - Previously-drafted FA   -> new contract at min(11, original round);
 *                                "whichever is earlier" means the lower round number
 *   - Traded                  -> contract transfers untouched (1.7.2.5)
 *
 * Every decision is recorded in `provenance` so the UI can show its work, and
 * `config/keeper-overrides.json` lets the commissioner correct any contract the
 * replay gets wrong without editing code.
 */
function resolveKeepers(seasons: SeasonData[], draftOnly: DraftOnlySeason[] = []): {
  perSeason: SeasonKeepers[];
  final: KeeperContract[];
} {
  /** playerId -> live contract. Survives drops so a re-add can consult it. */
  const contracts = new Map<string, KeeperContract>();
  const perSeason: SeasonKeepers[] = [];

  for (const d of seasons) {
    const { keepers: kr } = d.rules;
    const kept: string[] = [];

    // Replay draft picks and transactions in true chronological order. A
    // preseason trade must be applied before the draft that follows it.
    for (const ev of seasonTimeline(d)) {
      if (ev.kind === "pick") {
        const p = ev.pick;
        if (ignoredPlayers.has(p.player_id)) continue;
        const owner = d.rosterToOwner.get(Number(p.roster_id)) ?? null;
        const existing = contracts.get(p.player_id);

        if (p.is_keeper && existing) {
          existing.ownerSlug = owner;
          existing.keepsUsed += 1;
          existing.provenance.push(
            `${d.season}: kept at R${existing.round} by ${owner} (keep ${existing.keepsUsed} of ${kr.maxKeepsAtOriginalCost})`,
          );
          kept.push(p.player_id);
        } else {
          if (p.is_keeper && !existing) {
            log.warn(
              `${d.season}: ${p.player_id} flagged is_keeper but has no prior contract — treating as a fresh R${p.round} draft pick`,
            );
          }
          contracts.set(p.player_id, {
            playerId: p.player_id,
            ownerSlug: owner,
            round: p.round,
            keepsUsed: 0,
            keepsRemaining: kr.maxKeepsAtOriginalCost,
            expired: false,
            origin: d.season === seasons[0].season ? "startup" : "drafted",
            startSeason: d.season,
            originalDraftRound: p.round,
            provenance: [`${d.season}: drafted R${p.round} pick ${p.pick_no} by ${owner}`],
          });
        }
        continue;
      }

      const { txn: t, week, preseason } = ev;
      const when = preseason ? `${d.season} preseason` : `${d.season} wk${week}`;

      // Drops first: a waiver add paired with a drop of a different player is
      // unambiguous either way, and this keeps a same-transaction drop from
      // clobbering the add that follows it.
      for (const [playerId, rosterId] of Object.entries(t.drops ?? {})) {
        // In a trade the "drop" side is the sending team, handled by the add.
        if (t.type === "trade") continue;
        const c = contracts.get(playerId);
        if (!c) continue;
        c.ownerSlug = null;
        c.provenance.push(`${when}: dropped by ${d.rosterToOwner.get(rosterId) ?? "?"}`);
      }

      for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
        if (ignoredPlayers.has(playerId)) continue;
        const owner = d.rosterToOwner.get(rosterId) ?? null;
        const prior = contracts.get(playerId);

        // A trade transfers the contract untouched (bylaws 1.7.2.5). A
        // commissioner move is a roster correction under bylaws 1.3.1, not a
        // real acquisition, so it must not reset a contract either.
        if (t.type === "trade" || t.type === "commissioner") {
          const fromRoster = (t.drops ?? {})[playerId];
          const from = fromRoster != null ? d.rosterToOwner.get(fromRoster) : undefined;
          if (prior) {
            prior.ownerSlug = owner;
            prior.provenance.push(
              t.type === "trade"
                ? `${when}: traded from ${from ?? prior.ownerSlug ?? "?"} to ${owner} (contract inherited)`
                : `${when}: commissioner move to ${owner} (contract unchanged)`,
            );
          }
          continue;
        }

        const faRound = kr.undraftedFreeAgentRound;
        if (!prior) {
          contracts.set(playerId, {
            playerId,
            ownerSlug: owner,
            round: faRound,
            keepsUsed: 0,
            keepsRemaining: kr.maxKeepsAtOriginalCost,
            expired: false,
            origin: "undrafted-fa",
            startSeason: d.season,
            originalDraftRound: null,
            provenance: [`${when}: undrafted FA pickup by ${owner} — R${faRound} value`],
          });
        } else {
          // "11th round OR the round originally drafted, whichever is EARLIER"
          // — earlier round means the smaller number.
          const base = prior.originalDraftRound ?? faRound;
          const newRound = Math.min(faRound, base);
          contracts.set(playerId, {
            playerId,
            ownerSlug: owner,
            round: newRound,
            keepsUsed: 0,
            keepsRemaining: kr.maxKeepsAtOriginalCost,
            expired: false,
            origin: "reacquired",
            startSeason: d.season,
            originalDraftRound: prior.originalDraftRound,
            provenance: [
              ...prior.provenance,
              `${when}: re-acquired by ${owner} via ${t.type} — min(R${faRound}, R${base}) = R${newRound}, contract reset`,
            ],
          });
        }
      }
    }

    // Reconcile ownership against the season's actual final roster.
    //
    // The transaction log is not a complete record of roster mutation — Sleeper
    // omits a transaction for some commissioner and auto-processing moves — so
    // replaying adds and drops alone drifts. The roster snapshot is the
    // authority on who owns whom; the replay is only the authority on *why* a
    // contract has the value it does.
    const ownedBy = new Map<string, string>();
    for (const r of d.rosters) {
      const slug = d.rosterToOwner.get(r.roster_id)!;
      for (const pid of [...(r.players ?? []), ...(r.reserve ?? [])]) {
        if (!ignoredPlayers.has(pid)) ownedBy.set(pid, slug);
      }
    }
    for (const c of contracts.values()) {
      const actual = ownedBy.get(c.playerId) ?? null;
      if (actual !== c.ownerSlug) {
        c.provenance.push(
          actual
            ? `${d.season} final roster: held by ${actual}`
            : `${d.season} final roster: not rostered`,
        );
        c.ownerSlug = actual;
      }
      c.keepsRemaining = Math.max(0, kr.maxKeepsAtOriginalCost - c.keepsUsed);
      c.expired = c.keepsRemaining === 0;
    }
    perSeason.push({
      season: d.season,
      contracts: structuredClone([...contracts.values()]).sort(
        (a, b) => a.round - b.round || a.playerId.localeCompare(b.playerId),
      ),
      keptPlayerIds: kept.sort(),
    });
  }

  // A completed draft whose SEASON is still running.
  //
  // This is what rolls the league onto the next keeper cycle: the moment the
  // draft finishes, every cost on the keeper page should be next year's. Waiting
  // for the season to finalize would leave stale values on screen for four
  // months, right when people are using them.
  //
  // THE DRAFT IS THE ROSTER SNAPSHOT. A keeper league drafts a full squad, so
  // anyone not drafted or kept is in the free-agent pool — which is the same job
  // the final-roster reconciliation does for a finished season. Post-draft
  // waiver moves are applied on top in the browser by lib/keeper-live.ts.
  for (const d of draftOnly) {
    const kr = d.rules.keepers;
    const kept: string[] = [];
    const drafted = new Set<string>();

    for (const p of [...d.picks].sort((a, b) => a.pick_no - b.pick_no)) {
      if (ignoredPlayers.has(p.player_id)) continue;
      drafted.add(p.player_id);
      const owner = d.rosterToOwner.get(Number(p.roster_id)) ?? null;
      const existing = contracts.get(p.player_id);

      if (p.is_keeper && existing) {
        existing.ownerSlug = owner;
        existing.keepsUsed += 1;
        existing.provenance.push(
          `${d.season}: kept at R${existing.round} by ${owner} (keep ${existing.keepsUsed} of ${kr.maxKeepsAtOriginalCost})`,
        );
        kept.push(p.player_id);
      } else {
        contracts.set(p.player_id, {
          playerId: p.player_id,
          ownerSlug: owner,
          round: p.round,
          keepsUsed: 0,
          keepsRemaining: kr.maxKeepsAtOriginalCost,
          expired: false,
          origin: "drafted",
          startSeason: d.season,
          originalDraftRound: p.round,
          provenance: [`${d.season}: drafted R${p.round} pick ${p.pick_no} by ${owner}`],
        });
      }
    }

    for (const c of contracts.values()) {
      if (!drafted.has(c.playerId) && c.ownerSlug !== null) {
        c.ownerSlug = null;
        c.provenance.push(`${d.season} draft: went undrafted — free agent`);
      }
      c.keepsRemaining = Math.max(0, kr.maxKeepsAtOriginalCost - c.keepsUsed);
      c.expired = c.keepsRemaining === 0;
    }

    perSeason.push({
      season: d.season,
      contracts: structuredClone([...contracts.values()]).sort(
        (a, b) => a.round - b.round || a.playerId.localeCompare(b.playerId),
      ),
      keptPlayerIds: kept.sort(),
    });
  }

  for (const [playerId, patch] of Object.entries(overrides.contracts ?? {})) {
    const c = contracts.get(playerId);
    if (!c) continue;
    Object.assign(c, patch);
    c.provenance.push("manual override from config/keeper-overrides.json");
  }

  return {
    perSeason,
    final: [...contracts.values()].sort((a, b) => a.round - b.round),
  };
}

// --- records & head-to-head -------------------------------------------------

/**
 * Seasons whose scores already arrive as weekly matchups.
 *
 * The three fallbacks below scrape scores out of imported BRACKETS, which was the
 * only way to see a pre-Sleeper game before the weekly scoreboards were
 * recovered. For a season that now has both, scraping the bracket counts every
 * postseason game a second time — inflating head-to-head records and putting
 * duplicate entries in the record book.
 */
const seasonsWithWeeklyData = (matchups: Matchup[]): Set<number> =>
  new Set(matchups.map((m) => m.season));

function buildOwnerRecords(
  summaries: SeasonSummary[],
  matchups: Matchup[],
): OwnerRecord[] {
  const rec = new Map<string, OwnerRecord>();
  const blank = (slug: string): OwnerRecord => ({
    ownerSlug: slug,
    wins: 0, losses: 0, ties: 0, winPct: 0,
    pointsFor: 0, pointsAgainst: 0,
    pointsForPerGame: 0, pointsAgainstPerGame: 0,
    championships: 0, runnerUps: 0, thirdPlaces: 0, lastPlaces: 0,
    playoffAppearances: 0, seasonsPlayed: 0,
    averageFinish: null, bestFinish: null, worstFinish: null,
    finishes: [], vs: {},
  });
  for (const slug of owners.keys()) rec.set(slug, blank(slug));

  // Head-to-head needs the full owner set on each side, so a co-owned team's
  // record lands on every co-owner and against every opponent co-owner.
  const ownersOfTeam = new Map<string, string[]>();
  for (const s of summaries) {
    for (const row of s.standings) ownersOfTeam.set(`${s.season}:${row.ownerSlug}`, row.ownerSlugs);
  }
  const sideOwners = (season: number, slug: string) =>
    ownersOfTeam.get(`${season}:${slug}`) ?? [slug];

  /** Credits one meeting to every pairing across the two teams' owner sets. */
  const credit = (
    season: number,
    a: { slug: string; points: number },
    b: { slug: string; points: number },
    isPlayoff: boolean,
  ) => {
    for (const [self, opp] of [
      [a, b],
      [b, a],
    ] as const) {
      for (const me of sideOwners(season, self.slug)) {
        const r = rec.get(me);
        if (!r) continue;
        for (const them of sideOwners(season, opp.slug)) {
          if (them === me) continue;
          const h2h = (r.vs[them] ??= {
            wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
            playoff: { wins: 0, losses: 0, ties: 0 },
          });
          h2h.pointsFor = round2(h2h.pointsFor + self.points);
          h2h.pointsAgainst = round2(h2h.pointsAgainst + opp.points);
          const bucket = self.points === opp.points ? "ties" : self.points > opp.points ? "wins" : "losses";
          h2h[bucket]++;
          if (isPlayoff) h2h.playoff[bucket]++;
        }
      }
    }
  };

  // Sleeper seasons: every meeting, postseason included. Playoff and toilet-bowl
  // games are genuine head-to-head results and excluding them discarded data.
  for (const m of matchups) {
    credit(
      m.season,
      { slug: m.home.ownerSlug, points: m.home.points },
      { slug: m.away.ownerSlug, points: m.away.points },
      m.kind !== "regular",
    );
  }

  // Imported ESPN seasons whose weekly scoreboards are still lost: their playoff,
  // winner's consolation and ladder games were recovered with full scores, so
  // those meetings can still be counted even though the regular season cannot.
  const weekly = seasonsWithWeeklyData(matchups);
  for (const s of summaries) {
    if (!s.imported || weekly.has(s.season)) continue;
    // extraBrackets included: ESPN has THREE postseason sections, and the
    // winner's consolation ladder (3rd-6th) lives there. Omitting it dropped
    // those meetings from head-to-head while the record book counted them, so the
    // two disagreed about how many times a pair had played.
    const imported = [
      ...s.winnersBracket,
      ...s.losersBracket,
      ...s.extraBrackets.flatMap((b) => b.matches),
    ];
    for (const m of imported) {
      if (!m.team1 || !m.team2) continue;
      const p1 = m.points[m.team1];
      const p2 = m.points[m.team2];
      if (p1 == null || p2 == null) continue;
      credit(s.season, { slug: m.team1, points: p1 }, { slug: m.team2, points: p2 }, true);
    }
  }

  // A career record counts EVERY game — regular season and postseason alike.
  // Standings only ever describe the regular season, so the totals are summed
  // from matchups now that every season on record has them. A season with no
  // matchups (an import whose weekly scoreboards are still lost) falls back to
  // its standings row, which is regular-season only but better than nothing.
  const playedSeasons = new Set(matchups.map((m) => m.season));
  for (const m of matchups) {
    for (const [me, opp] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      const bucket = me.points === opp.points ? "ties" : me.points > opp.points ? "wins" : "losses";
      for (const slug of sideOwners(m.season, me.ownerSlug)) {
        const r = rec.get(slug);
        if (!r) continue;
        r[bucket]++;
        r.pointsFor = round2(r.pointsFor + me.points);
        r.pointsAgainst = round2(r.pointsAgainst + opp.points);
      }
    }
  }

  for (const s of summaries) {
    if (!s.finalized) continue;
    for (const row of s.standings) {
      for (const slug of row.ownerSlugs) {
        const r = rec.get(slug);
        if (!r) continue;
        r.seasonsPlayed++;
        if (!playedSeasons.has(s.season)) {
          r.wins += row.wins;
          r.losses += row.losses;
          r.ties += row.ties;
          r.pointsFor = round2(r.pointsFor + row.pointsFor);
          r.pointsAgainst = round2(r.pointsAgainst + row.pointsAgainst);
        }
        if (row.madePlayoffs) r.playoffAppearances++;
        r.finishes.push({ season: s.season, place: row.finalPlace, seed: row.seed });

        const owner = owners.get(slug)!;
        owner.seasons.push(s.season);
        for (const other of row.ownerSlugs) {
          if (other !== slug && !owner.coOwnedWith.includes(other)) owner.coOwnedWith.push(other);
        }
      }
    }
    // Honours credit the whole team, so a co-owned title counts for both.
    const teamOwners = (slug: string | null) =>
      slug ? (s.standings.find((r) => r.ownerSlug === slug)?.ownerSlugs ?? [slug]) : [];
    for (const slug of teamOwners(s.champion)) rec.get(slug)!.championships++;
    for (const slug of teamOwners(s.runnerUp)) rec.get(slug)!.runnerUps++;
    for (const slug of teamOwners(s.thirdPlace)) rec.get(slug)!.thirdPlaces++;
    for (const slug of teamOwners(s.lastPlace)) rec.get(slug)!.lastPlaces++;
  }

  for (const r of rec.values()) {
    const games = r.wins + r.losses + r.ties;
    // Four decimals, not two: the UI renders one decimal place of a PERCENTAGE,
    // so a value rounded to 0.59 can only ever print "59.0%".
    r.winPct = games ? Number(((r.wins + r.ties / 2) / games).toFixed(4)) : 0;
    // Per-game rates over every game played, so a 13-game 2020 season compares
    // fairly with a 14-game one and a deep playoff run is not free.
    r.pointsForPerGame = games ? round2(r.pointsFor / games) : 0;
    r.pointsAgainstPerGame = games ? round2(r.pointsAgainst / games) : 0;
    const places = r.finishes.map((f) => f.place).filter((p): p is number => p != null);
    if (places.length) {
      r.averageFinish = round2(places.reduce((a, b) => a + b, 0) / places.length);
      r.bestFinish = Math.min(...places);
      r.worstFinish = Math.max(...places);
    }
  }

  return [...rec.values()].sort(
    byAllTimeRank,
  );
}

/**
 * The all-time record book.
 *
 * Includes the imported ESPN playoff and ladder matchups, which carry real scores
 * even though those seasons kept no weekly matchups. Excluding them would leave
 * the second-highest score ever recorded off the list, and would disagree with
 * `recordsAtTheTime()`, which uses the same games to seed its baseline.
 *
 * Player records stay Sleeper-only by necessity: ESPN kept no lineups.
 */
function buildLeagueRecords(matchups: Matchup[], summaries: SeasonSummary[]): LeagueRecords {
  const scores: ScoreRecord[] = [];
  const playerScores: PlayerScoreRecord[] = [];
  const margins: Array<ScoreRecord & { margin: number }> = [];
  const combined: CombinedRecord[] = [];

  /** One entry per GAME, unlike `scores`, which has one per team. */
  const addCombined = (
    season: number,
    week: number,
    x: { slug: string; pts: number },
    y: { slug: string; pts: number },
  ) => {
    const [hi, lo] = x.pts >= y.pts ? [x, y] : [y, x];
    combined.push({
      season,
      week,
      total: round2(x.pts + y.pts),
      ownerSlug: hi.slug,
      points: hi.pts,
      opponentSlug: lo.slug,
      opponentPoints: lo.pts,
    });
  };

  const weeklyRecordSeasons = seasonsWithWeeklyData(matchups);
  for (const s of summaries) {
    if (!s.imported || weeklyRecordSeasons.has(s.season)) continue;
    const brackets = [s.winnersBracket, s.losersBracket, ...s.extraBrackets.map((b) => b.matches)];
    for (const matches of brackets) {
      for (const m of matches) {
        if (!m.team1 || !m.team2 || m.isBye) continue;
        const p1 = m.points[m.team1];
        const p2 = m.points[m.team2];
        if (p1 == null || p2 == null) continue;
        for (const [self, opp] of [
          [{ slug: m.team1, pts: p1 }, { slug: m.team2, pts: p2 }],
          [{ slug: m.team2, pts: p2 }, { slug: m.team1, pts: p1 }],
        ] as const) {
          const base: ScoreRecord = {
            season: s.season,
            week: m.week ?? 0,
            ownerSlug: self.slug,
            points: self.pts,
            opponentSlug: opp.slug,
            opponentPoints: opp.pts,
          };
          scores.push(base);
          if (self.pts > opp.pts) {
            margins.push({ ...base, margin: round2(self.pts - opp.pts) });
          }
        }
        addCombined(s.season, m.week ?? 0, { slug: m.team1, pts: p1 }, { slug: m.team2, pts: p2 });
      }
    }
  }

  for (const m of matchups) {
    addCombined(
      m.season,
      m.week,
      { slug: m.home.ownerSlug, pts: m.home.points },
      { slug: m.away.ownerSlug, pts: m.away.points },
    );
    for (const [self, opp] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      const base: ScoreRecord = {
        season: m.season,
        week: m.week,
        ownerSlug: self.ownerSlug,
        points: self.points,
        opponentSlug: opp.ownerSlug,
        opponentPoints: opp.points,
      };
      scores.push(base);
      if (m.winner === self.ownerSlug) {
        margins.push({ ...base, margin: round2(self.points - opp.points) });
      }
      // STARTED PLAYERS ONLY. A monster week on the bench scored the team
      // nothing, so ranking it alongside points that actually counted would make
      // the list measure roster luck rather than results. Every surface that
      // marks a player record depends on this: the record book, the matchup
      // badges, and the chip on a lineup row.
      const starters = new Set(self.starters);
      for (const [playerId, p] of Object.entries(self.playerPoints)) {
        if (!starters.has(playerId)) continue;
        playerScores.push({
          season: m.season,
          week: m.week,
          ownerSlug: self.ownerSlug,
          playerId,
          points: round2(p),
          started: true,
        });
      }
    }
  }

  const top = <T>(arr: T[], by: (x: T) => number, n = 25, asc = false) =>
    arr.slice().sort((a, b) => (asc ? by(a) - by(b) : by(b) - by(a))).slice(0, n);

  return {
    weeklyHigh: top(scores, (s) => s.points),
    weeklyLow: top(scores, (s) => s.points, 25, true),
    playerHigh: top(playerScores, (s) => s.points),
    biggestBlowout: top(margins, (s) => s.margin),
    narrowestWin: top(margins, (s) => s.margin, 25, true),
    highestCombined: top(combined, (s) => s.total),
    lowestCombined: top(combined, (s) => s.total, 25, true),
  };
}

// --- transactions & drafts --------------------------------------------------

/**
 * Per-player event log, chronological.
 *
 * A trade is emitted as ONE event with both sides. Sleeper stores it as an add
 * and a drop inside a single transaction; emitting those separately renders as
 * "Dropped by Lauren / Added by Brendon", two half-events that never say a trade
 * happened.
 */
function buildPlayerHistory(seasons: SeasonData[]): Record<string, PlayerTransaction[]> {
  const hist: Record<string, PlayerTransaction[]> = {};
  const push = (playerId: string, t: PlayerTransaction) => (hist[playerId] ??= []).push(t);

  for (const d of seasons) {
    for (const ev of seasonTimeline(d)) {
      if (ev.kind === "pick") {
        const p = ev.pick;
        if (ignoredPlayers.has(p.player_id)) continue;
        push(p.player_id, {
          season: d.season,
          week: 0,
          preseason: true,
          type: "draft",
          action: p.is_keeper ? "keep" : "draft",
          ownerSlug: d.rosterToOwner.get(Number(p.roster_id)) ?? null,
          fromSlug: null,
          toSlug: null,
          faabSpent: null,
          timestamp: ev.ts,
          round: p.round,
          pickNo: p.pick_no,
        });
        continue;
      }

      const { txn: t, week, preseason, ts } = ev;
      const base = { season: d.season, week, preseason, timestamp: ts, type: t.type } as const;

      if (t.type === "trade") {
        // Pair each traded player with the roster that gave them up.
        for (const [playerId, toRoster] of Object.entries(t.adds ?? {})) {
          const fromRoster = (t.drops ?? {})[playerId];
          push(playerId, {
            ...base,
            action: "trade",
            ownerSlug: d.rosterToOwner.get(toRoster) ?? null,
            fromSlug: fromRoster != null ? (d.rosterToOwner.get(fromRoster) ?? null) : null,
            toSlug: d.rosterToOwner.get(toRoster) ?? null,
            faabSpent: null,
          });
        }
        // A drop with no matching add means the player was released as part of
        // the trade rather than moved between rosters.
        for (const [playerId, fromRoster] of Object.entries(t.drops ?? {})) {
          if ((t.adds ?? {})[playerId] != null) continue;
          push(playerId, {
            ...base,
            action: "drop",
            ownerSlug: d.rosterToOwner.get(fromRoster) ?? null,
            fromSlug: null,
            toSlug: null,
            faabSpent: null,
          });
        }
        continue;
      }

      for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
        push(playerId, {
          ...base,
          action: "add",
          ownerSlug: d.rosterToOwner.get(rosterId) ?? null,
          fromSlug: null,
          toSlug: null,
          faabSpent: t.type === "waiver" ? (t.settings?.waiver_bid ?? null) : null,
        });
      }
      for (const [playerId, rosterId] of Object.entries(t.drops ?? {})) {
        push(playerId, {
          ...base,
          action: "drop",
          ownerSlug: d.rosterToOwner.get(rosterId) ?? null,
          fromSlug: null,
          toSlug: null,
          faabSpent: null,
        });
      }
    }
  }

  // Sort on the real timestamp, not season/week — that is the whole point.
  for (const list of Object.values(hist)) {
    list.sort((a, b) => a.season - b.season || a.timestamp - b.timestamp);
  }
  return hist;
}

/**
 * Draft picks, with the slot's original owner alongside the one who used it.
 *
 * A pick's `roster_id` is the roster that USED it, while the draft's
 * `slot_to_roster_id` says whose slot it is. They differ exactly when the pick
 * was traded — cross-checked against `traded-picks.json` for 2025: both report
 * the same 23 picks. Deriving it from the pick itself rather than the traded-pick
 * list keeps it correct for a past season even after later trades, since
 * `traded-picks.json` describes current ownership.
 */
/**
 * Picks from a season whose DRAFT is done but whose season is not.
 *
 * `sync` commits `draft.json` the moment a draft completes, but withholds
 * `league.json`, `rosters.json` and `users.json` until the season is over —
 * those keep moving all year, and committing a moving target would break the
 * "an unchanged league produces an empty diff" property. `loadSeason` needs
 * `league.json`, so it returns null and the whole season used to be skipped:
 * the draft results sat in `raw/` and reached no page until January.
 *
 * The attribution comes out of `draft.json` alone. It carries both halves —
 * `slot_to_roster_id` is slot -> roster and `draft_order` is user -> slot — so
 * composing them gives roster -> user without a roster snapshot. `picked_by` is
 * the fallback, since it is empty on an autopick.
 */
interface DraftOnlySeason {
  season: number;
  rules: Rules;
  picks: SleeperDraftPick[];
  /** roster -> owner slug, composed out of draft.json. */
  rosterToOwner: Map<number, string | null>;
  slotOwner: Map<number, string | null>;
}

function loadDraftOnly(loaded: SeasonData[]): DraftOnlySeason[] {
  const done = new Set(loaded.map((d) => d.season));
  const out: DraftOnlySeason[] = [];

  for (const s of index.seasons) {
    const season = Number(s.season);
    if (done.has(season)) continue;
    const dir = join(RAW_DIR, String(season));
    const draft = readJson<SleeperDraft>(join(dir, "draft.json"));
    const picks = readJson<SleeperDraftPick[]>(join(dir, "draft-picks.json"));
    if (!draft || !picks?.length) continue;

    const rosterToUser = new Map<number, string>();
    for (const [userId, slot] of Object.entries(draft.draft_order ?? {})) {
      const roster = draft.slot_to_roster_id?.[String(slot)];
      if (roster != null) rosterToUser.set(Number(roster), userId);
    }
    const ownerOf = (rosterId: number, pickedBy: string | null): string | null => {
      const userId = rosterToUser.get(rosterId) ?? pickedBy ?? null;
      return userId ? (slugByUserId.get(userId) ?? null) : null;
    };

    const rosterToOwner = new Map<number, string | null>();
    for (const rosterId of rosterToUser.keys()) rosterToOwner.set(rosterId, ownerOf(rosterId, null));
    const slotOwner = new Map<number, string | null>();
    for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id ?? {})) {
      slotOwner.set(Number(slot), ownerOf(Number(rosterId), null));
    }

    log.info(`${season}: draft complete but season in progress — ${picks.length} picks recorded`);
    out.push({ season, rules: rulesFor(season), picks, rosterToOwner, slotOwner });
  }
  return out;
}

function draftOnlySeasons(draftOnly: DraftOnlySeason[]): DraftPickRecord[] {
  return draftOnly.flatMap((d) =>
    d.picks
      .filter((p) => !ignoredPlayers.has(p.player_id))
      .map((p) => ({
        season: d.season,
        round: p.round,
        pickNo: p.pick_no,
        draftSlot: p.draft_slot,
        ownerSlug:
          d.rosterToOwner.get(Number(p.roster_id)) ??
          (p.picked_by ? (slugByUserId.get(p.picked_by) ?? null) : null),
        slotOwnerSlug: d.slotOwner.get(p.draft_slot) ?? null,
        playerId: p.player_id,
        isKeeper: Boolean(p.is_keeper),
      })),
  );
}

function buildDraftHistory(seasons: SeasonData[]): DraftPickRecord[] {
  return seasons.flatMap((d) => {
    const slotOwner = new Map<number, string | null>();
    for (const [slot, rosterId] of Object.entries(d.draft?.slot_to_roster_id ?? {})) {
      slotOwner.set(Number(slot), d.rosterToOwner.get(Number(rosterId)) ?? null);
    }
    return d.picks
      .filter((p) => !ignoredPlayers.has(p.player_id))
      .map((p) => ({
        season: d.season,
        round: p.round,
        pickNo: p.pick_no,
        draftSlot: p.draft_slot,
        ownerSlug: d.rosterToOwner.get(Number(p.roster_id)) ?? null,
        slotOwnerSlug: slotOwner.get(p.draft_slot) ?? null,
        playerId: p.player_id,
        isKeeper: Boolean(p.is_keeper),
      }));
  });
}

/**
 * A replay of the most recent finished season, for the phase mocks.
 *
 * The mocks used to FABRICATE fixtures and scores. Replaying a real season is
 * strictly better: the layouts get built against the shape of actual data —
 * blowouts, ties, a 40-point week, co-owned teams — rather than against numbers
 * chosen to look reasonable. When this season reaches the same phase, the UI has
 * already been seen with data like it.
 *
 * Written to `public/`, not `data/`, because only a browser needs it and only
 * when a mock is on. Nobody who is not developing ever downloads it.
 *
 * Everything derives from a week number at read time — standings are the sum of
 * weeks 1..N — so the file is one season, not one file per phase.
 */
function writeReplay(slug: string, summaries: SeasonSummary[], matchups: Matchup[]): void {
  const finished = summaries.filter((s) => s.finalized && !s.imported).sort((a, b) => b.season - a.season);
  const latest = finished[0];
  if (!latest) return;

  const weeks: Record<string, Array<{ a: [string, number]; b: [string, number] }>> = {};
  for (const m of matchups.filter((m) => m.season === latest.season)) {
    const key = String(m.week);
    weeks[key] = [
      ...(weeks[key] ?? []),
      {
        a: [m.home.ownerSlug, m.home.points],
        b: [m.away.ownerSlug, m.away.points],
      },
    ];
  }

  const draft = readJson<SleeperDraft>(join(RAW_DIR, String(latest.season), "draft.json"));
  writeJson(join(ROOT, "public", "mock", `${slug}.json`), {
    season: latest.season,
    regularSeasonWeeks: latest.regularSeasonWeeks,
    teams: latest.standings.map((r) => ({
      ownerSlug: r.ownerSlug,
      ownerSlugs: r.ownerSlugs,
      rosterId: r.rosterId,
      teamName: r.teamName,
    })),
    weeks,
    draft: draft
      ? {
          startTime: draft.start_time ?? null,
          type: draft.type,
          rounds: draft.settings?.rounds ?? 0,
          teams: draft.settings?.teams ?? latest.teams,
          reversalRound: draft.settings?.reversal_round ?? 0,
          slotToRoster: draft.slot_to_roster_id ?? {},
        }
      : null,
  });
  log.write(`public/mock/${slug}.json — ${latest.season} replay`);
}

// --- imported (pre-Sleeper) seasons ------------------------------------------

/** What `import:espn:lineups` writes for one season. */
interface ManualLineups {
  season: number;
  rosterPositions: string[];
  weeks: Record<string, Record<string, { starters: string[]; playerPoints: Record<string, number> }>>;
}

interface ManualSeason {
  season: number;
  teams: number;
  playoffWeekStart: number;
  finalWeek: number;
  regularSeasonWeeks: number;
  standings: Array<{
    finalPlace: number;
    teamName: string;
    teamSlug: string;
    ownerSlugs: string[];
    wins: number; losses: number; ties: number;
    pointsFor: number; pointsAgainst: number;
    seed: number | null;
  }>;
  games: Array<{
    section: "winners" | "winners-consolation" | "consolation";
    round: number;
    week: number | null;
    gameId: string | null;
    routing: string | null;
    teams: Array<{ seed: number; teamName: string; points: number }>;
  }>;
  /** True once weekly scoreboards have been recovered for the season. */
  hasWeeklyMatchups?: boolean;
  /** Week-by-week results. Absent for seasons whose scoreboards are still lost. */
  matchups?: Array<{
    week: number;
    kind: "regular" | "playoff" | "consolation";
    home: { ownerSlug: string; points: number };
    away: { ownerSlug: string; points: number };
  }>;
}

/**
 * Weekly matchups from imported seasons, in the same shape as Sleeper's.
 *
 * Once a season's scoreboards exist it is a full participant in head-to-head,
 * the record book and every weekly list. Lineups now come from ESPN's read API
 * (`import:espn:lineups`) with ids normalised to Sleeper's, so an imported season
 * is not a lesser kind of season any more — a week with lineups on file feeds
 * player records exactly as a Sleeper week does.
 *
 * Callers MUST stop scraping that season's brackets for scores once this returns
 * games for it, or every postseason game is counted twice.
 */
function importedMatchups(): Matchup[] {
  const dir = join(DATA_DIR, "manual");
  if (!existsSync(dir)) return [];

  const out: Matchup[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!/^\d{4}\.json$/.test(file)) continue;
    const m = readJson<ManualSeason>(join(dir, file));
    if (!m?.matchups?.length) continue;

    // Absent until a season has been through the lineup importer, and absent per
    // WEEK within it — the import runs a week at a time, so a half-done season
    // has to render the done weeks fully and the rest as before.
    const lineups = readJson<ManualLineups>(
      join(dir, "lineups", `${m.season}.json`),
    );

    m.matchups.forEach((g, i) => {
      const forWeek = lineups?.weeks?.[String(g.week)];
      const side = (x: { ownerSlug: string; points: number }): MatchupSide => ({
        ownerSlug: x.ownerSlug,
        points: x.points,
        starters: forWeek?.[x.ownerSlug]?.starters ?? [],
        playerPoints: forWeek?.[x.ownerSlug]?.playerPoints ?? {},
      });
      out.push({
        season: m.season,
        week: g.week,
        kind: g.kind,
        matchupId: i + 1,
        home: side(g.home),
        away: side(g.away),
        winner:
          g.home.points > g.away.points
            ? g.home.ownerSlug
            : g.away.points > g.home.points
              ? g.away.ownerSlug
              : null,
      });
    });
  }
  return out;
}

/**
 * Folds the ESPN-era seasons (2020-23) into the same SeasonSummary shape.
 *
 * These carry standings, final placement and full playoff scores, but no weekly
 * matchups, rosters, drafts or transactions — so they feed standings, finishes
 * and the trophy case, and are excluded from head-to-head regular-season
 * records, weekly records, player records and keeper contracts.
 *
 * ESPN has THREE postseason sections, not two, and the consolation format is a
 * LADDER rather than Sleeper's anti-tournament: winning moves you UP a rung.
 * Merging them into one "toilet bowl" loses both the structure and the meaning.
 *
 * Routing is recovered so the brackets actually render as brackets:
 *   - the ladder carries it explicitly ("GmC1 - W to GmC4, L to GmC5")
 *   - the championship bracket is inferred by team identity, since a team in
 *     round N either won a round N-1 match or had a bye
 */
function importedSeasons(): SeasonSummary[] {
  const dir = join(DATA_DIR, "manual");
  if (!existsSync(dir)) return [];

  const out: SeasonSummary[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!/^\d{4}\.json$/.test(file)) continue;
    const m = readJson<ManualSeason>(join(dir, file));
    if (!m) continue;

    const slugOf = new Map(m.standings.map((r) => [r.teamName, r.teamSlug]));
    // The slot labels the recovered lineups actually used, so the matchup page's
    // Slot column reads QB/RB/FLEX rather than falling back to "FLEX" for all.
    const lineups = readJson<ManualLineups>(join(dir, "lineups", `${m.season}.json`));

    /** Builds one section's matches, with byes, ids, scores and routing. */
    const section = (
      key: ManualSeason["games"][number]["section"],
      idBase: number,
    ): BracketMatch[] => {
      const games = m.games.filter((g) => g.section === key);

      const matches: BracketMatch[] = games.map((g, i) => {
        const ladderId = g.gameId ? Number(g.gameId.replace(/\D/g, "")) : null;
        const [a, b] = g.teams;
        const bye = g.teams.length === 1;
        const [w, l] = bye
          ? [a, undefined]
          : a.points > b.points
            ? [a, b]
            : [b, a];

        const points: Record<string, number> = {};
        for (const t of g.teams) {
          const slug = slugOf.get(t.teamName);
          if (slug) points[slug] = t.points;
        }

        return {
          round: g.round,
          matchId: ladderId ?? idBase + i,
          week: g.week,
          team1: slugOf.get(a.teamName) ?? null,
          team2: bye ? null : (slugOf.get(b!.teamName) ?? null),
          // A bye "advances" its team, which is what lets the next round link
          // back to it and sit centred against the game beside it.
          winner: slugOf.get(w.teamName) ?? null,
          loser: l ? (slugOf.get(l.teamName) ?? null) : null,
          team1From: null,
          team2From: null,
          placesFor: null,
          points,
          isBye: bye,
          label: g.gameId,
          // A ladder is not inverted — the higher scorer genuinely won and
          // climbs a rung. Only Sleeper's losers bracket inverts.
          inverted: false,
        };
      });

      // Explicit ladder routing: "W to GmC4, L to GmC5" on the SOURCE game tells
      // us where its winner and loser land, so write the ref onto the target.
      const byId = new Map(matches.map((x) => [x.matchId, x]));
      for (const g of games) {
        if (!g.routing || !g.gameId) continue;
        const from = Number(g.gameId.replace(/\D/g, ""));
        for (const [, side, dest] of g.routing.matchAll(/([WL])\s*to\s*Gm[A-Z]?(\d+)/gi)) {
          const target = byId.get(Number(dest));
          if (!target) continue;
          const ref = side.toUpperCase() === "W" ? { winnerOf: from } : { loserOf: from };
          if (!target.team1From) target.team1From = ref;
          else if (!target.team2From) target.team2From = ref;
        }
      }

      // Inferred routing for sections ESPN doesn't label: a team appearing in a
      // later round must have won an earlier match in this same section.
      for (const match of matches) {
        if (match.round <= Math.min(...matches.map((x) => x.round))) continue;
        for (const side of ["team1", "team2"] as const) {
          const fromKey = side === "team1" ? "team1From" : "team2From";
          if (match[fromKey] || !match[side]) continue;
          // Pick the NEAREST earlier round. A team that reached the final also
          // won in round 1, and matching that first links the final back past
          // the semi-final, collapsing the bracket.
          const feeder = matches
            .filter((x) => x.round < match.round && x.winner === match[side])
            .sort((x, y) => y.round - x.round)[0];
          if (feeder) match[fromKey] = { winnerOf: feeder.matchId };
        }
      }

      return matches.sort((a, b) => a.round - b.round || a.matchId - b.matchId);
    };

    const winners = section("winners", 100);
    const winnersConsolation = section("winners-consolation", 200);
    const ladder = section("consolation", 300);

    // Placement games, matching how the importer cross-validates placement.
    const finalRound = (arr: BracketMatch[]) => Math.max(0, ...arr.map((x) => x.round));
    for (const g of winners.filter((x) => x.round === finalRound(winners) && !x.isBye)) {
      g.placesFor = [1, 2];
    }
    const wcFinal = winnersConsolation
      .filter((x) => x.round === finalRound(winnersConsolation))
      .sort((x, y) => (x.matchId ?? 0) - (y.matchId ?? 0));
    wcFinal.forEach((g, i) => (g.placesFor = [3 + 2 * i, 4 + 2 * i]));
    const ladderFinal = ladder
      .filter((x) => x.round === finalRound(ladder))
      .sort((x, y) => x.matchId - y.matchId);
    ladderFinal.forEach((g, i) => (g.placesFor = [7 + 2 * i, 8 + 2 * i]));

    const standings: StandingsRow[] = m.standings.map((r) => ({
      ownerSlug: r.teamSlug,
      ownerSlugs: r.ownerSlugs,
      rosterId: r.seed ?? r.finalPlace,
      teamName: r.teamName,
      seed: r.seed ?? r.finalPlace,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      finalPlace: r.finalPlace,
      madePlayoffs: (r.seed ?? 99) <= 6,
    }));

    const at = (place: number) => standings.find((r) => r.finalPlace === place)?.ownerSlug ?? null;

    out.push({
      season: m.season,
      leagueId: `espn-${m.season}`,
      leagueName: "Den Ops Fantasy Football (ESPN)",
      status: "complete",
      finalized: true,
      imported: true,
      ladderConsolation: true,
      teams: m.teams,
      regularSeasonWeeks: m.regularSeasonWeeks,
      finalizedThroughWeek: m.finalWeek,
      rosterPositions: lineups?.rosterPositions ?? [],
      standings: standings.sort((a, b) => a.seed - b.seed),
      winnersBracket: winners,
      losersBracket: ladder,
      extraBrackets: [
        {
          key: "winners-consolation",
          title: "Winner's Consolation Ladder",
          note: "Teams knocked out of the championship bracket, playing for 3rd through 6th.",
          finalLabel: "🥉 3rd Place",
          finalPlace: 3,
          matches: winnersConsolation,
        },
      ],
      champion: at(1),
      runnerUp: at(2),
      thirdPlace: at(3),
      lastPlace: at(m.teams),
    });
  }
  return out;
}

// --- records set at the time ---------------------------------------------

interface AtTheTimeFlag {
  kind:
    | "weekly-high"
    | "weekly-low"
    | "blowout"
    | "narrowest"
    | "player-week"
    | "combined-high"
    | "combined-low";
  label: string;
  value: number;
  ownerSlug: string;
  /** Set for whole-game marks, where one name is only half the fact. */
  opponentSlug?: string;
  playerId?: string;
  /** Whether the mark still stands today. */
  stillStands: boolean;
}

/**
 * Matchups that set a league record the moment they were played.
 *
 * Only #1 marks count — a matchup that became the best or worst the league had
 * ever seen. Anything narrower would fire constantly and mean nothing.
 *
 * COVERAGE IS UNEVEN AND THE UI SAYS SO. The baseline is seeded with the ESPN
 * playoff and ladder games, which are the only pre-2024 scores that survived,
 * so a 2024 mark is measured against roughly 68 historical matchups rather than
 * the ~670 team-weeks actually played from 2020-23. Player-week marks are worse
 * still: ESPN kept no lineups, so that baseline genuinely starts empty in 2024.
 *
 * The first chronological event cannot set a record — there is nothing to beat —
 * so it is skipped rather than credited with every category at once.
 */
function recordsAtTheTime(
  summaries: SeasonSummary[],
  matchups: Matchup[],
): Record<string, AtTheTimeFlag[]> {
  const key = (season: number, week: number | null, a: string, b: string) =>
    `${season}-${week ?? 0}-${[a, b].sort().join("-vs-")}`;

  interface Event {
    season: number;
    week: number;
    id: string;
    sides: Array<{ slug: string; points: number }>;
    /** Only Sleeper games carry lineups. */
    players: Array<{ slug: string; playerId: string; points: number }>;
  }

  const events: Event[] = [];

  // Seed: ESPN playoff and ladder games for seasons whose weekly scoreboards are
  // still lost. A season with weekly data feeds the timeline through `matchups`.
  const weeklySeeded = seasonsWithWeeklyData(matchups);
  for (const s of summaries) {
    if (!s.imported || weeklySeeded.has(s.season)) continue;
    const brackets = [s.winnersBracket, s.losersBracket, ...s.extraBrackets.map((b) => b.matches)];
    for (const matches of brackets) {
      for (const m of matches) {
        if (!m.team1 || !m.team2 || m.isBye) continue;
        const p1 = m.points[m.team1];
        const p2 = m.points[m.team2];
        if (p1 == null || p2 == null) continue;
        events.push({
          season: s.season,
          week: m.week ?? 0,
          id: key(s.season, m.week, m.team1, m.team2),
          sides: [
            { slug: m.team1, points: p1 },
            { slug: m.team2, points: p2 },
          ],
          players: [],
        });
      }
    }
  }

  for (const m of matchups) {
    const starters = (side: Matchup["home"]) =>
      side.starters.map((pid) => ({
        slug: side.ownerSlug,
        playerId: pid,
        points: side.playerPoints[pid] ?? 0,
      }));
    events.push({
      season: m.season,
      week: m.week,
      id: key(m.season, m.week, m.home.ownerSlug, m.away.ownerSlug),
      sides: [
        { slug: m.home.ownerSlug, points: m.home.points },
        { slug: m.away.ownerSlug, points: m.away.points },
      ],
      players: [...starters(m.home), ...starters(m.away)],
    });
  }

  events.sort((a, b) => a.season - b.season || a.week - b.week);

  const out: Record<string, AtTheTimeFlag[]> = {};
  const add = (id: string, f: AtTheTimeFlag) => (out[id] ??= []).push(f);

  let bestScore = -Infinity;
  let worstScore = Infinity;
  let widestMargin = -Infinity;
  let tightestMargin = Infinity;
  let bestPlayer = -Infinity;
  let highestCombined = -Infinity;
  let lowestCombined = Infinity;

  events.forEach((ev, i) => {
    const first = i === 0;
    const [a, b] = ev.sides;
    // Round: raw float subtraction yields 27.019999999999996 and that reaches
    // the UI verbatim.
    const margin = round2(Math.abs(a.points - b.points));
    const winner = a.points === b.points ? null : a.points > b.points ? a : b;

    for (const side of ev.sides) {
      if (!first && side.points > bestScore) {
        add(ev.id, {
          kind: "weekly-high",
          label: "Highest score in league history",
          value: side.points,
          ownerSlug: side.slug,
          stillStands: false,
        });
      }
      if (!first && side.points < worstScore) {
        add(ev.id, {
          kind: "weekly-low",
          label: "Lowest score in league history",
          value: side.points,
          ownerSlug: side.slug,
          stillStands: false,
        });
      }
      bestScore = Math.max(bestScore, side.points);
      worstScore = Math.min(worstScore, side.points);
    }

    const total = round2(a.points + b.points);
    if (!first && total > highestCombined) {
      add(ev.id, {
        kind: "combined-high",
        label: "Highest scoring matchup in league history",
        value: total,
        ownerSlug: (a.points >= b.points ? a : b).slug,
        opponentSlug: (a.points >= b.points ? b : a).slug,
        stillStands: false,
      });
    }
    if (!first && total < lowestCombined) {
      add(ev.id, {
        kind: "combined-low",
        label: "Lowest scoring matchup in league history",
        value: total,
        ownerSlug: (a.points >= b.points ? a : b).slug,
        opponentSlug: (a.points >= b.points ? b : a).slug,
        stillStands: false,
      });
    }
    highestCombined = Math.max(highestCombined, total);
    lowestCombined = Math.min(lowestCombined, total);

    if (winner) {
      if (!first && margin > widestMargin) {
        add(ev.id, {
          kind: "blowout",
          label: "Biggest margin in league history",
          value: margin,
          ownerSlug: winner.slug,
          opponentSlug: (winner === a ? b : a).slug,
          stillStands: false,
        });
      }
      if (!first && margin < tightestMargin) {
        add(ev.id, {
          kind: "narrowest",
          label: "Narrowest win in league history",
          value: margin,
          ownerSlug: winner.slug,
          opponentSlug: (winner === a ? b : a).slug,
          stillStands: false,
        });
      }
      widestMargin = Math.max(widestMargin, margin);
      tightestMargin = Math.min(tightestMargin, margin);
    }

    for (const p of ev.players) {
      // Not gated on `first`: the player baseline starts empty in 2024 anyway,
      // so the earliest lineup genuinely establishes rather than beats.
      if (bestPlayer > -Infinity && p.points > bestPlayer) {
        add(ev.id, {
          kind: "player-week",
          label: "Best single week by a player in league history",
          value: p.points,
          ownerSlug: p.slug,
          playerId: p.playerId,
          stillStands: false,
        });
      }
      bestPlayer = Math.max(bestPlayer, p.points);
    }
  });

  // A mark still stands if nothing later beat it — i.e. it equals the final
  // running extreme.
  const finals: Record<AtTheTimeFlag["kind"], number> = {
    "weekly-high": bestScore,
    "weekly-low": worstScore,
    blowout: widestMargin,
    narrowest: tightestMargin,
    "player-week": bestPlayer,
    "combined-high": highestCombined,
    "combined-low": lowestCombined,
  };
  for (const flags of Object.values(out)) {
    for (const f of flags) f.stillStands = f.value === finals[f.kind];
  }

  return out;
}

// --- main -------------------------------------------------------------------

async function deriveLeague(league: ScriptLeague): Promise<void> {
  CONFIG_DIR = configDir(league.slug);
  DATA_DIR = dataDir(league.slug);
  RAW_DIR = join(DATA_DIR, "raw");
  DERIVED_DIR = join(DATA_DIR, "derived");

  log.step(`■ ${league.name} (${league.slug})`);

  config = readJson<LeagueConfig>(join(CONFIG_DIR, "league.json"))!;
  const idx = readJson<SeasonIndex>(join(RAW_DIR, "seasons.json"));
  if (!idx) throw new Error(`data/${league.slug}/raw/seasons.json missing — run \`npm run sync\` first`);
  index = idx;

  overrides = readJson<Overrides>(join(CONFIG_DIR, "keeper-overrides.json")) ?? {};
  ignoredPlayers = new Set(overrides.ignorePlayerIds ?? []);
  loadOwners();

  log.step("Loading seasons");
  const loaded: SeasonData[] = [];
  const throughByseason = new Map<number, number>();
  for (const s of index.seasons) {
    const season = Number(s.season);
    const d = loadSeason(season);
    if (!d) {
      log.skip(`${season} — no finalized data yet (${s.status})`);
      continue;
    }
    throughByseason.set(season, s.finalizedThroughWeek);
    loaded.push(d);
    log.info(`${season}: ${d.rosters.length} rosters, ${d.picks.length} picks, ${d.matchups.size} weeks`);
  }
  loaded.sort((a, b) => a.season - b.season);

  log.step("Deriving");
  const summaries = [
    ...importedSeasons(),
    ...loaded.map((d) => summariseSeason(d, throughByseason.get(d.season) ?? 0)),
  ].sort((a, b) => a.season - b.season);
  const matchups = [
    ...importedMatchups(),
    ...loaded.flatMap((d) => buildMatchups(d, throughByseason.get(d.season) ?? 0)),
  ];
  const ownerRecords = buildOwnerRecords(summaries, matchups);
  const records = buildLeagueRecords(matchups, summaries);
  // A redraft league has no contracts to reconstruct. Gated on the feature flag
  // rather than on the per-season rules so the whole subsystem is off in one place.
  // Loaded before the keeper pass: a completed draft advances every contract to
  // the next cycle, so the resolver needs it.
  const draftOnly = loadDraftOnly(loaded);
  const keepers = league.features?.keepers
    ? resolveKeepers(loaded, draftOnly)
    : { perSeason: [], final: [] };
  const atTheTime = recordsAtTheTime(summaries, matchups);
  const playerHistory = buildPlayerHistory(loaded);
  const drafts = [...buildDraftHistory(loaded), ...draftOnlySeasons(draftOnly)].sort(
    (a, b) => a.season - b.season || a.pickNo - b.pickNo,
  );
  const weeklyLows = buildWeeklyLows(matchups, summaries);

  for (const o of owners.values()) o.seasons = [...new Set(o.seasons)].sort();

  log.step("Writing derived data");
  const out = (name: string, value: unknown) => {
    writeJson(join(DERIVED_DIR, name), value);
    log.write(`derived/${name}`);
  };

  out("owners.json", [...owners.values()]);
  out("seasons.json", summaries);
  out("matchups.json", matchups);
  out("owner-records.json", ownerRecords);
  out("records.json", records);
  out("at-the-time.json", atTheTime);
  out("keepers.json", keepers);
  out("player-history.json", playerHistory);
  out("drafts.json", drafts);
  out("weekly-lows.json", weeklyLows);
  writeReplay(league.slug, summaries, matchups);

  log.step("Summary");
  for (const s of summaries) {
    const name = (slug: string | null) => (slug ? owners.get(slug)?.name : "—");
    log.info(
      `${s.season}: champ ${name(s.champion)} · 2nd ${name(s.runnerUp)} · 3rd ${name(s.thirdPlace)} · last ${name(s.lastPlace)}`,
    );
  }
  log.info(`${matchups.length} matchups, ${keepers.final.length} tracked contracts`);

}

for (const league of resolveLeagues(process.argv.slice(2))) {
  await deriveLeague(league);
}
