import type { OwnerRecord } from "./types.ts";

/**
 * The league's default all-time ordering: titles, then wins, then average finish.
 *
 * Titles lead, so this ranks achievement over accumulation — an owner with one
 * title outranks a higher-win owner with none. Wins break ties among equally
 * decorated owners, and average finish settles the rest, rewarding consistency
 * over a single good year.
 *
 * Average finish sorts ASCENDING, since 1st is better than 8th. A null (an owner
 * with no finished season) sorts last rather than first, which a naive numeric
 * compare would get backwards.
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
    b.winPct - a.winPct
  );
}
