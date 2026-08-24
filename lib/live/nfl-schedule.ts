/**
 * Whether the NFL has finished playing — per game, not just per week.
 *
 * THE FANTASY PLATFORMS SETTLE A WEEK A DAY LATE. Both wait until Tuesday, once
 * stat corrections are in — Sleeper by advancing `last_scored_leg`, ESPN by
 * calling `winner`. That is the right moment to trust a number and the wrong
 * moment to admit a game is over: on Sunday night, a matchup whose every starter
 * has finished playing is decided, and everybody watching knows it.
 *
 * So this is the earliest tier of finality, and it is per TEAM, which is what
 * makes it useful: a matchup with nobody in the Monday night game is settled on
 * Sunday evening, hours before the week is.
 *
 * SLEEPER'S SCHEDULE, USED FOR BOTH PROVIDERS, because the NFL's clock has
 * nothing to do with which platform a league runs on. One request covers the
 * WHOLE season (~27KB) rather than one per week, it is unauthenticated, and it
 * sends `access-control-allow-origin: *`.
 *
 *   {"status":"complete","date":"2025-09-07","home":"ATL","week":1,
 *    "game_id":"202510102","away":"TB"}
 *
 * THE COST OF BEING EARLY IS STAT CORRECTIONS. A total can still shift by a
 * fraction on Tuesday, so anything derived from one — a record threshold, a
 * margin — can flip for a day. Worth it for a chip, never for deciding what to
 * archive: `sync` keeps waiting on the platform.
 *
 * FAILS SOFT TO NULL, which means "no opinion" and never "unfinished" — every
 * caller has the platform's own answer to fall back on, so an outage costs
 * immediacy and nothing else.
 */

import { fetchRetry } from "./retry.ts";

const SCHEDULE = "https://api.sleeper.app/schedule/nfl/regular";

interface RawGame {
  status?: string;
  week?: number;
  home?: string;
  away?: string;
}

export interface NflWeekState {
  /** Every game in the week has finished. */
  final: boolean;
  /** At least one game has kicked off. */
  started: boolean;
  /**
   * NFL team -> whether that team's game this week is over.
   *
   * A team ABSENT from this map has no game — a bye — which is not the same as
   * pending, and `teamsSettled` treats it as nothing to wait for.
   */
  doneByTeam: Record<string, boolean>;
}

/**
 * Cached per season on the module: it is one document for the year, and several
 * hooks ask for it on the same render.
 *
 * A season fetched mid-week goes stale as games finish, which is fine — the
 * whole live layer is refetched on navigation and reload, and being late here
 * only delays a chip.
 */
const cache = new Map<number, Promise<Map<number, NflWeekState> | null>>();

function loadSeason(season: number): Promise<Map<number, NflWeekState> | null> {
  const existing = cache.get(season);
  if (existing) return existing;

  const p = (async () => {
    const res = await fetchRetry(`${SCHEDULE}/${season}`);
    if (!res?.ok) return null;
    let games: RawGame[];
    try {
      games = (await res.json()) as RawGame[];
    } catch {
      return null;
    }
    if (!Array.isArray(games) || !games.length) return null;

    const byWeek = new Map<number, NflWeekState>();
    for (const g of games) {
      if (!g.week) continue;
      const wk = byWeek.get(g.week) ?? { final: true, started: false, doneByTeam: {} };
      // A CANCELLED GAME IS OVER, not pending. Nobody in it will score again, so
      // waiting on it would hold a matchup open for the rest of the season.
      const done = g.status === "complete" || g.status === "canceled";
      if (!done) wk.final = false;
      if (g.status !== "pre_game") wk.started = true;
      for (const team of [g.home, g.away]) if (team) wk.doneByTeam[team] = done;
      byWeek.set(g.week, wk);
    }
    return byWeek;
  })();

  cache.set(season, p);
  return p;
}

export async function fetchNflWeek(
  season: number,
  week: number,
): Promise<NflWeekState | null> {
  const byWeek = await loadSeason(season);
  return byWeek?.get(week) ?? null;
}

/**
 * Have all of these teams finished playing this week?
 *
 * NULL MEANS "CANNOT SAY" and is never "yes". An empty list of teams is also
 * null rather than vacuously true: it means the caller could not work out who
 * was playing, and answering "settled" to that would put a record chip on a
 * matchup mid-afternoon.
 *
 * A team the schedule does not list is on a BYE — nothing to wait for.
 */
export function teamsSettled(
  wk: NflWeekState | null,
  teams: string[] | null | undefined,
): boolean | null {
  if (!wk || !teams?.length) return null;
  return teams.every((t) => wk.doneByTeam[t] !== false);
}
