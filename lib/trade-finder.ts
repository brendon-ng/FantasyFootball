/**
 * Searching for trades worth proposing.
 *
 * THREE PASSES, because the space is too big for the real model. Up to four
 * players a side against nine partners is hundreds of thousands of
 * combinations, and the exact evaluation — every week, byes, free agents
 * contending for each other — costs milliseconds each. So this file SCREENS, in
 * two stages, and hands the best survivors to the exact model the analyzer uses:
 *
 * 1. AVERAGE LINEUPS — per-game projections, byes excluded — as a cheap first
 *    cut with a generous margin on BOTH sides. It only throws out the clearly
 *    bad. It cannot judge depth: two-for-one value is mostly bye cover, which a
 *    lineup with no bye weeks in it does not see. Used alone it scored a trade
 *    at −0.60 a game for the side receiving two players that the weekly model
 *    put at −0.11, and so a trade turned up searching from one side and not
 *    from the other.
 * 2. EVERY WEEK, with the fast lineup — byes and all, no free-agent contention —
 *    under the same margin for both sides, so a trade is judged the same way
 *    whichever team is sending it. This is what ranks the survivors.
 * 3. The exact pass, in the page, which decides what the reader sees.
 *
 * Pure and dependency-free, a generator so the page can run it in slices and
 * stay responsive, and runnable under plain `node`.
 */

import { optimalLineup, SLOT_ELIGIBLE, type Candidate } from "./lineup.ts";

/**
 * Which of the receiving team's two tests a trade must pass: its rest-of-season
 * lineup holding up, its playoff-weeks lineup holding up, either, or both.
 */
export type AcceptMode = "either" | "both" | "season" | "playoffs";

/**
 * The one acceptance rule, for the screen and the exact pass alike. With no
 * playoff weeks left to judge, the playoff test is the season test — otherwise
 * "Playoffs" would accept nothing and "Both" would collapse into it.
 */
export function accepts(mode: AcceptMode, seasonOk: boolean, playoffOk: boolean | null): boolean {
  const po = playoffOk ?? seasonOk;
  switch (mode) {
    case "both":
      return seasonOk && po;
    case "season":
      return seasonOk;
    case "playoffs":
      return po;
    default:
      return seasonOk || po;
  }
}

/** The four numbers a result carries, any of which can rank or filter. */
export type GainKey = "senderSeason" | "senderPlayoffs" | "partnerSeason" | "partnerPlayoffs";

/**
 * A bound on how many more players of one position the sender gets than gives
 * — `{ min: 1, max: 1 }` is "exactly one more RB", `{ max: -1 }` "at least one
 * fewer WR". Either end may be missing.
 */
export interface NetRule {
  min?: number;
  max?: number;
}

/** A player's position for the balance rules: his first, a fullback an RB. */
const primaryPosition = (positionsOf: (id: string) => readonly string[], id: string) => positionsOf(id)[0] ?? "";

/**
 * Whether a give / get pair meets every position rule.
 *
 * Checked BEFORE ANY LINEUP IS SCORED: it needs only the players' positions, so
 * a constrained search skips the combinations it rules out instead of paying to
 * evaluate them — narrowing the rules speeds the search up.
 */
export function meetsPositionRules(
  give: readonly string[],
  get: readonly string[],
  rules: Readonly<Record<string, NetRule>>,
  positionsOf: (id: string) => readonly string[],
): boolean {
  for (const [pos, rule] of Object.entries(rules)) {
    if (rule.min == null && rule.max == null) continue;
    let net = 0;
    for (const id of get) if (primaryPosition(positionsOf, id) === pos) net++;
    for (const id of give) if (primaryPosition(positionsOf, id) === pos) net--;
    if (rule.min != null && net < rule.min) return false;
    if (rule.max != null && net > rule.max) return false;
  }
  return true;
}

/** Minimum total points per measure; a missing or null entry is no limit. */
export type GainLimits = Partial<Record<GainKey, number | null>>;

