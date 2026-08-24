/**
 * Whether the NFL has finished playing a week.
 *
 * THE FANTASY PLATFORMS ANSWER THIS A DAY LATE. Both settle a week on Tuesday,
 * once stat corrections are in — Sleeper by advancing `last_scored_leg`, ESPN by
 * calling `winner`. That is the right moment to trust a number, and the wrong
 * moment to admit a game is over: a reader looking at Monday's final whistle
 * knows perfectly well who won.
 *
 * So finality has two tiers, and the callers that want the earlier one say so.
 * The scoreboard below is the earlier one: when every game in the week reads
 * `completed`, no lineup can score another point.
 *
 * THE COST OF BEING EARLY IS STAT CORRECTIONS. A score can still shift by a
 * fraction on Tuesday, so anything DERIVED from a total — a record threshold, a
 * margin — can flip for a day. Only use this where being a day early is worth
 * that, and never for deciding what to archive.
 *
 * ESPN'S PUBLIC SCOREBOARD, NOT THE FANTASY API, and it is used for BOTH
 * providers: the NFL's clock has nothing to do with which platform a league
 * happens to run on, and Sleeper publishes no equivalent. Unauthenticated, and
 * it sends `access-control-allow-origin: *`, so a static site can read it.
 *
 * FAILS SOFT TO NULL. Null means "no opinion", never "unfinished" — every
 * caller already has the platform's own answer to fall back on, so a scoreboard
 * outage costs immediacy and nothing else.
 */

import { fetchRetry } from "./retry.ts";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export interface NflWeekState {
  /** Every game in the week has finished. */
  final: boolean;
  /** At least one game has kicked off. */
  started: boolean;
}

interface ScoreboardEvent {
  status?: { type?: { completed?: boolean; state?: string } };
}

export async function fetchNflWeek(
  season: number,
  week: number,
): Promise<NflWeekState | null> {
  /**
   * `seasontype=2` is the regular season, and every fantasy week lands in it —
   * even a championship, which is NFL week 17. Asking for the postseason would
   * return the NFL's own playoffs, which no fantasy league plays.
   */
  const res = await fetchRetry(
    `${SCOREBOARD}?dates=${season}&seasontype=2&week=${week}`,
  );
  if (!res?.ok) return null;

  let events: ScoreboardEvent[] | undefined;
  try {
    events = ((await res.json()) as { events?: ScoreboardEvent[] }).events;
  } catch {
    return null;
  }
  // A week with no games is a week ESPN does not have; "all zero games are
  // complete" is vacuously true and would be read as "the week is over".
  if (!events?.length) return null;

  return {
    final: events.every((e) => e.status?.type?.completed === true),
    started: events.some((e) => e.status?.type?.state !== "pre"),
  };
}
