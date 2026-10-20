/**
 * Each NFL team's nickname and a colour to paint its players' cards with.
 *
 * THE COLOUR IS THE TEAM'S MOST RECOGNISABLE ONE, NOT ALWAYS ITS PRIMARY. A
 * card's header carries white text, and several primaries are near-black navy
 * or brown that vanish against this site's dark surface — the Bears, Browns,
 * Texans and Raiders read as one dark smear. Those take the accent people know
 * them by instead: Bears orange, Browns orange, Texans red, Raiders silver.
 *
 * Keyed by Sleeper's abbreviation, which is also a team defence's player id.
 */
export const NFL_TEAMS: Record<string, { name: string; color: string }> = {
  ARI: { name: "Cardinals", color: "#97233F" },
  ATL: { name: "Falcons", color: "#A71930" },
  BAL: { name: "Ravens", color: "#241773" },
  BUF: { name: "Bills", color: "#00338D" },
  CAR: { name: "Panthers", color: "#0085CA" },
  CHI: { name: "Bears", color: "#C83803" },
  CIN: { name: "Bengals", color: "#FB4F14" },
  CLE: { name: "Browns", color: "#FF3C00" },
  DAL: { name: "Cowboys", color: "#003594" },
  DEN: { name: "Broncos", color: "#FB4F14" },
  DET: { name: "Lions", color: "#0076B6" },
  GB: { name: "Packers", color: "#203731" },
  HOU: { name: "Texans", color: "#A71930" },
  IND: { name: "Colts", color: "#002C5F" },
  JAX: { name: "Jaguars", color: "#006778" },
  KC: { name: "Chiefs", color: "#E31837" },
  LAC: { name: "Chargers", color: "#0080C6" },
  LAR: { name: "Rams", color: "#003594" },
  LV: { name: "Raiders", color: "#5E6A71" },
  MIA: { name: "Dolphins", color: "#008E97" },
  MIN: { name: "Vikings", color: "#4F2683" },
  NE: { name: "Patriots", color: "#002244" },
  NO: { name: "Saints", color: "#9F8958" },
  NYG: { name: "Giants", color: "#0B2265" },
  NYJ: { name: "Jets", color: "#125740" },
  PHI: { name: "Eagles", color: "#004C54" },
  PIT: { name: "Steelers", color: "#C69214" },
  SEA: { name: "Seahawks", color: "#2A7A2F" },
  SF: { name: "49ers", color: "#AA0000" },
  TB: { name: "Buccaneers", color: "#D50A0A" },
  TEN: { name: "Titans", color: "#4B92DB" },
  WAS: { name: "Commanders", color: "#5A1414" },
};
