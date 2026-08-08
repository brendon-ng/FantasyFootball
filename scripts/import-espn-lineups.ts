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

import { log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";
import {
  ESPN_POS,
  PRO_TEAM,
  fetchEspn,
  matchPlayer,
  ownerByTeam,
  sleeperIndex,
  type EspnPlayer,
  type LeagueFile,
} from "./lib/espn.ts";

/**
 * ESPN's lineup slot ids.
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
  settings?: {
    /** matchupPeriodId -> the scoring periods it covers. Usually 1:1. */
    scheduleSettings?: { matchupPeriods?: Record<string, number[]> };
  };
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


async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const onlyLeague = arg("league");
  const onlySeason = arg("season") ? Number(arg("season")) : null;
  const weekArg = arg("week");

  const idx = sleeperIndex();
  log.info(`Sleeper index: ${idx.byEspn.size} espn ids, ${idx.byName.size} names`);
  const via = { "espn-id": 0, defence: 0, name: 0, nickname: 0, none: 0 };
  /** Every match where the two databases disagree on the name, for eyeballing. */
  const renames = new Set<string>();
  const ambiguous = new Set<string>();

  for (const league of resolveLeagues(onlyLeague ? [`--league=${onlyLeague}`] : [])) {
    const slug = league.slug;
    const cfg = readJson<LeagueFile>(join(configDir(slug), "league.json"));
    const espnIds = cfg?.espnLeagueIds ?? {};
    if (!Object.keys(espnIds).length) {
      log.skip(`${slug}: no espnLeagueIds in league.json`);
      continue;
    }

    const manualDir = join(dataDir(slug), "manual");
    const dir = join(manualDir, "lineups");


    const seasons = onlySeason
      ? [onlySeason]
      : [2019, 2020, 2021, 2022, 2023].filter((y) =>
          existsSync(join(manualDir, `${y}.json`)),
        );

    for (const season of seasons) {
      const espnId = espnIds[String(season)];
      if (!espnId) {
        log.skip(`${slug} ${season}: no ESPN league id configured`);
        continue;
      }
      const manual = readJson<{
        finalWeek?: number;
        matchups?: Array<{
          week: number;
          home: { ownerSlug: string; points: number };
          away: { ownerSlug: string; points: number };
          weeks?: Array<{
            week: number;
            home: { ownerSlug: string; points: number };
            away: { ownerSlug: string; points: number };
          }>;
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
      // PER WEEK, not per matchup. A multi-week playoff matchup posts a combined
      // total, and checking a one-week lineup against it would be short by a
      // whole week — so the per-week split is what a lineup is verified against.
      const expected = new Map<string, number>();
      for (const g of manual?.matchups ?? []) {
        for (const w of g.weeks ?? [{ week: g.week, home: g.home, away: g.away }]) {
          for (const side of [w.home, w.away]) expected.set(`${w.week}:${side.ownerSlug}`, side.points);
        }
      }

      const unmatched = new Set<string>();
      for (const week of weeks) {
        const data = await fetchEspn<EspnLeague>(
          espnId,
          season,
          `view=mBoxscore&view=mRoster&view=mTeam&scoringPeriodId=${week}`,
        );
        const owners = ownerByTeam(data, cfg, `${slug} ${season}`);

        /**
         * The game covering THIS SCORING PERIOD, which is not the game whose
         * `matchupPeriodId` equals it.
         *
         * A multi-week playoff matchup covers two scoring periods, so period 15
         * belongs to matchup period 14 — while matchup period 15 is the NEXT
         * round, weeks 16-17, with no roster filled in yet. Matching on the id
         * therefore picked the wrong game and every lineup came back as zero.
         */
        const periods = data.settings?.scheduleSettings?.matchupPeriods ?? {};
        const covers = (mp?: number) =>
          mp === undefined ? [] : (periods[String(mp)] ?? [mp]);
        const games = data.schedule.filter((g) => covers(g.matchupPeriodId).includes(week));
        if (!games.length) {
          log.skip(`${slug} ${season} week ${week}: no matchups`);
          continue;
        }

        const forWeek: Record<string, LineupSide> = {};
        for (const g of games) {
          for (const side of [g.home, g.away]) {
            if (!side) continue;
            const owner = owners.get(side.teamId);
            if (!owner) continue;
            const entries = side.rosterForCurrentScoringPeriod?.entries ?? [];

            const playerPoints: Record<string, number> = {};
            const started: Array<{ slot: number; id: string }> = [];
            for (const e of entries) {
              const m = matchPlayer(e.playerPoolEntry.player, idx);
              via[m.via] += 1;
              if (m.renamed) renames.add(`${m.renamed} (${m.via})`);
              if (m.ambiguous) ambiguous.add(m.ambiguous);
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

      // PRUNE, because this file is merged into rather than rewritten. A rerun
      // that resolves a player better — as switching from name matching to
      // `espn_id` did — leaves the old `espn-` entry behind, and sync would then
      // publish a player nothing references. Keep only what a lineup still uses.
      const referenced = new Set(
        Object.values(out.weeks).flatMap((byOwner) =>
          Object.values(byOwner).flatMap((side) => Object.keys(side.playerPoints)),
        ),
      );
      for (const id of Object.keys(out.espnOnly)) {
        if (!referenced.has(id)) delete out.espnOnly[id];
      }

      writeJson(outPath, out);
      log.info(
        `matched via espn id ${via["espn-id"]}, defence ${via.defence}, ` +
          `name ${via.name}, nickname ${via.nickname}, unmatched ${via.none}`,
      );
      // PRINTED, NOT BURIED. A wrong name match still sums to the right team
      // score, so the reconciliation check cannot catch it — these are the only
      // rows a human has to look at.
      if (ambiguous.size) {
        log.warn(`${slug} ${season}: SAME name, more than one candidate — verify these —`);
        for (const a of [...ambiguous].sort()) log.warn(`      ${a}`);
      }
      if (renames.size) {
        log.warn(`${slug} ${season}: matched under a different name, check these —`);
        for (const r of [...renames].sort()) log.warn(`      ${r}`);
      }
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
