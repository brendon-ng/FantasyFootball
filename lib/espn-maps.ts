/**
 * ESPN's numeric vocabulary for teams and positions.
 *
 * SHARED BETWEEN THE IMPORTERS AND THE BROWSER PROVIDER, which is the whole
 * reason it is not in `scripts/lib/espn.ts` where it started: that module reaches
 * for `node:path` and the build cache, so the live layer cannot import it, and a
 * second copy of a 32-entry lookup is a second thing to update the next time a
 * franchise moves city.
 *
 * Dependency-free on purpose — it ships to the client.
 */

/** ESPN pro-team id -> NFL abbreviation. 31 and 32 are unused by ESPN. */
export const PRO_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};

/** ESPN `defaultPositionId` -> the position this site names it. */
export const ESPN_POS: Record<number, string> = {
  1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF",
};

/**
 * The order a roster reads in, not alphabetical.
 *
 * Anything unrecognised sorts last rather than first, so a position ESPN adds
 * later lands at the bottom of a list instead of above the quarterback.
 */
export const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

export const positionRank = (pos: string | null | undefined): number => {
  const i = pos ? POSITION_ORDER.indexOf(pos) : -1;
  return i === -1 ? POSITION_ORDER.length : i;
};