export interface FinderTeam {
  rosterId: number;
  players: readonly string[];
}

export interface ScreenInput {
  sender: FinderTeam;
  /** Teams the sender may trade with — one when a partner is fixed. */
  partners: readonly FinderTeam[];
  slots: readonly string[];
  /** Per-game projection over the rest of the season, byes excluded. */
  value: (id: string) => number;
  /**
   * Per-game projection over the PLAYOFF WEEKS alone. The receiving team counts
   * as willing if EITHER its rest-of-season lineup OR its playoff lineup holds
   * up, since a contender will trade regular-season points for a stronger run.
   * Null when no playoff weeks are left to judge.
   */
  playoffValue: ((id: string) => number) | null;
  positionsOf: (id: string) => readonly string[];
  /** Everybody nobody rosters. */
  freeAgents: readonly string[];
  /** Whether a team may pick up free agents, per the page's setting. */
  streams: (rosterId: number) => boolean;
  /** How much better a free agent must be to start — see `LineupOptions`. */
  freeAgentMargin: number;
  /** Players the sender must give up / must receive. */
  sell: readonly string[];
  buy: readonly string[];
  /**
   * Players the sender will not give up, whatever they are worth. They never
   * appear in a give set, even if they would otherwise make the pool, and
   * exclusion wins over a required sell — a player cannot be both.
   */
  exclude: readonly string[];
  /**
   * Players the sender will not receive, whatever they are worth. They never
   * appear in a get set from any partner, even if they would otherwise make
   * that partner's pool, and exclusion wins over a required buy.
   */
  excludeBuy: readonly string[];
  /**
   * How many players the sender gives and gets, inclusive, required ones
   * counted. The page caps both at four.
   */
  give: { min: number; max: number };
  get: { min: number; max: number };
  /** Players considered per side, besides any required ones. */
  poolSize: number;
  /**
   * Every remaining week's projections, in order, flagged when it is a playoff
   * week. The second stage scores lineups week by week from these.
   */
  weeks: ReadonlyArray<{ value: (id: string) => number; playoff: boolean }>;
  /** Points per week the RECEIVING team may lose and still be acceptable. */
  tolerance: number;
  /** Which of the receiving team's tests a trade must pass. */
  accept: AcceptMode;
  /**
   * Floors on each measure, in total points, applied at every stage. Without
   * them the screen would hand the exact pass trades the reader has already
   * ruled out, crowding out ones they want.
   */
  min: GainLimits;
  /**
   * What the survivors are RANKED BY, and which way. It decides which few
   * hundred reach the exact pass, so it has to be the reader's sort: the 300
   * best trades for the sender are not the 300 best for the partner.
   */
  rankBy: GainKey;
  /** Position balance rules, keyed by position. Empty for none. */
  positionNet: Readonly<Record<string, NetRule>>;
  descending: boolean;
  /**
   * How far below the line each stage still lets a trade through, for BOTH
   * sides alike: per game for the average stage, in total points for the weekly
   * one. The weekly stage ignores free-agent contention, so it can be off by a
   * little either way; the exact pass makes the final call.
   */
  slackAverage: number;
  slackWeekly: number;
  /** How many survivors to hand to the exact pass. */
  keep: number;
}

export interface Screened {
  partner: number;
  give: string[];
  get: string[];
  /** Rest-of-season points by the weekly stage: the sender's, the partner's. */
  senderGain: number;
  partnerGain: number;
  /** The same over the playoff weeks alone. */
  senderPlayoffGain: number;
  partnerPlayoffGain: number;
}

/** A screened trade's value on one measure. */
export const screenedValue = (t: Screened, key: GainKey): number =>
  key === "senderSeason"
    ? t.senderGain
    : key === "senderPlayoffs"
      ? t.senderPlayoffGain
      : key === "partnerSeason"
        ? t.partnerGain
        : t.partnerPlayoffGain;

