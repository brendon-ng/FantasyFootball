/**
 * Sleeper's season projections.
 *
 * The missing axis. ADP says where the MARKET has a player; a projection says
 * what he is expected to DO. Those disagree constantly, and the disagreement is
 * the whole edge in a keeper league — a R11 contract on someone projected for 250
 * points is the asset, not the R11 contract on someone the market merely likes.
 *
 * AN UNDOCUMENTED ENDPOINT, and worth being honest about that:
 *
 *   https://api.sleeper.app/projections/nfl/<season>?season_type=regular
 *     &position[]=QB&order_by=pts_ppr
 *
 * It is not in docs.sleeper.com, which lists no projections resource at all. It
 * can change or vanish without notice. Treated the same way as the ADP scrape —
 * a nice-to-have layer that must never be load-bearing for a build, so
 * `getProjections()` returns an empty map when the file is absent.
 *
 * ONE REQUEST PER POSITION. `position[]` is repeatable but the response is
 * ordered per call, and asking for all four at once returns a single ranking
 * dominated by quarterbacks. Four calls is ~2.9MB total, which is cheap next to
 * the 38MB the outlook importer has to pull.
 *
 * ALL THREE SCORING FORMATS ARE STORED, not just this league's. `pts_ppr` is what
 * Den Ops uses today, but baking that choice into the data file would mean a
 * re-import if the league ever changed scoring, and the three cost nothing to
 * keep. The UI picks.
 *
 * PROJECTIONS ARE FOR THE FULL NFL SEASON — `gp` comes back as 18. This league
 * plays a 14-week regular season, so a season total is NOT a Den Ops points
 * total. Per-game is the comparable figure and is what the UI leads with.
 *
 *   npm run import:sleeper:projections
 *   npm run import:sleeper:projections -- --season=2027
 */

import { join } from "node:path";

import { SHARED_DATA_DIR, log, writeJson } from "./lib/io.ts";

const OUT = join(SHARED_DATA_DIR, "projections.json");
const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

/** Kept per player. Everything else in the payload is detail nobody reads. */
export interface Projection {
  gp: number | null;
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  rec: number | null;
  rec_yd: number | null;
  rec_td: number | null;
  rush_att: number | null;
  rush_yd: number | null;
  rush_td: number | null;
  pass_yd: number | null;
  pass_td: number | null;
  pass_int: number | null;
}

export interface ProjectionFile {
  season: number;
  capturedAt: string;
  source: string;
  /** Sleeper player id -> projection. Keyed by Sleeper's OWN id: no name matching. */
  players: Record<string, Projection>;
}

const args = new Set(process.argv.slice(2));
const arg = (name: string): string | null => {
  for (const a of args) if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  return null;
};
const season = Number(arg("season") ?? new Date().getFullYear());

interface Row {
  player_id: string;
  stats?: Record<string, number>;
}

const num = (v: number | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const players: Record<string, Projection> = {};
let rows = 0;

for (const pos of POSITIONS) {
  const url =
    `https://api.sleeper.app/projections/nfl/${season}` +
    `?season_type=regular&position[]=${pos}&order_by=pts_ppr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const data = (await res.json()) as Row[];
  rows += data.length;

  let kept = 0;
  for (const r of data) {
    const s = r.stats ?? {};
    // A row with no projected points is a body on a roster, not a projection.
    // Keeping them would triple the file to say nothing.
    if (!s.pts_ppr) continue;
    players[r.player_id] = {
      gp: num(s.gp),
      pts_ppr: num(s.pts_ppr),
      pts_half_ppr: num(s.pts_half_ppr),
      pts_std: num(s.pts_std),
      rec: num(s.rec),
      rec_yd: num(s.rec_yd),
      rec_td: num(s.rec_td),
      rush_att: num(s.rush_att),
      rush_yd: num(s.rush_yd),
      rush_td: num(s.rush_td),
      pass_yd: num(s.pass_yd),
      pass_td: num(s.pass_td),
      pass_int: num(s.pass_int),
    };
    kept++;
  }
  log.info(`${pos}: ${data.length} rows, ${kept} with projected points`);
}

writeJson(OUT, {
  season,
  capturedAt: new Date().toISOString(),
  source: `https://api.sleeper.app/projections/nfl/${season}?season_type=regular`,
  players,
} satisfies ProjectionFile);

log.write(
  `projections.json — ${Object.keys(players).length} players for ${season} (from ${rows} rows)`,
);
