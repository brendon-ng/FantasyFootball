/**
 * The best lineup a roster can field in a week, given each player's projection.
 *
 * OPTIMAL MEANS AN EXACT ASSIGNMENT, not a greedy fill. Filling the fixed slots
 * first and then each flex in turn is right for the common shapes, and wrong as
 * soon as two flex slots overlap without nesting — a WR/RB flex beside a WR/TE
 * one can strand a tight end on the bench that a different order would have
 * started. A roster is never more than a few dozen candidates against a dozen
 * slots, so the Hungarian algorithm costs nothing and settles the question.
 *
 * Dependency-free: this ships to the browser, and runs under plain `node` for
 * checking against real data.
 */

/** Which player positions may fill each slot. Anything unlisted is not a starting slot. */
export const SLOT_ELIGIBLE: Record<string, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  // ESPN spells the team defence differently; same slot.
  "D/ST": ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["WR", "RB"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

/** The starting slots out of a full `roster_positions` list — bench, IR and taxi dropped. */
export const startingSlots = (rosterPositions: readonly string[]): string[] =>
  rosterPositions.filter((s) => s in SLOT_ELIGIBLE);

/**
 * A player's positions as a lineup sees them.
 *
 * A fullback lines up in the RB slot everywhere Sleeper is concerned, and a
 * player listed under several positions (Travis Hunter, WR and DB) may fill
 * either. `fantasyPositions` wins where the caller has it.
 */
export function lineupPositions(position: string | null, fantasyPositions?: readonly string[] | null): string[] {
  const raw = fantasyPositions?.length ? fantasyPositions : position ? [position] : [];
  return [...new Set(raw.map((p) => (p === "FB" ? "RB" : p)))];
}

export interface Candidate {
  id: string;
  positions: readonly string[];
  /** Projected points this week. 0 for a bye or no projection. */
  points: number;
  /** Not on the roster — would have to be picked up. */
  freeAgent?: boolean;
}

export interface LineupSlot {
  slot: string;
  /** Null when nobody eligible is left to fill it. */
  id: string | null;
  points: number;
  freeAgent: boolean;
}

export interface Lineup {
  slots: LineupSlot[];
  total: number;
}

/**
 * On an exact tie the rostered player starts. Small enough never to outweigh a
 * real hundredth of a point.
 */
const FA_PENALTY = 1e-6;
const BLOCKED = 1e9;

export interface LineupOptions {
  /**
   * How much better a free agent must project than the rostered player he would
   * displace before he is worth picking up — 0.15 means 15%. 0 starts any free
   * agent who is better at all.
   *
   * APPLIED BY DISCOUNTING THE FREE AGENT WHILE CHOOSING, not by comparing slot
   * against slot afterwards. Valued at `points / (1 + margin)`, he wins a start
   * only where his real projection clears the margin over whoever actually loses
   * one — which, once the optimiser reshuffles the flex, need not be the player
   * in the slot he ends up in. The lineup's total still counts his real points.
   * An empty slot takes him whatever the margin, since anything beats nobody.
   */
  freeAgentMargin?: number;
}

export function optimalLineup(
  candidates: readonly Candidate[],
  slots: readonly string[],
  options: LineupOptions = {},
): Lineup {
  const faScale = 1 / (1 + Math.max(0, options.freeAgentMargin ?? 0));
  const n = slots.length;
  if (!n) return { slots: [], total: 0 };
  // One empty filler per slot, eligible everywhere and worth nothing, so the
  // matrix is never short of columns and a slot nobody can fill comes back empty
  // rather than failing the whole assignment.
  const m = candidates.length + n;
  const cost = (i: number, j: number): number => {
    if (j >= candidates.length) return 0;
    const c = candidates[j];
    const ok = SLOT_ELIGIBLE[slots[i]]?.some((p) => c.positions.includes(p));
    if (!ok) return BLOCKED;
    return c.freeAgent ? -c.points * faScale + FA_PENALTY : -c.points;
  };

  const assign = hungarian(n, m, cost);
  const out: LineupSlot[] = slots.map((slot, i) => {
    const j = assign[i];
    const c = j < candidates.length && cost(i, j) < BLOCKED ? candidates[j] : null;
    return {
      slot,
      id: c?.id ?? null,
      points: c?.points ?? 0,
      freeAgent: Boolean(c?.freeAgent),
    };
  });
  return { slots: out, total: round2(out.reduce((s, x) => s + x.points, 0)) };
}

/**
 * Minimum-cost assignment of `n` rows to distinct columns out of `m >= n`.
 * Returns the column chosen for each row.
 *
 * The standard O(n²m) shortest-augmenting-path form with potentials.
 */
function hungarian(n: number, m: number, cost: (i: number, j: number) => number): number[] {
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0); // column -> row (1-based), 0 = free
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
