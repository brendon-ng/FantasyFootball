/**
 * What NFL team a player was on IN A GIVEN SEASON.
 *
 * `players.json` carries one team per player — whatever Sleeper says today — so a
 * 2019 lineup listed Carson Wentz as MIN and Odell Beckham as NYG. Fine on a
 * keeper board or a player profile, which are about the player now; wrong on a
 * matchup page, which is a record of a game that happened.
 *
 * NEITHER OBVIOUS SOURCE WORKS, and both look like they do:
 *
 * ESPN's fantasy player object holds a LIVE team reference, not a snapshot. Ask
 * for the 2020 week 8 box score and Carson Wentz still comes back as IND — the
 * team he joined the following February. Same for the season player universe,
 * which ignores `scoringPeriodId` entirely and answers identically for week 1 and
 * week 17.
 *
 * `core.api` team rosters are worse: `seasons/2019/teams/21/athletes` returns a
 * list whose first entry is Saquon Barkley, a Giant. It is not filtered by team.
 *
 * What IS season-scoped is the athlete itself: `seasons/<year>/athletes/<id>`
 * returns a team ref under that season's path, and gets Wentz right for every
 * year he moved. So this fetches one athlete per player-season — about two
 * thousand across the league's history, cached in the output file so a rerun
 * costs nothing.
 *
 * SHARED ACROSS LEAGUES, like `players.json`: which team someone played for is a
 * fact about the NFL, not about a fantasy league.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { SHARED_DATA_DIR, log, readJson, writeJson } from "./lib/io.ts";
import { dataDir, resolveLeagues } from "./lib/league.ts";
import { PRO_TEAM, espnPlayerUniverse, normalise } from "./lib/espn.ts";

const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons";
/** Polite, and enough: two thousand lookups finish in a couple of minutes. */
const CONCURRENCY = 8;

interface Teams {
  /** Season baseline: `season -> playerId -> team`. */
  seasons: Record<string, Record<string, string>>;
  /** Week-level exceptions, written by `sync` as each week finalizes. */
  weekly: Record<string, Record<string, Record<string, string>>>;
  /**
   * `season -> team -> bye week`.
   *
   * A player whose NFL team was idle could not have scored, so counting that week
   * as a zero punishes an owner for the schedule. Needed to leave those weeks out
   * of per-game averages entirely.
   */
  byes: Record<string, Record<string, number>>;
}

interface Matchup {
  season: number;
  home: { playerPoints: Record<string, number> };
  away: { playerPoints: Record<string, number> };
}

/** A team id under a season path, e.g. ".../seasons/2019/teams/21?lang=en". */
async function teamOf(season: number, espnId: string): Promise<string | null> {
  const res = await fetch(`${CORE}/${season}/athletes/${espnId}`);
  if (!res.ok) return null;
  const a = (await res.json()) as { team?: { $ref?: string } };
  const ref = a.team?.$ref;
  const id = ref?.match(/\/teams\/(\d+)/)?.[1];
  return id ? (PRO_TEAM[Number(id)] ?? null) : null;
}

