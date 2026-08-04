/**
 * The id of one matchup between two owners.
 *
 * Pure, and in its own module so CLIENT components can build matchup links —
 * `lib/data.ts` reads the filesystem and cannot ship to the browser.
 *
 * Deliberately not Sleeper's `matchup_id`, which is only unique within a week.
 * Slugs are sorted so the same game produces the same id from either side.
 */
export function meetingId(
  season: number,
  week: number | null,
  a: string,
  b: string,
): string {
  return `${season}-${week ?? 0}-${[a, b].sort().join("-vs-")}`;
}
