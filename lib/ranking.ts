import type { OwnerRecord } from "./types.ts";

/**
 * The league's default all-time ordering.
 *
 * Titles, wins, average finish, 2nds, 3rds, playoff appearances — in that order.
 * Titles lead, so this ranks achievement over accumulation: one title outranks a
 * higher-win owner with none. The rest resolve owners who are genuinely level,
 * moving from overall performance down to individual honours.
 *
 * TWO TERMS DO NOT SORT DESCENDING LIKE THE OTHERS. Average finish is ascending,
 * since 1st beats 8th, and a null (an owner with no finished season) must sort
 * LAST rather than first — a naive numeric compare gets both backwards.
 *
 * Playoff appearances is a COUNT, not the rate the table's Playoffs column sorts
 * by. Consistent with 2nds and 3rds also being counts; average finish already
 * carries the rate-shaped signal earlier in the chain.
 *
 * ONE definition, used by the derive script (so `owner-records.json` ships in this
 * order), the home page leaderboard, and the sortable all-time table's default
 * view. Three copies of a tie-break chain would drift.
 *
 * Win% is the final tie-break purely for determinism — without it the result
 * depends on input array order, which changes between runs.
 */
export function byAllTimeRank(a: OwnerRecord, b: OwnerRecord): number {
  return (
    b.championships - a.championships ||
    b.wins - a.wins ||
    (a.averageFinish ?? Infinity) - (b.averageFinish ?? Infinity) ||
    b.runnerUps - a.runnerUps ||
    b.thirdPlaces - a.thirdPlaces ||
    b.playoffAppearances - a.playoffAppearances ||
    b.winPct - a.winPct
  );
}
