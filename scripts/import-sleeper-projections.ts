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
 * ONE REQUEST FOR EVERY POSITION AT ONCE, and that is load-bearing rather than a
 * saving. `rank` is the INDEX IN SLEEPER'S OWN RESPONSE, which is the RK column
 * its draft board shows — asking position by position throws the cross-position
 * ordering away, and re-sorting by ADP afterwards cannot recover it because ADP
 * ties are broken by something Sleeper does not publish. Drake London and
 * Omarion Hampton both sit at 15.1; the board puts London 15th and only the
 * response order says so.
 *
 * KICKERS AND DEFENCES ARE INCLUDED for the same reason: leaving them out would
 * shift every rank below the first one drafted.
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
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** Kept per player. Everything else in the payload is detail nobody reads. */
export interface Projection {
  /**
   * Sleeper's draft-board RK — its own ordering, not one we derive. See the note
   * on the single request above.
   */
  rank: number | null;
  /** Sleeper's PPR ADP, the figure `rank` orders by. */
  adp_ppr: number | null;
  gp?: number | null;
  pts_ppr?: number | null;
  pts_half_ppr?: number | null;
  pts_std?: number | null;
  rec?: number | null;
  rec_yd?: number | null;
  rec_td?: number | null;
  rush_att?: number | null;
  rush_yd?: number | null;
  rush_td?: number | null;
  pass_yd?: number | null;
  pass_td?: number | null;
  pass_int?: number | null;
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

const compact = (p: Projection): Projection =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)) as Projection;

const players: Record<string, Projection> = {};

const url =
  `https://api.sleeper.app/projections/nfl/${season}?season_type=regular&order_by=adp_ppr` +
  POSITIONS.map((p) => `&position%5B%5D=${p}`).join("");
log.info(`Fetching ${season} projections, all positions in one ranked request`);

const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
const data = (await res.json()) as Row[];
log.info(`${data.length} rows`);

/**
 * The rank is the row's place among players Sleeper actually prices.
 *
 * 999 is its "no ADP" sentinel, and those rows are interleaved through the
 * response — counting them would leave gaps wherever one landed.
 */
const priced = data.filter((r) => r.stats?.adp_ppr != null && (r.stats.adp_ppr as number) < 999);
const rankOf = new Map(priced.map((r, i) => [r.player_id, i + 1]));

let ranked = 0;
for (const r of data) {
  const s = r.stats ?? {};
  const rank = rankOf.get(r.player_id) ?? null;
  // A row with neither projected points nor a price is a body on a roster, not a
  // projection. Keeping them would triple the file to say nothing.
  if (!s.pts_ppr && rank === null) continue;
  if (rank !== null) ranked++;
  // Null fields are DROPPED rather than written. Most rows are a rank and
  // nothing else — kickers, defences, anyone priced but not projected — and
  // spelling out thirteen nulls apiece tripled the file to say nothing.
  players[r.player_id] = compact({
    rank,
    adp_ppr: num(s.adp_ppr) != null && (s.adp_ppr as number) < 999 ? num(s.adp_ppr) : null,
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
  });
}
log.info(`${Object.keys(players).length} kept, ${ranked} of them with a draft rank`);

writeJson(OUT, {
  season,
  capturedAt: new Date().toISOString(),
  source: `https://api.sleeper.app/projections/nfl/${season}?season_type=regular`,
  players,
} satisfies ProjectionFile);

log.write(
  `projections.json — ${Object.keys(players).length} players for ${season} (from ${data.length} rows)`,
);
