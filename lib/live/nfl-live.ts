/**
 * Which NFL games are being played RIGHT NOW.
 *
 * `nfl-schedule.ts` answers "is that team's game over", which is all the record
 * chips need. It cannot answer "is it on at this moment", because Sleeper's
 * schedule only ever reads `pre_game`, `complete` or `canceled` — a game in the
 * third quarter is still `pre_game` there. So a lineup built on it alone cannot
 * tell a player who has not kicked off from one who is mid-game on nothing.
 *
 * ESPN's public scoreboard does carry it, as `status.type.state`:
 * `pre` | `in` | `post`. Unauthenticated, `access-control-allow-origin: *`, and
 * 16.5KB gzipped for a whole week — the raw 212KB figure that got an earlier
 * ESPN scoreboard rejected is uncompressed and not what a browser transfers.
 *
 * USED FOR BOTH PROVIDERS, like the schedule beside it: which platform a league
 * runs on has nothing to do with when the NFL plays.
 *
 * FETCHED ONLY INSIDE A LIVE, UNSCORED WEEK and never under a phase mock — the
 * callers gate it, on exactly the rules `useMatchupSettled` already uses. A
 * reader outside a game window never downloads it.
 *
 * FAILS SOFT TO NULL, meaning "no opinion". Every caller degrades to the
 * schedule's coarser done/pending, which is never wrong, only less specific.
 */

import { fetchRetry } from "./retry.ts";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** `pre` not started · `in` being played · `post` finished. */
export type TeamGameState = "pre" | "in" | "post";

/**
 * ESPN spells one team differently from Sleeper, and the lineups are keyed on
 * Sleeper's spelling. Checked across all 32: this is the only disagreement.
 */
const ABBR: Record<string, string> = { WSH: "WAS" };

interface RawScoreboard {
  events?: Array<{
    competitions?: Array<{
      status?: { type?: { state?: string } };
      competitors?: Array<{ team?: { abbreviation?: string } }>;
    }>;
  }>;
}

/** Cached per season+week: several rows on one page ask the same question. */
const cache = new Map<string, Promise<Record<string, TeamGameState> | null>>();

export function fetchNflLive(
  season: number,
  week: number,
): Promise<Record<string, TeamGameState> | null> {
  const key = `${season}:${week}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async () => {
    // `seasontype=2` is the regular season. The postseason is 3, and asking for
    // the wrong one returns a different week's games rather than an error.
    const res = await fetchRetry(
      `${SCOREBOARD}?dates=${season}&seasontype=2&week=${week}`,
    );
    if (!res?.ok) return null;
    let data: RawScoreboard;
    try {
      data = (await res.json()) as RawScoreboard;
    } catch {
      return null;
    }

    const out: Record<string, TeamGameState> = {};
    for (const e of data.events ?? []) {
      const comp = e.competitions?.[0];
      const raw = comp?.status?.type?.state;
      if (raw !== "pre" && raw !== "in" && raw !== "post") continue;
      for (const c of comp?.competitors ?? []) {
        const abbr = c.team?.abbreviation;
        if (abbr) out[ABBR[abbr] ?? abbr] = raw;
      }
    }
    return Object.keys(out).length ? out : null;
  })();

  cache.set(key, p);
  return p;
}
