/**
 * Which NFL week the site should be SHOWING, for every league.
 *
 * Sleeper publishes two different numbers and the distinction is the whole
 * point of this file:
 *
 *   week          the week the NFL is now in — flips the moment the last game
 *                 of the previous one ends
 *   display_week  the week a reader should be looking at — stays on the
 *                 finished week until the next slate is nearly here
 *
 * On a Tuesday in September those read 2 and 1. Sleeper's own app shows 1, and
 * so does this site for a Sleeper league.
 *
 * ESPN HAS NO EQUIVALENT. `currentMatchupPeriod` and `latestScoringPeriod` both
 * roll over as soon as a period ends, so an ESPN league jumped to week 2 on the
 * Tuesday and spent three days showing ten fixtures with no scores in them,
 * while the Sleeper leagues beside it still showed week 1's results. Same site,
 * same afternoon, two different answers to "what week is it".
 *
 * So the answer comes from one place for everybody. It is a fact about the NFL
 * rather than about a league, and Sleeper gives it away unauthenticated — the
 * same reason `nfl-schedule.ts` and `nfl-clock.ts` already read Sleeper for
 * every league including the ESPN ones.
 *
 * FAILS SOFT TO NULL, meaning "no opinion": the caller keeps whatever its own
 * platform said, which is exactly the behaviour this replaces.
 */

import { fetchRetry } from "./retry.ts";

const STATE = "https://api.sleeper.app/v1/state/nfl";

export interface NflWeek {
  season: number;
  /** The week to show. See above — NOT the week the NFL is in. */
  displayWeek: number;
}

/** One request per page, however many leagues or panels ask. */
let cache: Promise<NflWeek | null> | null = null;

export function fetchNflWeek(): Promise<NflWeek | null> {
  if (cache) return cache;
  cache = (async () => {
    const res = await fetchRetry(STATE);
    if (!res?.ok) return null;
    try {
      const st = (await res.json()) as {
        season?: string;
        week?: number;
        display_week?: number;
      };
      const season = Number(st?.season);
      // `|| week` because display_week is absent out of season.
      const displayWeek = st?.display_week || st?.week || 0;
      if (!season || !displayWeek) return null;
      return { season, displayWeek };
    } catch {
      return null;
    }
  })();
  return cache;
}
