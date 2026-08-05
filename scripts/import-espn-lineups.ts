/**
 * Recovers ESPN-era LINEUPS from ESPN's own read API.
 *
 * The MHTML importer (`import-espn.ts`) recovered standings, brackets and weekly
 * scoreboards from archived pages, which is everything those pages contained.
 * Lineups were never on them — so 2019-23 had team scores and nothing under them,
 * and every player-level surface carried "Sleeper-era only" as a caveat.
 *
 * The API behind fantasy.espn.com needs no auth for this league and returns the
 * whole box score, so the caveat is removable rather than rewordable. The linked
 * page is a React shell with no data in its HTML; this endpoint is what it calls.
 *
 * IDS ARE NORMALISED TO SLEEPER'S. A player is one entity across the site — a
 * player page, a keeper contract and a 2019 lineup row must all be the same id,
 * or "times kept" and "best week" quietly describe different people. ESPN ids are
 * kept only for players Sleeper has never heard of, prefixed `espn-` so they are
 * obviously foreign and can never collide with Sleeper's numeric ids.
 *
 * INCREMENTAL AND IDEMPOTENT. `--season`/`--week` narrow a run; a rerun rewrites
 * the same weeks identically, so a partial import is safe to resume and safe to
 * repeat.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { CACHE_DIR, log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";

const API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

/**
 * ESPN's slot ids. Only the ones a fantasy football league can use.
 *
 * 20 and 21 are the bench and injured reserve — everything else was STARTED and
 * its points counted, which is the distinction the record book depends on.
 */
const SLOT: Record<number, string> = {
  0: "QB", 1: "TQB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE",
  7: "OP", 16: "D/ST", 17: "K", 18: "P", 19: "HC", 20: "BE", 21: "IR", 23: "FLEX",
};
const BENCH = new Set([20, 21]);

/** The order a lineup reads in, so `starters` lines up with `rosterPositions`. */
const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 23, 16, 17, 18, 19];

/**
 * ESPN pro-team id -> Sleeper team abbreviation.
 *
 * Two deliberate disagreements: ESPN says WSH where Sleeper says WAS, and ESPN's
 * id 13 was OAK in 2019 but Sleeper keys its defence on the CURRENT abbreviation,
 * LV. Mapping to Sleeper's spelling is the whole point — a 2019 Raiders defence
 * and a 2024 one have to be the same player page.
 */
const PRO_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};

interface EspnPlayer {
  id: number;
  fullName: string;
  defaultPositionId?: number;
  proTeamId?: number;
}
interface EspnEntry {
  lineupSlotId: number;
  playerPoolEntry: { appliedStatTotal?: number; player: EspnPlayer };
}
interface EspnSide {
  teamId: number;
  totalPoints?: number;
  rosterForCurrentScoringPeriod?: { entries?: EspnEntry[] } | null;
}
interface EspnLeague {
  schedule: Array<{ matchupPeriodId?: number; home?: EspnSide; away?: EspnSide }>;
  teams: Array<{ id: number; primaryOwner?: string; owners?: string[] }>;
  members?: Array<{ id: string; firstName?: string; lastName?: string }>;
}

interface LeagueFile {
  espnLeagueId?: string | number;
  owners?: Array<{ slug: string; firstName: string; lastName: string; espnNames?: string[] }>;
}

interface SleeperPlayer {
  /** Sleeper's own cross-reference to ESPN. Present for ~55% of the map. */
  espn_id?: number | string | null;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  team?: string | null;
  search_full_name?: string;
}

/** What one team did in one week. */
export interface LineupSide {
  /** Started players, in slot order. Positionally aligned to `rosterPositions`. */
  starters: string[];
  /** player id -> points, starters and bench alike. */
  playerPoints: Record<string, number>;
}

export interface SeasonLineups {
  season: number;
  /** Slot labels for the started positions, in the same order as `starters`. */
  rosterPositions: string[];
  /** week -> ownerSlug -> lineup. */
  weeks: Record<string, Record<string, LineupSide>>;
  /**
   * Players Sleeper has never had, keyed by their `espn-` id.
   *
   * Carried here rather than in `data/players.json`, which `sync` rebuilds from
   * Sleeper and would erase. Sync reads this as a fallback.
   */
  espnOnly: Record<string, { full_name: string; position: string | null; team: string | null }>;
}

const ESPN_POS: Record<number, string> = {
  1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF",
};

/**
 * A name reduced to what two databases can agree on.
 *
 * Sleeper publishes `search_full_name` in exactly this shape, so matching against
 * it is a lookup rather than a fuzzy comparison. Suffixes go because the two
 * disagree constantly — "DJ Chark Jr." against "D.J. Chark" is one player.
 */
const normalise = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

interface Index {
  /** ESPN player id -> Sleeper id. The exact join; everything else is a guess. */
  byEspn: Map<string, string>;
  byName: Map<string, Array<{ id: string; p: SleeperPlayer }>>;
}

