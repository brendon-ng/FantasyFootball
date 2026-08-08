import type { Projection } from "@/lib/data";

/**
 * Games in an NFL regular season.
 *
 * NOT `Projection.gp`, which comes back as 18 for all 559 projected players —
 * third-string backups included. That is the number of WEEKS in the season, not
 * a forecast of appearances, so dividing by it both understates every per-game
 * figure and implies a per-player projection that does not exist. A team plays
 * 17.
 *
 * Lives here rather than in a component because two surfaces divide by it and a
 * second copy would be a second answer.
 */
export const NFL_GAMES = 17;

/** Projected PPR points per game. Null when there is no projection. */
export const perGame = (p: Projection | undefined | null): number | null =>
  p?.pts_ppr != null ? p.pts_ppr / NFL_GAMES : null;

export interface StatCell {
  label: string;
  value: string;
}

/**
 * The projected line, with the categories this player does not touch removed.
 *
 * A receiver has no passing yards and a quarterback has no receptions. Rendering
 * every category for everyone means most of the line is zeroes, and a zero reads
 * as a forecast of nothing rather than as "not applicable".
 */
export function statLine(p: Projection | undefined | null): StatCell[] {
  if (!p) return [];
  const out: StatCell[] = [];
  const add = (label: string, v: number | null | undefined, d = 0) => {
    if (v) out.push({ label, value: v.toFixed(d) });
  };
  // Points lead the line, not just the tiles above it. The counting stats are
  // the reasoning; the points are the conclusion, and a line that omits its own
  // conclusion makes you look back up to find it.
  add("PTS", p.pts_ppr, 1);
  const pg = perGame(p);
  if (pg != null) out.push({ label: "PPG", value: pg.toFixed(1) });
  add("Pass yd", p.pass_yd);
  add("Pass TD", p.pass_td, 1);
  add("Int", p.pass_int, 1);
  add("Rush att", p.rush_att);
  add("Rush yd", p.rush_yd);
  add("Rush TD", p.rush_td, 1);
  add("Rec", p.rec, 1);
  add("Rec yd", p.rec_yd);
  add("Rec TD", p.rec_td, 1);
  return out;
}
