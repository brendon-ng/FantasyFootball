import type { AdpEntry } from "@/lib/data";

/**
 * How an ADP is written down.
 *
 * THE DECIMAL, NOT THE LIST RANK. "15.4" is an average draft position — it says
 * a player goes late in round 2 of a ten-team draft, and the fractional part
 * carries real information about how tightly the market agrees. A rank of "#15"
 * says only that fourteen players are ahead of him.
 *
 * Shared because two surfaces show it (the lab's keeper selection and the
 * projected board's fill-ins) and a second copy of the fallback rule would
 * drift.
 *
 * SLEEPER'S NUMBER WINS where there is one: it is this league's platform and the
 * figure `AdpEntry.round` is derived from, so showing consensus beside a round
 * computed from Sleeper would be quietly inconsistent. 129 of 372 ranked players
 * have no Sleeper ADP and fall back to consensus — they are interleaved by rank
 * rather than dumped at the end, so leaving them blank would put holes through
 * the middle of every list. A consensus-only figure is marked, because the two
 * are not interchangeable.
 */
export const adpValue = (e: AdpEntry | undefined | null): string | null => {
  const v = e?.sleeper ?? e?.consensus ?? null;
  if (v == null) return null;
  // A decimal earns its place near the top, where 14.1 versus 14.9 is most of a
  // round. Past pick 100 it is noise on a number that already means "nobody is
  // drafting him" — "472.0" reads as false precision.
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
};

/**
 * Sort key for a list showing `adpValue`.
 *
 * MUST MATCH WHAT IS DISPLAYED. Sorting on `AdpEntry.rank` instead — beatadp's
 * consensus ordering — looks broken, because rank and Sleeper ADP disagree often
 * enough that the visible column jumps around (Jeremiyah Love at 19.7 landing
 * below Pickens at 23.1). A table sorted by an invisible key reads as a bug
 * however defensible the key is.
 *
 * The 129 entries with no Sleeper figure fall back to consensus, exactly as the
 * display does, so they interleave rather than scattering. Anything with neither
 * sorts last, then by rank so the order is still stable.
 */
export const adpSortKey = (e: AdpEntry | undefined | null): number =>
  e?.sleeper ?? e?.consensus ?? Number.POSITIVE_INFINITY;

/** True when the figure came from consensus because Sleeper has none. */
export const adpIsConsensusOnly = (e: AdpEntry | undefined | null): boolean =>
  Boolean(e && e.sleeper == null && e.consensus != null);

export const adpTitle = (e: AdpEntry | undefined | null): string => {
  if (!e) return "Not in the ADP list";
  if (e.sleeper != null) {
    return `Sleeper ADP ${e.sleeper.toFixed(1)} — round ${e.round}. Consensus ${
      e.consensus?.toFixed(1) ?? "n/a"
    }. Rank #${e.rank}.`;
  }
  if (e.consensus != null) {
    return `No Sleeper ADP. Consensus ${e.consensus.toFixed(1)}, rank #${e.rank} — an expired contract with no Sleeper figure falls back to the last round.`;
  }
  return `Unpriced, rank #${e.rank}`;
};

/**
 * Age today, from a stored date of birth.
 *
 * DERIVED AT READ TIME, never stored — see `PlayerMeta.birth_date`. Only ever
 * called from a component that mounts in the browser, so "today" is genuinely
 * today rather than whenever the site was last built.
 */
export function playerAge(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const month = now.getMonth() - dob.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 70 ? age : null;
}
