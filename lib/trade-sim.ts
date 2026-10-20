/**
 * What a trade does to the rest of a season: every team's best lineup each week,
 * the chance of winning each game, and the odds of the playoffs and the title.
 *
 * Pure and dependency-free — it ships to the browser and runs under plain
 * `node` against saved responses, which is how it was checked.
 *
 * THREE MODELLING CHOICES carry the numbers, and each is deliberate:
 *
 * - LINEUPS ARE OPTIMAL, never the lineup a team actually set. A trade's value
 *   is what it does to the best team a manager could field, and a lineup left
 *   untouched in week 12 says nothing about that.
 *
 * - FREE AGENTS ARE OPTIONAL, AND PER TEAM. A team allowed to stream may start
 *   anyone nobody rosters, so a trade that strips its only kicker costs the gap
 *   to the best kicker on waivers, not a whole kicker. Which teams stream is the
 *   caller's choice; the page defaults to everyone. A pickup also has to be
 *   WORTH IT: a free agent starts only where
 *   he projects at least `FREE_AGENT_MARGIN` (15%) more than the rostered player
 *   he would displace. Where several teams stream and want the same player, they
 *   claim in REVERSE STANDINGS ORDER, worst first, the way waivers usually run.
 *   Every pickup assumes a bench spot can be cleared.
 *
 * - ONE SCORE MODEL, SLEEPER'S. A team's week is normal around its projection
 *   with a standard deviation of projection / √11 — exactly what
 *   `distribution(0, projected)` in lib/win-probability gives before kickoff — so
 *   a percentage here agrees with the matchup cards elsewhere on the site.
 */

import { optimalLineup, SLOT_ELIGIBLE, type Candidate, type Lineup } from "./lineup.ts";

/**
 * A pickup has to be worth the trouble: a free agent starts only where he
 * projects at least 15% more than the rostered player he would displace.
 * Nobody burns a waiver claim and a roster spot for half a point, and a model
 * that streams on any edge credits every team with more diligence than any
 * league sees. See `LineupOptions.freeAgentMargin`.
 */
export const FREE_AGENT_MARGIN = 0.15;
import { normalCdf } from "./win-probability.ts";

