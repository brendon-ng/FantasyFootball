import type { OwnerRecord } from "./types.ts";

/**
 * The league's default all-time ordering: hardware, then wins.
 *
 * Titles lead, then 2nds, then 3rds, with total wins breaking ties among owners
 * who have won the same silverware. A consequence worth knowing: a short-tenured
 * owner with one title outranks a long-tenured one with none, because this ranks
 * achievement rather than accumulation.
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
    b.runnerUps - a.runnerUps ||
    b.thirdPlaces - a.thirdPlaces ||
    b.wins - a.wins ||
    b.winPct - a.winPct
  );
}