/**
 * Sleeper's whole player DB, including everyone who has since retired.
 *
 * TWO INDEXES, AND THE ID ONE WINS. Sleeper publishes `espn_id` on about 55% of
 * its map, which makes the join exact for those players and immune to the thing
 * name matching keeps getting wrong: people are not stored under the name they
 * played under. Nyheim Hines is "Nyheim Miller-Hines", Will Fuller V is "William
 * Fuller", Robby Anderson is under a later name again — three misses in a single
 * week of 2019, all silently filed as unknown players.
 */
function sleeperIndex(): Index {
  const path = join(CACHE_DIR, "players-nfl.json");
  const all = readJson<Record<string, SleeperPlayer>>(path);
  if (!all) {
    throw new Error(
      `No cached Sleeper player map at ${path}. Run \`npm run sync\` once to fetch it.`,
    );
  }
  const byEspn = new Map<string, string>();
  const byName = new Map<string, Array<{ id: string; p: SleeperPlayer }>>();
  for (const [id, p] of Object.entries(all)) {
    if (p.espn_id) byEspn.set(String(p.espn_id), id);
    // Both spellings indexed: `search_full_name` keeps suffixes ("willfullerv")
    // while `normalise` strips them, and either can be the one that matches.
    for (const key of [
      p.search_full_name,
      normalise(p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`),
    ]) {
      if (!key) continue;
      const bucket = byName.get(key) ?? [];
      if (!bucket.some((b) => b.id === id)) bucket.push({ id, p });
      byName.set(key, bucket);
    }
  }
  return { byEspn, byName };
}

interface MatchResult {
  id: string;
  matched: boolean;
  /** How it was matched, for the run summary. */
  via: "espn-id" | "defence" | "name" | "none";
}

/**
 * The Sleeper id for an ESPN player.
 *
 * Position narrows an ambiguous name before team does, because a player changes
 * team far more often than position and this data spans seven years. Where the
 * name is unique the extra checks never run.
 */
function matchPlayer(pl: EspnPlayer, idx: Index): MatchResult {
  const pos = ESPN_POS[pl.defaultPositionId ?? -1] ?? null;

  // A defence is a TEAM, not a person: Sleeper keys it on the abbreviation, so
  // there is nothing to name-match and the pro-team id answers it exactly.
  if (pos === "DEF") {
    const abbr = PRO_TEAM[pl.proTeamId ?? -1];
    if (abbr) return { id: abbr, matched: true, via: "defence" };
  }

  const exact = idx.byEspn.get(String(pl.id));
  if (exact) return { id: exact, matched: true, via: "espn-id" };

  const cands = idx.byName.get(normalise(pl.fullName)) ?? [];
  if (cands.length) {
    // Position narrows an ambiguous name before team does: a player changes team
    // far more often than position, and this data spans seven years.
    const byPos = pos ? cands.filter((c) => c.p.position === pos) : [];
    const pool = byPos.length ? byPos : cands;
    const team = PRO_TEAM[pl.proTeamId ?? -1];
    const byTeam = team ? pool.filter((c) => c.p.team === team) : [];
    return { id: (byTeam[0] ?? pool[0]).id, matched: true, via: "name" };
  }
  return { id: `espn-${pl.id}`, matched: false, via: "none" };
}

async function fetchWeek(leagueId: string, season: number, week: number): Promise<EspnLeague> {
  const url =
    `${API}/${season}/segments/0/leagues/${leagueId}` +
    `?view=mBoxscore&view=mRoster&view=mTeam&scoringPeriodId=${week}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${season} week ${week}: HTTP ${res.status}`);
  return (await res.json()) as EspnLeague;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const onlyLeague = arg("league");
  const onlySeason = arg("season") ? Number(arg("season")) : null;
  const weekArg = arg("week");

  const idx = sleeperIndex();
  log.info(`Sleeper index: ${idx.byEspn.size} espn ids, ${idx.byName.size} names`);
  const via = { "espn-id": 0, defence: 0, name: 0, none: 0 };

  for (const league of resolveLeagues(onlyLeague ? [`--league=${onlyLeague}`] : [])) {
    const slug = league.slug;
    const cfg = readJson<LeagueFile>(join(configDir(slug), "league.json"));
    const espnId = cfg?.espnLeagueId;
    if (!espnId) {
      log.skip(`${slug}: no espnLeagueId in league.json`);
      continue;
    }

    const manualDir = join(dataDir(slug), "manual");
    const dir = join(manualDir, "lineups");

    // Owner identity comes from ESPN's member records, matched on real names —
    // team names change mid-season and are not a stable key.
    const byName = new Map<string, string>();
    for (const o of cfg.owners ?? []) {
      byName.set(normalise(`${o.firstName} ${o.lastName}`), o.slug);
      for (const alias of o.espnNames ?? []) byName.set(normalise(alias), o.slug);
    }

    const seasons = onlySeason
      ? [onlySeason]
      : [2019, 2020, 2021, 2022, 2023].filter((y) =>
          existsSync(join(manualDir, `${y}.json`)),
        );

    for (const season of seasons) {
      const manual = readJson<{
        finalWeek?: number;
        matchups?: Array<{
          week: number;
          home: { ownerSlug: string; points: number };
          away: { ownerSlug: string; points: number };
        }>;
      }>(join(manualDir, `${season}.json`));
      const last = manual?.finalWeek ?? 17;
      const weeks = weekArg
        ? weekArg.split(",").map(Number)
        : Array.from({ length: last }, (_, i) => i + 1);

      const outPath = join(dir, `${season}.json`);
      const existing = readJson<SeasonLineups>(outPath);
      const out: SeasonLineups = existing ?? {
        season,
        rosterPositions: [],
        weeks: {},
        espnOnly: {},
      };

      // The score each team actually posted, from the already-verified scoreboard
      // import. Every recovered lineup is checked against it below.
      const expected = new Map<string, number>();
      for (const g of manual?.matchups ?? []) {
        for (const side of [g.home, g.away]) expected.set(`${g.week}:${side.ownerSlug}`, side.points);
      }

      const unmatched = new Set<string>();
      for (const week of weeks) {
        const data = await fetchWeek(String(espnId), season, week);

        const ownerByTeam = new Map<number, string>();
        const members = new Map(
          (data.members ?? []).map((m) => [
            m.id,
            normalise(`${m.firstName ?? ""} ${m.lastName ?? ""}`),
          ]),
        );
        for (const t of data.teams) {
          const key = members.get(t.primaryOwner ?? t.owners?.[0] ?? "");
          const owner = key ? byName.get(key) : undefined;
          if (!owner) {
            throw new Error(
              `${slug} ${season}: ESPN team ${t.id} has no owner in config ` +
                `(member "${key ?? "?"}"). Add them to league.json, with espnNames if the label differs.`,
            );
          }
          ownerByTeam.set(t.id, owner);
        }

        const games = data.schedule.filter((g) => g.matchupPeriodId === week);
        if (!games.length) {
          log.skip(`${slug} ${season} week ${week}: no matchups`);
          continue;
        }

        const forWeek: Record<string, LineupSide> = {};
        for (const g of games) {
          for (const side of [g.home, g.away]) {
            if (!side) continue;
            const owner = ownerByTeam.get(side.teamId);
            if (!owner) continue;
            const entries = side.rosterForCurrentScoringPeriod?.entries ?? [];

            const playerPoints: Record<string, number> = {};
            const started: Array<{ slot: number; id: string }> = [];
            for (const e of entries) {
              const m = matchPlayer(e.playerPoolEntry.player, idx);
              via[m.via] += 1;
              if (!m.matched) {
                unmatched.add(e.playerPoolEntry.player.fullName);
                out.espnOnly[m.id] = {
                  full_name: e.playerPoolEntry.player.fullName,
                  position: ESPN_POS[e.playerPoolEntry.player.defaultPositionId ?? -1] ?? null,
                  team: PRO_TEAM[e.playerPoolEntry.player.proTeamId ?? -1] ?? null,
                };
              }
              playerPoints[m.id] = Number((e.playerPoolEntry.appliedStatTotal ?? 0).toFixed(2));
              if (!BENCH.has(e.lineupSlotId)) started.push({ slot: e.lineupSlotId, id: m.id });
            }

            started.sort(
              (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
            );
            if (!out.rosterPositions.length) {
              out.rosterPositions = started.map((s) => SLOT[s.slot] ?? String(s.slot));
            }
            forWeek[owner] = { starters: started.map((s) => s.id), playerPoints };
          }
        }
        // THE INVARIANT, enforced here rather than trusted. Started points must
        // equal the score the team posted, which is already reconciled against
        // ESPN's own standings page. It is the check that catches the failure
        // this import is most exposed to: ESPN's `matchupPeriodId` and
        // `scoringPeriodId` are not the same number in every postseason format,
        // and attaching week 15's roster to week 14's game would otherwise look
        // completely plausible.
        const wrong: string[] = [];
        for (const [owner, side] of Object.entries(forWeek)) {
          const want = expected.get(`${week}:${owner}`);
          if (want == null) continue;
          const got = side.starters.reduce((t, id) => t + (side.playerPoints[id] ?? 0), 0);
          if (Math.abs(got - want) > 0.02) {
            wrong.push(`${owner} lineup ${got.toFixed(2)} vs scoreboard ${want.toFixed(2)}`);
          }
        }
        if (wrong.length) {
          throw new Error(
            `${slug} ${season} week ${week}: started points do not match the scoreboard —\n    ` +
              wrong.join("\n    "),
          );
        }

        out.weeks[String(week)] = forWeek;
        const checked = Object.keys(forWeek).filter((o) => expected.has(`${week}:${o}`)).length;
        log.info(
          `${slug} ${season} week ${week}: ${Object.keys(forWeek).length} lineups` +
            ` (${checked} reconciled)`,
        );
      }

      writeJson(outPath, out);
      log.info(
        `matched via espn id ${via["espn-id"]}, defence ${via.defence}, ` +
          `name ${via.name}, unmatched ${via.none}`,
      );
      if (unmatched.size) {
        log.warn(
          `${slug} ${season}: ${unmatched.size} player(s) not in Sleeper, kept under espn- ids: ` +
            [...unmatched].slice(0, 12).join(", ") +
            (unmatched.size > 12 ? ", …" : ""),
        );
      }
    }
  }
}

await main();