async function pool<T>(items: T[], run: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) await run(items[i++]);
    }),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const existing = readJson<Teams>(join(SHARED_DATA_DIR, "player-teams.json"));
  const out: Teams = {
    seasons: force ? {} : (existing?.seasons ?? {}),
    // Never rebuilt here: only `sync` can know a week's teams, and only at the
    // time. Dropping them on a re-run would throw away the one thing that cannot
    // be recovered later.
    weekly: existing?.weekly ?? {},
    byes: existing?.byes ?? {},
  };

  // Every player-season any league has on record, bench included — a bench row
  // shows a team badge too.
  const wanted = new Map<number, Set<string>>();
  for (const league of resolveLeagues(args)) {
    const path = join(dataDir(league.slug), "derived", "matchups.json");
    if (!existsSync(path)) continue;
    for (const m of readJson<Matchup[]>(path) ?? []) {
      const set = wanted.get(m.season) ?? new Set<string>();
      for (const side of [m.home, m.away]) {
        for (const id of Object.keys(side.playerPoints)) set.add(id);
      }
      wanted.set(m.season, set);
    }
  }

  const cache = readJson<
    Record<
      string,
      { espn_id?: number | string | null; full_name?: string; first_name?: string; last_name?: string }
    >
  >(join(".cache", "players-nfl.json"));
  const espnOf = new Map<string, string>();
  for (const [id, p] of Object.entries(cache ?? {})) {
    if (p.espn_id) espnOf.set(id, String(p.espn_id));
  }

  // One call per season: ESPN publishes each pro team's bye alongside its schedule.
  for (const season of [...wanted.keys()].sort()) {
    if (!out.byes[String(season)]) {
      const res = await fetch(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}?view=proTeamSchedules_wl`,
      );
      if (res.ok) {
        const d = (await res.json()) as {
          settings?: { proTeams?: Array<{ id: number; byeWeek?: number }> };
        };
        const map: Record<string, number> = {};
        for (const t of d.settings?.proTeams ?? []) {
          const abbr = PRO_TEAM[t.id];
          if (abbr && t.byeWeek) map[abbr] = t.byeWeek;
        }
        if (Object.keys(map).length) out.byes[String(season)] = map;
        log.info(`${season}: ${Object.keys(map).length} bye weeks`);
      }
    }
    // LOUD, because the failure is otherwise invisible: with no byes on file the
    // site silently goes back to counting a bye as a zero against every average,
    // and nothing on a page says so. This is the one thing in the forward pipeline
    // that still needs ESPN — Sleeper's player record has no bye field at all.
    if (!Object.keys(out.byes[String(season)] ?? {}).length) {
      log.warn(
        `${season}: NO BYE WEEKS. Per-game averages will count byes as zeros. ` +
          `Check https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}?view=proTeamSchedules_wl`,
      );
    }
  }

  for (const season of [...wanted.keys()].sort()) {
    const ids = [...wanted.get(season)!];
    const have = (out.seasons[String(season)] ??= {});

    // A team defence IS a team; its abbreviation is its id and cannot change.
    const people = ids.filter((id) => !/^[A-Z]{2,4}$/.test(id));
    for (const id of ids) if (!people.includes(id)) have[id] = id;

    // Sleeper's espn_id thins out after about 2020, so anyone missing one is
    // matched by name against that season's ESPN player list — which carries the
    // id even where it carries the wrong team.
    const todo = people.filter((id) => !have[id]);
    if (!todo.length) {
      log.skip(`${season}: already complete (${people.length} players)`);
      continue;
    }
    const byName = new Map<string, string>();
    if (todo.some((id) => !espnOf.has(id))) {
      for (const p of (await espnPlayerUniverse(season)).values()) {
        byName.set(normalise(p.fullName ?? ""), String(p.id));
      }
    }

    let found = 0;
    let missed = 0;
    await pool(todo, async (id) => {
      const espnId =
        espnOf.get(id) ??
        byName.get(normalise(cacheName(cache, id))) ??
        null;
      if (!espnId) {
        missed += 1;
        return;
      }
      const team = await teamOf(season, espnId);
      if (team) {
        have[id] = team;
        found += 1;
      } else {
        missed += 1;
      }
    });

    writeJson(join(SHARED_DATA_DIR, "player-teams.json"), out);
    log.info(
      `${season}: ${Object.keys(have).length}/${ids.length} known` +
        ` (+${found} this run, ${missed} unresolved)`,
    );
  }
}

/** Sleeper's own name for a player, for the name-matching fallback. */
function cacheName(
  cache: Record<string, { full_name?: string; first_name?: string; last_name?: string }> | null,
  id: string,
): string {
  const p = cache?.[id];
  if (!p) return "";
  return p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

await main();