export interface TeamState {
  rosterId: number;
  players: readonly string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Trade {
  /** Roster ids of the two sides. */
  a: number;
  b: number;
  /** Player ids each side gives up. */
  fromA: readonly string[];
  fromB: readonly string[];
}

/** Rosters after the trade. Untouched teams are the same array. */
export function applyTrade(teams: readonly TeamState[], trade: Trade): Map<number, readonly string[]> {
  const out = new Map<number, readonly string[]>();
  const gives = new Set([...trade.fromA, ...trade.fromB]);
  for (const t of teams) {
    if (t.rosterId === trade.a) {
      out.set(t.rosterId, [...t.players.filter((p) => !gives.has(p)), ...trade.fromB]);
    } else if (t.rosterId === trade.b) {
      out.set(t.rosterId, [...t.players.filter((p) => !gives.has(p)), ...trade.fromA]);
    } else {
      out.set(t.rosterId, t.players);
    }
  }
  return out;
}

/** Worst first: the order free agents get claimed in. Ties broken by fewer points for. */
export function claimOrder(teams: readonly TeamState[]): number[] {
  const pct = (t: TeamState) => {
    const g = t.wins + t.losses + t.ties;
    return g ? (t.wins + t.ties / 2) / g : 0;
  };
  return [...teams]
    .sort((x, y) => pct(x) - pct(y) || x.pointsFor - y.pointsFor || x.rosterId - y.rosterId)
    .map((t) => t.rosterId);
}

export interface WeekInput {
  week: number;
  /** Player id -> projected points this week. Absent means no projection (bye, out). */
  points: Readonly<Record<string, number>>;
}

/**
 * Every team's best lineup for one week, free agents included for the teams
 * `streams` allows.
 *
 * Teams are solved one at a time in `order`, and a free agent one team starts is
 * gone for every team after it. Only the few best free agents at each position
 * are offered to the optimiser — as many as that position has slots it could
 * fill — since nobody further down could ever make a lineup.
 */
export function weekLineups(
  week: WeekInput,
  rosters: ReadonlyMap<number, readonly string[]>,
  order: readonly number[],
  slots: readonly string[],
  positionsOf: (id: string) => readonly string[],
  freeAgents: readonly string[],
  /**
   * Roster ids of the teams that may pick free agents up at all. Everyone else
   * fields their own roster and claims nobody. Null or omitted means every team.
   */
  streams?: ReadonlySet<number> | null,
): Map<number, Lineup> {
  const pts = (id: string) => week.points[id] ?? 0;

  const depth = new Map<string, number>();
  for (const s of slots) for (const p of SLOT_ELIGIBLE[s] ?? []) depth.set(p, (depth.get(p) ?? 0) + 1);

  // Free agents worth considering, best first, grouped by every position they can play.
  const byPos = new Map<string, string[]>();
  for (const id of freeAgents) {
    if (!(pts(id) > 0)) continue;
    for (const p of positionsOf(id)) {
      if (!depth.has(p)) continue;
      const list = byPos.get(p) ?? [];
      list.push(id);
      byPos.set(p, list);
    }
  }
  for (const list of byPos.values()) list.sort((x, y) => pts(y) - pts(x) || x.localeCompare(y));

  const claimed = new Set<string>();
  const out = new Map<number, Lineup>();
  for (const rosterId of order) {
    const roster = rosters.get(rosterId) ?? [];
    const cands: Candidate[] = roster.map((id) => ({ id, positions: positionsOf(id), points: pts(id) }));
    const offered = new Set<string>();
    const pool = streams && !streams.has(rosterId) ? new Map<string, string[]>() : byPos;
    for (const [p, list] of pool) {
      let left = depth.get(p) ?? 0;
      for (const id of list) {
        if (!left) break;
        if (claimed.has(id)) continue;
        left--;
        if (offered.has(id)) continue;
        offered.add(id);
        cands.push({ id, positions: positionsOf(id), points: pts(id), freeAgent: true });
      }
    }
    const lineup = optimalLineup(cands, slots, { freeAgentMargin: FREE_AGENT_MARGIN });
    for (const s of lineup.slots) if (s.freeAgent && s.id) claimed.add(s.id);
    out.set(rosterId, lineup);
  }
  return out;
}

/** Sleeper's pregame spread: `distribution(0, projected)` in lib/win-probability. */
export const pregameSd = (mean: number): number => Math.max(mean, 0) / Math.sqrt(11);

/** Chance A outscores B, from two pregame projections. */
export function winChance(meanA: number, meanB: number): number {
  const variance = pregameSd(meanA) ** 2 + pregameSd(meanB) ** 2;
  if (!(variance > 0)) return meanA === meanB ? 0.5 : meanA > meanB ? 1 : 0;
  return 1 - normalCdf(0, meanA - meanB, variance);
}

/** One team's score for a week as a normal distribution. */
export interface ScoreDist {
  mean: number;
  sd: number;
}

export interface SimInput {
  teams: readonly TeamState[];
  /**
   * Regular-season weeks still to play, each with its fixtures (roster id pairs).
   *
   * `fixed` is a week ALREADY UNDER WAY: each team's live distribution — score
   * so far plus what is left — shared by every scenario, because a trade made
   * now cannot reach a week whose lineups are locked and half played. It still
   * decides playoff odds, which is why it is simulated rather than skipped.
   */
  regular: ReadonlyArray<{
    week: number;
    games: ReadonlyArray<readonly [number, number]>;
    fixed?: ReadonlyMap<number, ScoreDist>;
  }>;
  /** Postseason weeks in order. */
  playoffWeeks: readonly number[];
  /** Per scenario: week -> roster id -> projected total. */
  means: ReadonlyArray<ReadonlyMap<number, ReadonlyMap<number, number>>>;
  playoffTeams: number;
  playoffRounds: number;
  sims: number;
  seed: number;
}

export interface Odds {
  playoffs: number;
  /** Top seeds that skip the first round. */
  bye: number;
  champion: number;
}

/**
 * Monte Carlo over the rest of the season, every scenario on the SAME draws.
 *
 * COMMON RANDOM NUMBERS are the point. Each simulated season draws one z-score
 * per team per week and every scenario reuses it, so "before" and "after" differ
 * only where the trade changed a projection. Independent runs would bury a
 * one-point swing in sampling noise of the same size.
 *
 * SEEDED, NOT `Math.random()`: the same trade gives the same numbers on a
 * reload and in a screenshot — the rule the mock draft order already follows.
 *
 * Seeding is wins (a tie half a win) then points for, per the bylaws; a tied
 * playoff game goes to the higher seed. The bracket is fixed rather than
 * re-seeded, top seeds taking the byes: 1 meets the winner of 4 v 5.
 */
export function simulate(input: SimInput): Array<Map<number, Odds>> {
  const { teams, regular, playoffWeeks, means, sims } = input;
  const T = teams.length;
  const S = means.length;
  const idx = new Map(teams.map((t, i) => [t.rosterId, i]));
  const weeks = [...regular.map((r) => r.week), ...playoffWeeks];
  const K = weeks.length;

  // mean[s][k*T + t], and the matching spread. A `fixed` week overrides both,
  // identically in every scenario.
  const mean = means.map((m) => {
    const arr = new Float64Array(K * T);
    weeks.forEach((w, k) => {
      const byRoster = m.get(w);
      for (const t of teams) arr[k * T + idx.get(t.rosterId)!] = byRoster?.get(t.rosterId) ?? 0;
    });
    return arr;
  });
  const sd = mean.map((arr) => arr.map(pregameSd));
  regular.forEach((r, k) => {
    if (!r.fixed) return;
    for (const t of teams) {
      const d = r.fixed.get(t.rosterId);
      if (!d) continue;
      const i = k * T + idx.get(t.rosterId)!;
      for (let s = 0; s < S; s++) {
        mean[s][i] = d.mean;
        sd[s][i] = d.sd;
      }
    }
  });

  const games = regular.map((r) =>
    r.games
      .map(([a, b]) => [idx.get(a), idx.get(b)] as const)
      .filter((g): g is readonly [number, number] => g[0] != null && g[1] != null),
  );

  const P = Math.min(input.playoffTeams, T);
  const rounds = Math.max(input.playoffRounds, Math.ceil(Math.log2(Math.max(P, 2))));
  const bracketSize = 2 ** rounds;
  const order = seedOrder(bracketSize);
  const roundWeeks = Math.max(1, Math.floor(playoffWeeks.length / rounds));

  const made = Array.from({ length: S }, () => new Float64Array(T));
  const byes = Array.from({ length: S }, () => new Float64Array(T));
  const champ = Array.from({ length: S }, () => new Float64Array(T));

  const rand = mulberry32(input.seed);
  const z = new Float64Array(K * T);
  const wins2 = new Float64Array(T);
  const pf = new Float64Array(T);
  const rank = Array.from({ length: T }, (_, i) => i);

  for (let n = 0; n < sims; n++) {
    for (let i = 0; i < z.length; i += 2) {
      // Box–Muller, both halves used.
      const u1 = rand() || 1e-12;
      const r = Math.sqrt(-2 * Math.log(u1));
      const th = 2 * Math.PI * rand();
      z[i] = r * Math.cos(th);
      if (i + 1 < z.length) z[i + 1] = r * Math.sin(th);
    }

    for (let s = 0; s < S; s++) {
      const mu = mean[s];
      const sg = sd[s];
      const score = (k: number, t: number) => mu[k * T + t] + sg[k * T + t] * z[k * T + t];

      for (let t = 0; t < T; t++) {
        wins2[t] = 2 * teams[t].wins + teams[t].ties;
        pf[t] = teams[t].pointsFor;
      }
      for (let k = 0; k < games.length; k++) {
        for (const [a, b] of games[k]) {
          const sa = score(k, a);
          const sb = score(k, b);
          pf[a] += sa;
          pf[b] += sb;
          if (sa > sb) wins2[a] += 2;
          else if (sb > sa) wins2[b] += 2;
          else {
            wins2[a]++;
            wins2[b]++;
          }
        }
      }
      rank.sort((x, y) => wins2[y] - wins2[x] || pf[y] - pf[x] || x - y);

      // seed (1-based) -> team index; bracket slots beyond the field are byes.
      let alive: Array<number | null> = order.map((seed) => (seed <= P ? rank[seed - 1] : null));
      const seedOf = new Map<number, number>();
      for (let i = 0; i < P; i++) {
        made[s][rank[i]]++;
        seedOf.set(rank[i], i + 1);
      }
      for (let r = 0; r < rounds && alive.length > 1; r++) {
        const next: Array<number | null> = [];
        for (let i = 0; i < alive.length; i += 2) {
          const a = alive[i];
          const b = alive[i + 1];
          if (a == null || b == null) {
            const through = a ?? b;
            if (r === 0 && through != null) byes[s][through]++;
            next.push(through);
            continue;
          }
          let sa = 0;
          let sb = 0;
          for (let w = 0; w < roundWeeks; w++) {
            const k = regular.length + r * roundWeeks + w;
            if (k >= K) break;
            sa += score(k, a);
            sb += score(k, b);
          }
          next.push(sa > sb || (sa === sb && seedOf.get(a)! < seedOf.get(b)!) ? a : b);
        }
        alive = next;
      }
      if (alive[0] != null) champ[s][alive[0]]++;
    }
  }

  return Array.from({ length: S }, (_, s) => {
    const out = new Map<number, Odds>();
    teams.forEach((t, i) =>
      out.set(t.rosterId, {
        playoffs: made[s][i] / sims,
        bye: byes[s][i] / sims,
        champion: champ[s][i] / sims,
      }),
    );
    return out;
  });
}

/**
 * Standard bracket order for a power-of-two field: 1 v 8, 4 v 5, 2 v 7, 3 v 6.
 * Adjacent pairs meet, and the winners of neighbouring pairs meet next.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Small, fast, seedable PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