export interface ScreenProgress {
  done: number;
  total: number;
}

/**
 * The search, in slices. Yields progress every couple of thousand evaluations
 * and returns the survivors, best for the sender first.
 */
export function* screenTrades(input: ScreenInput): Generator<ScreenProgress, Screened[]> {
  const evaluate = lineupEvaluator(input.slots, input.freeAgentMargin);
  const season = scorer(input, input.value, evaluate);
  const playoffs = input.playoffValue ? scorer(input, input.playoffValue, evaluate) : null;
  const weekly = input.weeks.map((w) => ({ ...scorer(input, w.value, evaluate), playoff: w.playoff }));
  const nWeeks = input.weeks.length;
  const nPlayoff = input.weeks.filter((w) => w.playoff).length;

  const senderBase = season.baseList(input.sender);
  const senderNow = evaluate(senderBase, EMPTY, []);
  const senderWeeks = weekly.map((w) => {
    const base = w.baseList(input.sender);
    return { base, now: evaluate(base, EMPTY, []) };
  });

  // Excluded players never enter the pool, so no give set can contain one —
  // and filtering before the poolSize cut means an excluded star does not
  // waste one of the eight pool slots.
  const senderPool = pool(input.sender, input.sell, input, season.level, input.exclude);
  const outs = subsets(senderPool, input.sell, input.give.min, input.give.max);

  // Required buys fix the partner: they can only come from one roster.
  const partners = input.buy.length
    ? input.partners.filter((p) => input.buy.every((id) => p.players.includes(id)))
    : input.partners;

  const plans = partners.map((p) => {
    // Don't-buy players never enter a partner's pool, so no get set can
    // contain one — filtered before the poolSize cut, as with the sender's
    // exclusion, so an excluded star does not waste a pool slot.
    const ins = subsets(
      pool(p, input.buy, input, season.level, input.excludeBuy),
      input.buy,
      input.get.min,
      input.get.max,
    );
    const base = season.baseList(p);
    const poBase = playoffs?.baseList(p) ?? null;
    return {
      partner: p,
      ins,
      base,
      now: evaluate(base, EMPTY, []),
      poBase,
      poNow: poBase ? evaluate(poBase, EMPTY, []) : 0,
      weeks: weekly.map((w) => {
        const b = w.baseList(p);
        return { base: b, now: evaluate(b, EMPTY, []) };
      }),
    };
  });
  const total = plans.reduce((s, p) => s + p.ins.length * outs.length, 0);
  // Stage 1 can only judge the sender's season total: a per-game floor from it.
  const senderAvgFloor =
    input.min.senderSeason != null && nWeeks ? input.min.senderSeason / nWeeks - input.slackAverage : null;
  const avgFloor = -(input.tolerance + input.slackAverage);

  const kept: Screened[] = [];
  const cap = input.keep * 8;
  let done = 0;
  for (const plan of plans) {
    for (const give of outs) {
      const giveSeason = sortItems(give.map(season.item));
      const givePlayoffs = playoffs ? sortItems(give.map(playoffs.item)) : [];
      const giveSet = new Set(give);
      for (const get of plan.ins) {
        done++;
        if (done % 2000 === 0) yield { done, total };
        if (!meetsPositionRules(give, get, input.positionNet, input.positionsOf)) continue;
        const getSet = new Set(get);

        // Stage 1: average lineups, a generous cut for both sides.
        const senderAvg = evaluate(senderBase, giveSet, sortItems(get.map(season.item))) - senderNow;
        if (senderAvgFloor != null && senderAvg < senderAvgFloor) continue;
        const partnerAvg = evaluate(plan.base, getSet, giveSeason) - plan.now;
        const seasonAvgOk = partnerAvg >= avgFloor;
        // The playoff lineup is only scored when the mode can still turn on it.
        const needPlayoff =
          plan.poBase != null &&
          (input.accept === "playoffs" ||
            (input.accept === "either" && !seasonAvgOk) ||
            (input.accept === "both" && seasonAvgOk));
        // Null when not scored: in every such case the season test alone decides.
        const playoffAvgOk = needPlayoff
          ? evaluate(plan.poBase!, getSet, givePlayoffs) - plan.poNow >= avgFloor
          : null;
        if (!accepts(input.accept, seasonAvgOk, playoffAvgOk)) continue;

        // Stage 2: every week, byes and all.
        let senderGain = 0;
        let partnerGain = 0;
        let senderPlayoffGain = 0;
        let partnerPlayoffGain = 0;
        for (let k = 0; k < weekly.length; k++) {
          const w = weekly[k];
          const sd = evaluate(senderWeeks[k].base, giveSet, sortItems(get.map(w.item))) - senderWeeks[k].now;
          const pd = evaluate(plan.weeks[k].base, getSet, sortItems(give.map(w.item))) - plan.weeks[k].now;
          senderGain += sd;
          partnerGain += pd;
          if (w.playoff) {
            senderPlayoffGain += sd;
            partnerPlayoffGain += pd;
          }
        }
        const seasonOk = partnerGain >= -input.tolerance * nWeeks - input.slackWeekly;
        const playoffOk =
          nPlayoff > 0 ? partnerPlayoffGain >= -input.tolerance * nPlayoff - input.slackWeekly : null;
        if (!accepts(input.accept, seasonOk, playoffOk)) continue;
        const t: Screened = {
          partner: plan.partner.rosterId,
          give,
          get,
          senderGain,
          partnerGain,
          senderPlayoffGain,
          partnerPlayoffGain,
        };
        if (!withinLimits(t, input.min, input.slackWeekly)) continue;
        kept.push(t);
        if (kept.length > cap * 2) trim(kept, cap, input.rankBy, input.descending);
      }
    }
  }
  trim(kept, cap, input.rankBy, input.descending);
  return dedupe(kept, input.rankBy, input.descending).slice(0, input.keep);
}

