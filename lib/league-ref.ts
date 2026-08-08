/**
 * Which service a season's live data comes from.
 *
 * A league is not a provider — a SEASON is. Den Ops spent 2019-2023 on ESPN and
 * moved to Sleeper in 2024, so asking "is this an ESPN league?" has no answer.
 * Every live lookup therefore starts from a season and gets back a ref saying
 * where to fetch and under what id.
 *
 * Dependency-free on purpose: this ships to the browser alongside the live
 * hooks, and it is also read by `sync` in Node. One definition, both ends.
 */

export type Provider = "sleeper" | "espn";

export interface LeagueRef {
  provider: Provider;
  /** Sleeper league id, or ESPN league id. Opaque to everything but the client. */
  id: string;
  /**
   * The season this ref addresses.
   *
   * CARRIED, not inferred. A Sleeper league id identifies a single season on its
   * own, so the id was enough; every ESPN URL puts the year in the path and
   * reuses one league id across all of them, so an id alone addresses nothing.
   */
  season: number;
}

/** The id maps as they appear in `config/leagues/<slug>/league.json`. */
export interface LeagueIdMaps {
  knownLeagueIds?: Record<string, string>;
  espnLeagueIds?: Record<string, string>;
}

/**
 * season -> where that season lives.
 *
 * SLEEPER WINS when a season appears in both maps. Den Ops lists ESPN ids for
 * 2019-2023 as provenance for its imported history, and those seasons are
 * frozen — nothing should ever go back and fetch them live. A season that is
 * genuinely being played is only ever in one map.
 */
export function refsBySeason(cfg: LeagueIdMaps): Record<string, LeagueRef> {
  const out: Record<string, LeagueRef> = {};
  for (const [season, id] of Object.entries(cfg.espnLeagueIds ?? {})) {
    if (id) out[season] = { provider: "espn", id, season: Number(season) };
  }
  for (const [season, id] of Object.entries(cfg.knownLeagueIds ?? {})) {
    if (id) out[season] = { provider: "sleeper", id, season: Number(season) };
  }
  return out;
}

/** The ref for one season, or null when the league did not exist that year. */
export function refFor(cfg: LeagueIdMaps, season: number | string): LeagueRef | null {
  return refsBySeason(cfg)[String(season)] ?? null;
}

/**
 * Compares two refs by value.
 *
 * The live hooks take a ref OBJECT, and an object literal rebuilt on every
 * render would restart the fetch on every render. Consumers memoise on this.
 */
export const sameRef = (a: LeagueRef | null, b: LeagueRef | null): boolean =>
  a?.provider === b?.provider && a?.id === b?.id && a?.season === b?.season;

/** Stable string form, for effect dependency arrays and cache keys. */
export const refKey = (ref: LeagueRef | null): string =>
  ref ? `${ref.provider}:${ref.id}:${ref.season}` : "";

/**
 * The providers that could plausibly own the season being played.
 *
 * ONLY THE LAST TWO SEASONS COUNT. Den Ops lists ESPN ids for 2019-2023 as
 * provenance for its imported history, and asking ESPN's clock about them
 * meant every Den Ops page load paid a round-trip to a service that could
 * never answer — 713ms before Sleeper was even asked. Two seasons rather than
 * one so a league mid-migration, with last year on one service and this year
 * on the other, still finds itself in either direction.
 */
export function candidateProviders(refs: Record<string, LeagueRef>): Provider[] {
  const seasons = Object.keys(refs).map(Number).filter(Number.isFinite);
  if (!seasons.length) return [];
  const newest = Math.max(...seasons);
  return [
    ...new Set(
      Object.values(refs)
        .filter((r) => r.season >= newest - 1)
        .map((r) => r.provider),
    ),
  ];
}

/** Where a provider's name shows up in the UI, e.g. "live from Sleeper". */
export const PROVIDER_NAME: Record<Provider, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
};
