import type { OwnerRecord } from "./types.ts";

/**
 * The league's default all-time ordering: wins, then hardware.
 *
 * Wins lead because they are the thing every owner accumulates every season, so
 * the table opens on something comparable. Titles then 2nds then 3rds break ties,
 * which is the order they are worth.
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
    b.wins - a.wins ||
    b.championships - a.championships ||
    b.runnerUps - a.runnerUps ||
    b.thirdPlaces - a.thirdPlaces ||
    b.winPct - a.winPct
  );
}