/** Everything the screen needs to score lineups by one value function. */
function scorer(input: ScreenInput, value: (id: string) => number, evaluate: ReturnType<typeof lineupEvaluator>) {
  const reps = replacements(input, value);
  const item = (id: string): Item => ({ id, pts: value(id), eff: value(id), pos: input.positionsOf(id) });
  const baseList = (team: FinderTeam): Item[] =>
    sortItems([...team.players.map(item), ...(input.streams(team.rosterId) ? reps.items : [])]);
  return { item, baseList, level: reps.level, evaluate };
}

// ---------------------------------------------------------------------------
// The fast lineup
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  /** Real projected points. */
  pts: number;
  /** What the optimiser sorts by — a free agent's points discounted by the margin. */
  eff: number;
  pos: readonly string[];
  fa?: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

const sortItems = (items: Item[]): Item[] =>
  items.sort((a, b) => b.eff - a.eff || Number(a.fa ?? false) - Number(b.fa ?? false) || a.id.localeCompare(b.id));

/**
 * A lineup total for `base` minus `drop` plus `add`, as fast as possible.
 *
 * GREEDY WHERE GREEDY IS EXACT. When every pair of slot types is either
 * disjoint or nested — QB, RB, WR, TE inside FLEX inside SUPER_FLEX, which is
 * every league here — taking players best first and putting each in the most
 * restrictive open slot he fits is optimal, AS LONG AS EACH PLAYER HAS ONE
 * POSITION. A player listed at two (Travis Hunter, WR and DB) can be eligible
 * for two unrelated narrow slots, and best-first then guesses which; the random
 * check caught exactly that, a DEF/WR dropped into DEF when WR was worth more.
 * So a lineup involving anyone multi-positional, or a slot shape with
 * overlapping flexes (a WR/RB beside a WR/TE), goes to `optimalLineup` instead.
 * Checked against it on 1,200 random rosters across three slot shapes.
 *
 * `base` and `add` arrive sorted best first, so the two are merged on the fly
 * rather than re-sorted for each of the hundreds of thousands of calls.
 */
