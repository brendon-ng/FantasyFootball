/**
 * Reading a rivalry: the record, and who is on a run.
 *
 * Pure, and separate from `lib/data.ts`, so the same numbers can be quoted on a
 * finished matchup ("the series BEFORE this game") and on a fixture ("the series
 * going INTO it"). Those are the same question asked at different moments, and
 * two implementations of it would eventually disagree about a tie.
 *
 * Everything here is from A's point of view — `a` is whichever owner the caller
 * asked about first, matching `getMeetings(a, b)`.
 */

import type { Meeting } from "./data.ts";

export interface SeriesTally {
  wins: number;
  losses: number;
  ties: number;
  played: number;
}

export function seriesTally(games: Meeting[]): SeriesTally {
  let wins = 0, losses = 0, ties = 0;
  for (const g of games) {
    if (g.a.points === g.b.points) ties++;
    else if (g.a.points > g.b.points) wins++;
    else losses++;
  }
  return { wins, losses, ties, played: games.length };
}

export interface SeriesStreak {
  /** Whoever is on the run, or null when nobody is. */
  slug: string | null;
  run: number;
}

/**
 * The run one of them is on, walking into the next meeting.
 *
 * `getMeetings` returns NEWEST FIRST, so this walks forward from the most recent
 * game and stops at the first one somebody else won. A TIE ENDS A STREAK — nobody
 * won it, so nobody carried anything into the next one.
 */
export function seriesStreak(games: Meeting[]): SeriesStreak {
  let slug: string | null = null;
  let run = 0;
  for (const g of games) {
    if (g.a.points === g.b.points) break;
    const winner = g.a.points > g.b.points ? g.a.ownerSlug : g.b.ownerSlug;
    if (slug === null) slug = winner;
    else if (winner !== slug) break;
    run += 1;
  }
  return { slug: run ? slug : null, run };
}

/**
 * The longest run by either owner anywhere in the series.
 *
 * Direction does not matter — a run is the same length read from either end — so
 * this works on `getMeetings`' newest-first order without reversing it. A TIE
 * BREAKS A RUN, the same rule `seriesStreak` uses for the current one.
 */
export function longestStreak(games: Meeting[]): SeriesStreak {
  let best: SeriesStreak = { slug: null, run: 0 };
  let slug: string | null = null;
  let run = 0;
  for (const g of games) {
    if (g.a.points === g.b.points) {
      slug = null;
      run = 0;
      continue;
    }
    const winner = g.a.points > g.b.points ? g.a.ownerSlug : g.b.ownerSlug;
    run = winner === slug ? run + 1 : 1;
    slug = winner;
    if (run > best.run) best = { slug: winner, run };
  }
  return best;
}

/**
 * "Jake leads 5-4", "All square at 3-3", "First meeting".
 *
 * ONE PHRASING, because this shows up on the home strip, the preview header and
 * the series tiles, and three versions of it read as three different facts.
 * `firstName` is passed in rather than looked up, since only the caller can reach
 * the owner map.
 */
export function seriesLine(
  games: Meeting[],
  a: string,
  b: string,
  firstName: (slug: string) => string,
): string {
  const { wins, losses, ties, played } = seriesTally(games);
  if (!played) return "First meeting";
  const suffix = ties ? `-${ties}` : "";
  if (wins === losses) return `All square at ${wins}-${losses}${suffix}`;
  const leader = wins > losses ? a : b;
  return `${firstName(leader)} leads ${Math.max(wins, losses)}-${Math.min(wins, losses)}${suffix}`;
}

/**
 * "Sam has won 3 straight" / "Sam won the last one", or null.
 *
 * A RUN ONLY READS AS A RUN FROM TWO — "won 1 straight" is not a streak, it is
 * the previous game, so it gets its own wording.
 */
export function streakLine(
  streak: SeriesStreak,
  firstName: (slug: string) => string,
  tense: "present" | "past" = "present",
): string | null {
  if (!streak.slug || !streak.run) return null;
  const who = firstName(streak.slug);
  if (streak.run === 1) return `${who} won the last one`;
  return tense === "past"
    ? `${who} had won ${streak.run} straight`
    : `${who} has won ${streak.run} straight`;
}

/**
 * A head-to-head record written LEADER FIRST, and who leads.
 *
 * "6-3, Eric Wong leads" rather than "3-6, Brendon Ng perspective". A bare pair
 * of numbers has to be anchored to somebody, and anchoring it to whoever the URL
 * happened to name first makes the reader work out which of them is winning —
 * on a page where that is the single thing being asked. Putting the bigger number
 * first and naming the leader says it outright, and reads the same from either
 * side of the fixture.
 *
 * Ties keep their third number, still leader first: "6-3-1".
 */
export function seriesRecord(
  games: Meeting[],
  a: string,
  b: string,
  nameOf: (slug: string) => string,
): { value: string; sub: string | undefined; leader: string | null } {
  const { wins, losses, ties, played } = seriesTally(games);
  if (!played) return { value: "First meeting", sub: undefined, leader: null };
  const suffix = ties ? `-${ties}` : "";
  if (wins === losses) {
    return { value: `${wins}-${losses}${suffix}`, sub: "Dead even", leader: null };
  }
  const leader = wins > losses ? a : b;
  return {
    value: `${Math.max(wins, losses)}-${Math.min(wins, losses)}${suffix}`,
    sub: `${nameOf(leader)} leads`,
    leader,
  };
}
