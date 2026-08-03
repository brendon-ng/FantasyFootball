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
} from "../lib/types.ts";
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
import { DATA_DIR, RAW_DIR, log, readJson, writeJson } from "./lib/io.ts";

const CONFIG_DIR = join(DATA_DIR, "..", "config");
const DERIVED_DIR = join(DATA_DIR, "derived");

interface OwnerConfig {
  slug?: string;
  userId: string;
  firstName: string;
  lastName: string;
  coOwnerOf?: string;
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

const config = readJson<LeagueConfig>(join(CONFIG_DIR, "league.json"))!;
const index = readJson<SeasonIndex>(join(RAW_DIR, "seasons.json"));
if (!index) throw new Error("data/raw/seasons.json missing — run `npm run sync` first");

const rulesFor = (season: number): Rules => {
  const r = readJson<Rules>(join(CONFIG_DIR, "rules", `${season}.json`));
  if (!r) throw new Error(`No rules file for ${season} — add config/rules/${season}.json`);
  return r;
};

// --- owner identity ---------------------------------------------------------

/** userId -> primary owner slug. Co-owners collapse onto the primary. */
const slugByUserId = new Map<string, string>();
const owners = new Map<string, Owner>();

for (const o of config.owners) {
  if (o.coOwnerOf) continue;
  owners.set(o.slug!, {
    slug: o.slug!,
    name: `${o.firstName} ${o.lastName}`,
    firstName: o.firstName,
    userId: o.userId,
    coOwners: [],
    seasons: [],
  });
  slugByUserId.set(o.userId, o.slug!);
}
for (const o of config.owners) {
  if (!o.coOwnerOf) continue;
  const primary = owners.get(o.coOwnerOf);
  if (!primary) throw new Error(`${o.firstName} lists unknown coOwnerOf "${o.coOwnerOf}"`);
  primary.coOwners.push(`${o.firstName} ${o.lastName}`);
  slugByUserId.set(o.userId, o.coOwnerOf);
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
  /** roster_id -> owner slug for this season. */
  rosterToOwner: Map<number, string>;
  rules: Rules;
}

function loadSeason(season: number): SeasonData | null {
  const dir = join(RAW_DIR, String(season));
  const league = readJson<SleeperLeague>(join(dir, "league.json"));
  if (!league) return null;

  const rosters = readJson<SleeperRoster[]>(join(dir, "rosters.json")) ?? [];
  const rosterToOwner = new Map<number, string>();
  for (const r of rosters) {
    const slug = r.owner_id ? slugByUserId.get(r.owner_id) : undefined;
    if (!slug) {
      throw new Error(
        `${season}: roster ${r.roster_id} has owner_id ${r.owner_id}, which is not in config/league.json. Add them.`,
      );
    }
    rosterToOwner.set(r.roster_id, slug);
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

  return {
    season,
    league,
    users: readJson<SleeperUser[]>(join(dir, "users.json")) ?? [],
    rosters,
    draft: readJson<SleeperDraft>(join(dir, "draft.json")),
    picks: readJson<SleeperDraftPick[]>(join(dir, "draft-picks.json")) ?? [],
    winners: readJson<SleeperBracketMatch[]>(join(dir, "winners-bracket.json")) ?? [],
    losers: readJson<SleeperBracketMatch[]>(join(dir, "losers-bracket.json")) ?? [],
    matchups,
    transactions,
    rosterToOwner,
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
 * Sleeper's `p` field is placement *within that bracket*. In the winners bracket
 * that is the overall place. In the losers bracket it is offset by the number of
 * playoff teams — losers-bracket `p:1` is really 7th overall in a 6-team playoff.
 */
function buildBracket(
  raw: SleeperBracketMatch[],
  rosterToOwner: Map<number, string>,
  placeOffset: number,
): BracketMatch[] {
  const slug = (rid: number | null | undefined) =>
    rid == null ? null : (rosterToOwner.get(rid) ?? null);

  return raw
    .slice()
    .sort((a, b) => a.r - b.r || a.m - b.m)
    .map((m) => ({
      round: m.r,
      matchId: m.m,
      team1: slug(m.t1),
      team2: slug(m.t2),
      winner: slug(m.w),
      loser: slug(m.l),
      team1From: m.t1_from
        ? { winnerOf: m.t1_from.w, loserOf: m.t1_from.l }
        : null,
      team2From: m.t2_from
        ? { winnerOf: m.t2_from.w, loserOf: m.t2_from.l }
        : null,
      placesFor: m.p == null ? null : [m.p + placeOffset, m.p + placeOffset + 1],
    }));
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

  const winners = buildBracket(d.winners, d.rosterToOwner, 0);
  const losers = buildBracket(d.losers, d.rosterToOwner, d.rules.playoffTeams);

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
    regularSeasonWeeks: d.rules.regularSeasonWeeks,
    finalizedThroughWeek,
    standings,
    winnersBracket: winners,
    losersBracket: losers,
    champion: at(1),
    runnerUp: at(2),
    thirdPlace: at(3),
    lastPlace: at(d.rules.playoffTeams + 4),
  };
}

// --- matchups ---------------------------------------------------------------

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
function resolveKeepers(seasons: SeasonData[]): {
  perSeason: SeasonKeepers[];
  final: KeeperContract[];
} {
  const overrides =
    readJson<Record<string, Partial<KeeperContract>>>(
      join(CONFIG_DIR, "keeper-overrides.json"),
    ) ?? {};

  /** playerId -> live contract. Survives drops so a re-add can consult it. */
  const contracts = new Map<string, KeeperContract>();
  const perSeason: SeasonKeepers[] = [];

  for (const d of seasons) {
    const { keepers: kr } = d.rules;
    const kept: string[] = [];

    // 1. Draft. Keeper picks continue an existing contract; everything else
    //    starts a fresh one at the round it was taken.
    for (const p of d.picks.slice().sort((a, b) => a.pick_no - b.pick_no)) {
      const owner = d.rosterToOwner.get(Number(p.roster_id)) ?? null;
      const existing = contracts.get(p.player_id);

      if (p.is_keeper && existing) {
        existing.ownerSlug = owner;
        existing.keepsUsed += 1;
        existing.provenance.push(
          `${d.season}: kept at R${existing.round} (keep ${existing.keepsUsed} of ${kr.maxKeepsAtOriginalCost})`,
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
          provenance: [`${d.season}: drafted R${p.round} pick ${p.pick_no}`],
        });
      }
    }

    // 2. In-season transactions, chronologically. A drop leaves the contract in
    //    place (owner cleared) so a later re-add can consult its original round.
    const weeks = [...d.transactions.keys()].sort((a, b) => a - b);
    for (const week of weeks) {
      const txns = (d.transactions.get(week) ?? [])
        .filter((t) => t.status === "complete")
        .sort((a, b) => a.created - b.created);

      for (const t of txns) {
        for (const [playerId, rosterId] of Object.entries(t.drops ?? {})) {
          const c = contracts.get(playerId);
          if (!c) continue;
          c.ownerSlug = null;
          c.provenance.push(
            `${d.season} wk${week}: dropped by ${d.rosterToOwner.get(rosterId) ?? "?"}`,
          );
        }

        for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
          const owner = d.rosterToOwner.get(rosterId) ?? null;
          const prior = contracts.get(playerId);

          // A trade transfers the contract untouched (bylaws 1.7.2.5). A
          // commissioner move is a roster correction under bylaws 1.3.1, not a
          // real acquisition, so it must not reset a contract either.
          if (t.type === "trade" || t.type === "commissioner") {
            if (prior) {
              prior.ownerSlug = owner;
              prior.provenance.push(
                t.type === "trade"
                  ? `${d.season} wk${week}: traded to ${owner} (contract inherited)`
                  : `${d.season} wk${week}: commissioner move to ${owner} (contract unchanged)`,
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
              provenance: [`${d.season} wk${week}: undrafted FA pickup — R${faRound} value`],
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
                `${d.season} wk${week}: re-acquired via ${t.type} — min(R${faRound}, R${base}) = R${newRound}, contract reset`,
              ],
            });
          }
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
      for (const pid of [...(r.players ?? []), ...(r.reserve ?? [])]) ownedBy.set(pid, slug);
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

  for (const [playerId, patch] of Object.entries(overrides)) {
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

function buildOwnerRecords(
  summaries: SeasonSummary[],
  matchups: Matchup[],
): OwnerRecord[] {
  const rec = new Map<string, OwnerRecord>();
  const blank = (slug: string): OwnerRecord => ({
    ownerSlug: slug,
    wins: 0, losses: 0, ties: 0, winPct: 0,
    pointsFor: 0, pointsAgainst: 0,
    championships: 0, runnerUps: 0, thirdPlaces: 0, lastPlaces: 0,
    playoffAppearances: 0, seasonsPlayed: 0,
    averageFinish: null, bestFinish: null, worstFinish: null,
    finishes: [], vs: {},
  });
  for (const slug of owners.keys()) rec.set(slug, blank(slug));

  // Regular-season head-to-head only: playoff and consolation games are tracked
  // separately via placements, and mixing them distorts "record against".
  for (const m of matchups) {
    if (m.kind !== "regular") continue;
    for (const [self, opp] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      const r = rec.get(self.ownerSlug);
      if (!r) continue;
      const h2h = (r.vs[opp.ownerSlug] ??= {
        wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
      });
      h2h.pointsFor = round2(h2h.pointsFor + self.points);
      h2h.pointsAgainst = round2(h2h.pointsAgainst + opp.points);
      if (m.winner === null) h2h.ties++;
      else if (m.winner === self.ownerSlug) h2h.wins++;
      else h2h.losses++;
    }
  }

  for (const s of summaries) {
    if (!s.finalized) continue;
    for (const row of s.standings) {
      const r = rec.get(row.ownerSlug);
      if (!r) continue;
      r.seasonsPlayed++;
      r.wins += row.wins;
      r.losses += row.losses;
      r.ties += row.ties;
      r.pointsFor = round2(r.pointsFor + row.pointsFor);
      r.pointsAgainst = round2(r.pointsAgainst + row.pointsAgainst);
      if (row.madePlayoffs) r.playoffAppearances++;
      r.finishes.push({ season: s.season, place: row.finalPlace, seed: row.seed });
      owners.get(row.ownerSlug)!.seasons.push(s.season);
    }
    if (s.champion) rec.get(s.champion)!.championships++;
    if (s.runnerUp) rec.get(s.runnerUp)!.runnerUps++;
    if (s.thirdPlace) rec.get(s.thirdPlace)!.thirdPlaces++;
    if (s.lastPlace) rec.get(s.lastPlace)!.lastPlaces++;
  }

  for (const r of rec.values()) {
    const games = r.wins + r.losses + r.ties;
    r.winPct = games ? round2((r.wins + r.ties / 2) / games) : 0;
    const places = r.finishes.map((f) => f.place).filter((p): p is number => p != null);
    if (places.length) {
      r.averageFinish = round2(places.reduce((a, b) => a + b, 0) / places.length);
      r.bestFinish = Math.min(...places);
      r.worstFinish = Math.max(...places);
    }
  }

  return [...rec.values()].sort(
    (a, b) => b.championships - a.championships || b.winPct - a.winPct,
  );
}

function buildLeagueRecords(matchups: Matchup[]): LeagueRecords {
  const scores: ScoreRecord[] = [];
  const playerScores: PlayerScoreRecord[] = [];
  const margins: Array<ScoreRecord & { margin: number }> = [];

  for (const m of matchups) {
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
  };
}

// --- transactions & drafts --------------------------------------------------

function buildPlayerHistory(seasons: SeasonData[]): Record<string, PlayerTransaction[]> {
  const hist: Record<string, PlayerTransaction[]> = {};
  const push = (playerId: string, t: PlayerTransaction) => (hist[playerId] ??= []).push(t);

  for (const d of seasons) {
    for (const p of d.picks) {
      push(p.player_id, {
        season: d.season,
        week: 0,
        type: "draft",
        action: "draft",
        ownerSlug: d.rosterToOwner.get(Number(p.roster_id)) ?? null,
        counterpartySlug: null,
        faabSpent: null,
        timestamp: d.draft?.start_time ?? 0,
        round: p.round,
        pickNo: p.pick_no,
      });
    }

    for (const [week, txns] of d.transactions) {
      for (const t of txns) {
        if (t.status !== "complete") continue;
        const bid = t.settings?.waiver_bid ?? null;
        const parties = t.roster_ids.map((r) => d.rosterToOwner.get(r) ?? null);

        for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
          const owner = d.rosterToOwner.get(rosterId) ?? null;
          push(playerId, {
            season: d.season, week, type: t.type, action: "add",
            ownerSlug: owner,
            counterpartySlug: parties.find((p) => p && p !== owner) ?? null,
            faabSpent: t.type === "waiver" ? bid : null,
            timestamp: t.status_updated,
          });
        }
        for (const [playerId, rosterId] of Object.entries(t.drops ?? {})) {
          const owner = d.rosterToOwner.get(rosterId) ?? null;
          push(playerId, {
            season: d.season, week, type: t.type, action: "drop",
            ownerSlug: owner,
            counterpartySlug: parties.find((p) => p && p !== owner) ?? null,
            faabSpent: null,
            timestamp: t.status_updated,
          });
        }
      }
    }
  }

  for (const list of Object.values(hist)) {
    list.sort((a, b) => a.season - b.season || a.week - b.week || a.timestamp - b.timestamp);
  }
  return hist;
}

function buildDraftHistory(seasons: SeasonData[]): DraftPickRecord[] {
  return seasons.flatMap((d) =>
    d.picks.map((p) => ({
      season: d.season,
      round: p.round,
      pickNo: p.pick_no,
      draftSlot: p.draft_slot,
      ownerSlug: d.rosterToOwner.get(Number(p.roster_id)) ?? null,
      playerId: p.player_id,
      isKeeper: Boolean(p.is_keeper),
    })),
  );
}

// --- main -------------------------------------------------------------------

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
const summaries = loaded.map((d) => summariseSeason(d, throughByseason.get(d.season) ?? 0));
const matchups = loaded.flatMap((d) => buildMatchups(d, throughByseason.get(d.season) ?? 0));
const ownerRecords = buildOwnerRecords(summaries, matchups);
const records = buildLeagueRecords(matchups);
const keepers = resolveKeepers(loaded);
const playerHistory = buildPlayerHistory(loaded);
const drafts = buildDraftHistory(loaded);

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
out("keepers.json", keepers);
out("player-history.json", playerHistory);
out("drafts.json", drafts);

log.step("Summary");
for (const s of summaries) {
  const name = (slug: string | null) => (slug ? owners.get(slug)?.name : "—");
  log.info(
    `${s.season}: champ ${name(s.champion)} · 2nd ${name(s.runnerUp)} · 3rd ${name(s.thirdPlace)} · last ${name(s.lastPlace)}`,
  );
}
log.info(`${matchups.length} matchups, ${keepers.final.length} tracked contracts`);