function lineupEvaluator(slots: readonly string[], margin: number) {
  const elig = slots.map((s) => new Set(SLOT_ELIGIBLE[s] ?? []));
  const laminar = elig.every((a, i) =>
    elig.every((b, j) => {
      if (i >= j) return true;
      const inter = [...a].filter((x) => b.has(x)).length;
      return inter === 0 || inter === a.size || inter === b.size;
    }),
  );
  // Most restrictive first, so a player lands in the narrowest slot he fits.
  const order = slots.map((_, i) => i).sort((x, y) => elig[x].size - elig[y].size || x - y);

  const multi = new WeakMap<Item[], boolean>();
  const hasMulti = (list: Item[]) => {
    let m = multi.get(list);
    if (m == null) {
      m = list.some((c) => c.pos.length > 1);
      multi.set(list, m);
    }
    return m;
  };

  return (base: Item[], drop: ReadonlySet<string>, add: Item[]): number => {
    if (!laminar || hasMulti(base) || add.some((c) => c.pos.length > 1)) {
      const cands: Candidate[] = [...base.filter((c) => !drop.has(c.id)), ...add].map((c) => ({
        id: c.id,
        positions: c.pos,
        points: c.pts,
        freeAgent: c.fa,
      }));
      return optimalLineup(cands, slots, { freeAgentMargin: margin }).total;
    }
    const open = new Array<boolean>(slots.length).fill(true);
    let left = slots.length;
    let total = 0;
    const used = new Set<string>();
    let i = 0;
    let j = 0;
    while (left > 0 && (i < base.length || j < add.length)) {
      let c: Item;
      if (j >= add.length || (i < base.length && base[i].eff >= add[j].eff)) c = base[i++];
      else c = add[j++];
      if (drop.has(c.id) || used.has(c.id)) continue;
      for (const k of order) {
        if (open[k] && c.pos.some((p) => elig[k].has(p))) {
          open[k] = false;
          left--;
          total += c.pts;
          used.add(c.id);
          break;
        }
      }
    }
    return total;
  };
}

/**
 * The waiver wire as the screen sees it: the best few free agents at each
 * position, as many as that position has slots, discounted by the margin. No
 * contention between teams — the exact pass handles that.
 *
 * `level` is the best free agent's per-game value at each position, which is
 * what a rostered player has to beat to be worth anything in a trade.
 */
function replacements(
  input: ScreenInput,
  value: (id: string) => number,
): { items: Item[]; level: Map<string, number> } {
  const depth = new Map<string, number>();
  for (const s of input.slots) for (const p of SLOT_ELIGIBLE[s] ?? []) depth.set(p, (depth.get(p) ?? 0) + 1);
  const scale = 1 / (1 + Math.max(0, input.freeAgentMargin));
  const byPos = new Map<string, Array<{ id: string; v: number }>>();
  for (const id of input.freeAgents) {
    const v = value(id);
    if (!(v > 0)) continue;
    for (const p of input.positionsOf(id)) {
      if (!depth.has(p)) continue;
      const list = byPos.get(p) ?? [];
      list.push({ id, v });
      byPos.set(p, list);
    }
  }
  const items: Item[] = [];
  const seen = new Set<string>();
  const level = new Map<string, number>();
  for (const [p, list] of byPos) {
    list.sort((a, b) => b.v - a.v);
    level.set(p, list[0]?.v ?? 0);
    for (const { id, v } of list.slice(0, depth.get(p) ?? 0)) {
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ id, pts: v, eff: v * scale, pos: input.positionsOf(id), fa: true });
    }
  }
  return { items, level };
}

