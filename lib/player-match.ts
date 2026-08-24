/**
 * Matching a player across two databases that spell him differently.
 *
 * Sleeper is this site's id space, and ESPN is not. The importers bridge the two
 * at BUILD time with a three-tier resolver in `scripts/lib/espn.ts`; this module
 * is the part the BROWSER also needs, for the one surface that reads ESPN rosters
 * live — see `components/live-rosters.tsx`.
 *
 * WHY THE BROWSER NEEDS IT AT ALL. `public/espn-players.json` is Sleeper's own
 * `espn_id` field, and its coverage thins badly for players who arrived recently:
 * of apartment-401's 160 freshly drafted players it resolves 44. Name matching
 * takes that to 148, with the remaining 12 being genuine rookies the site has
 * never referenced and for whom no player page exists.
 *
 * Dependency-free: it ships to the client.
 */

import type { PlayerMeta } from "./types.ts";

/**
 * A name reduced to what two databases can agree on.
 *
 * Suffixes go because ESPN writes "James Cook III" and "Travis Etienne Jr." where
 * Sleeper writes neither; accents and punctuation go because "Amon-Ra St. Brown"
 * has to equal "amonrastbrown" either way round.
 *
 * SHARED WITH `scripts/lib/espn.ts`, which re-exports it. Two normalisers would
 * mean the build and the browser disagreeing about who a player is.
 */
export const normalise = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Normalised name -> every player in the index answering to it. */
export type NameIndex = Map<string, Array<{ id: string; meta: PlayerMeta }>>;

export function buildNameIndex(players: Record<string, PlayerMeta>): NameIndex {
  const byName: NameIndex = new Map();
  for (const [id, meta] of Object.entries(players)) {
    const key = normalise(meta.full_name ?? "");
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), { id, meta }]);
  }
  return byName;
}

/**
 * The player-index id for a live roster entry, or null if it cannot be pinned.
 *
 * Three tiers, in this order:
 *
 *   1. THE ID ITSELF, when the provider already handed over a Sleeper id.
 *   2. A DEFENCE IS A TEAM, not a person — Sleeper keys it on the NFL
 *      abbreviation, so the pro team answers it exactly with nothing to guess.
 *   3. NORMALISED NAME, narrowed by position.
 *
 * TIER 3 REFUSES TO GUESS. If the name still matches more than one player after
 * the position filter, it returns null and the row renders as plain text. A wrong
 * link here is worse than no link — it silently sends a reader to a different
 * person's career — and the narrowing costs nothing in practice: across all 160
 * of apartment-401's rostered players it produced zero ambiguous cases.
 *
 * Deliberately WITHOUT the importers' surname-plus-initial tier. That exists to
 * rescue nicknames in a historical import that must reconcile to the cent; here
 * the only cost of missing one is an unlinked name, so the looser tier buys
 * little and risks the invisible mismatch it was bounded to avoid.
 */
export function matchLivePlayer(
  entry: { id: string; name: string | null; position: string | null; team: string | null },
  players: Record<string, PlayerMeta>,
  index: NameIndex,
): string | null {
  if (players[entry.id]) return entry.id;

  if (entry.position === "DEF" && entry.team && players[entry.team]) return entry.team;

  const candidates = index.get(normalise(entry.name ?? ""));
  if (!candidates?.length) return null;

  const byPosition = entry.position
    ? candidates.filter((c) => c.meta.position === entry.position)
    : [];
  const pool = byPosition.length ? byPosition : candidates;
  return pool.length === 1 ? pool[0].id : null;
}