/**
 * Who on a roster is worth putting in a trade: the players worth more than a
 * waiver replacement at their position, best first, capped at `poolSize` —
 * plus anyone the reader required, whatever they are worth. A player below
 * replacement adds nothing to the other side's lineup, so offering him only
 * multiplies the search.
 */
function pool(
  team: FinderTeam,
  required: readonly string[],
  input: ScreenInput,
  level: Map<string, number>,
  exclude: readonly string[] = [],
): string[] {
  const above = (id: string) => {
    const rep = Math.max(0, ...input.positionsOf(id).map((p) => level.get(p) ?? 0));
    return input.value(id) - rep;
  };
  const ranked = team.players
    .filter((id) => !required.includes(id) && !exclude.includes(id) && above(id) > 0)
    .sort((a, b) => above(b) - above(a))
    .slice(0, input.poolSize);
  return [...required.filter((id) => team.players.includes(id) && !exclude.includes(id)), ...ranked];
}

/** Every subset of `pool` of size min..max (at least 1) that contains all of `required`. */
function subsets(pool: readonly string[], required: readonly string[], min: number, max: number): string[][] {
  const req = required.filter((id) => pool.includes(id));
  if (req.length > max) return [];
  const rest = pool.filter((id) => !req.includes(id));
  const out: string[][] = [];
  const floor = Math.max(1, min);
  const walk = (start: number, acc: string[]) => {
    if (acc.length + req.length >= floor) out.push([...req, ...acc]);
    if (acc.length + req.length >= max) return;
    for (let i = start; i < rest.length; i++) walk(i + 1, [...acc, rest[i]]);
  };
  walk(0, []);
  return out;
}

/** Every floor in `min` met, each loosened by `slack`. */
export function withinLimits(
  t: Pick<Screened, "senderGain" | "partnerGain" | "senderPlayoffGain" | "partnerPlayoffGain">,
  min: GainLimits,
  slack = 0,
): boolean {
  for (const key of Object.keys(min) as GainKey[]) {
    const floor = min[key];
    if (floor != null && screenedValue(t as Screened, key) < floor - slack) return false;
  }
  return true;
}

const size = (t: Screened) => t.give.length + t.get.length;

/** Ranked by `key`, smaller trades first on a tie. */
const ranked = (key: GainKey, descending: boolean) => (a: Screened, b: Screened) =>
  (descending ? screenedValue(b, key) - screenedValue(a, key) : screenedValue(a, key) - screenedValue(b, key)) ||
  size(a) - size(b);

/** Keep the best `cap` by the ranking measure, in place. */
function trim(list: Screened[], cap: number, key: GainKey, descending: boolean): void {
  list.sort(ranked(key, descending));
  list.length = Math.min(list.length, cap);
}

/**
 * Drop a trade that is a kept trade plus passengers.
 *
 * Adding a bench player who never starts to either side changes neither team's
 * lineup, so without this the list fills with the same deal four times over,
 * each with a different throw-in. A trade is dropped when a smaller one with the
 * same partner is contained in it and is at least as good for both teams.
 */
function dedupe(list: Screened[], key: GainKey, descending: boolean): Screened[] {
  const sorted = [...list].sort(ranked(key, descending));
  const bySize = [...sorted].sort((a, b) => a.give.length + a.get.length - (b.give.length + b.get.length));
  const dropped = new Set<Screened>();
  for (const big of sorted) {
    for (const small of bySize) {
      if (small === big) break;
      if (dropped.has(small) || small.partner !== big.partner) continue;
      if (small.give.length + small.get.length >= big.give.length + big.get.length) continue;
      const contained =
        small.give.every((id) => big.give.includes(id)) && small.get.every((id) => big.get.includes(id));
      if (contained && small.senderGain >= big.senderGain - 0.5 && small.partnerGain >= big.partnerGain - 0.5) {
        dropped.add(big);
        break;
      }
    }
  }
  return sorted.filter((t) => !dropped.has(t));
}
