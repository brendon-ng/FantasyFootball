/**
 * What a trade turned into, followed all the way down.
 *
 * The two-column return table answers "what did each side get that season". This
 * answers the longer question: a pick becomes a player, the player is flipped for
 * two more, one of those is kept for three years. Brendon's side of the 2024 week
 * 1 trade runs four levels deep — one pick that became Hockenson, Pittman, Xavier
 * Worthy and Jordan Mason.
 *
 * MODELLED AS SPELLS, NOT ASSETS. A node is one asset in one owner's hands
 * between two events. That single shape covers a pick becoming a player, a
 * contract being kept, and an asset being traded on, without a special case for
 * each — the only thing that differs is how the spell ENDED.
 *
 * A LINEAGE STOPS WHEN IT LEAVES. Once an asset is traded away it is the other
 * side's tree, so it is followed no further; what comes back in return is a child
 * of this one. Most sides never branch at all — 29 of 49 — and for those this
 * degrades to a flat list, which is what they are.
 *
 * DILUTION IS MARKED, NOT HIDDEN. When a child trade also sent out assets from
 * outside this lineage, its return is not purely attributable to the root. Both
 * totals are reported: everything downstream, and the part whose every input
 * traces back. Pretending the first number is clean would be the easy lie.
 */

import { getDrafts, getMatchupHistory, getPlayerHistory, getTrades, onBye } from "./data.ts";
import type { Trade, TradeLeg, TradeStat } from "./types.ts";

export interface TreeNode {
  /** Stable within a tree, for React keys and for cycle protection. */
  id: string;
  kind: "player" | "pick";
  playerId?: string;
  pick?: { season: number; round: number; originalSlug: string | null };
  /** Who held it during this spell. */
  owner: string;
  /** Where the spell began. */
  from: { season: number; week: number };
  /** Production while held. Zero for a pick, which cannot score. */
  value: TradeStat;
  /** Per season, so a multi-year keep reads as the years it was. */
  bySeason: Array<{ season: number; stat: TradeStat }>;
  ended: NodeEnd;
  children: TreeNode[];
}

export type NodeEnd =
  | { kind: "held" }
  | { kind: "dropped"; season: number; week: number }
  | { kind: "expired" }
  | {
      kind: "traded";
      tradeId: string;
      season: number;
      week: number;
      /** True when that trade also sent out assets from outside this lineage. */
      diluted: boolean;
      /**
       * What else this owner sent in that deal.
       *
       * The reason the return is not purely attributable, named rather than
       * merely flagged — "also sent Kyren Williams" says far more about why the
       * credit is shared than a badge reading "mixed" ever could.
       */
      alsoSent: Array<{ kind: "player" | "pick" | "faab"; playerId?: string; pick?: { season: number; round: number; originalSlug: string | null }; amount?: number }>;
    }
  | { kind: "drafted"; season: number; round: number; slot: number };

export interface TradeTree {
  tradeId: string;
  /** One root per party, in the trade's own column order. */
  roots: Array<{
    owner: string;
    nodes: TreeNode[];
    total: TradeStat;
    pure: TradeStat;
    /**
     * The side's whole return split by season, ascending.
     *
     * A TRADE PAYS OUT OVER YEARS, and one total cannot say whether that was a
     * rental or a contract that kept giving. Summed here rather than at each
     * caller: the tree already walks every node, and two implementations of the
     * same rollup would drift.
     */
    bySeason: Array<{ season: number; stat: TradeStat }>;
  }>;
  /** The deepest chain, so a caller can skip the whole thing when it is flat. */
  depth: number;
}

const blank = (): TradeStat => ({ games: 0, started: 0, startPoints: 0, benchPoints: 0 });

const add = (a: TradeStat, b: TradeStat): TradeStat => ({
  games: a.games + b.games,
  started: a.started + b.started,
  startPoints: Number((a.startPoints + b.startPoints).toFixed(2)),
  benchPoints: Number((a.benchPoints + b.benchPoints).toFixed(2)),
});

const pickKey = (p: { season: number; round: number; originalSlug: string | null }) =>
  `${p.season}|${p.round}|${p.originalSlug}`;

/** Everything the tree needs, indexed once for the whole build. */
function index() {
  const trades = getTrades();

  const rosters = new Map<string, { starters: string[]; playerPoints: Record<string, number> }>();
  const weeksBySeason = new Map<number, number[]>();
  for (const m of getMatchupHistory()) {
    for (const side of [m.home, m.away]) {
      rosters.set(`${m.season}|${m.week}|${side.ownerSlug}`, side);
    }
    const ws = weeksBySeason.get(m.season) ?? [];
    if (!ws.includes(m.week)) ws.push(m.week);
    weeksBySeason.set(m.season, ws.sort((a, b) => a - b));
  }

  const drafted = new Map<string, { playerId: string; round: number; slot: number; season: number }>();
  const keptBy = new Map<string, Set<string>>();
  for (const d of getDrafts()) {
    if (d.slotOwnerSlug) {
      drafted.set(pickKey({ season: d.season, round: d.round, originalSlug: d.slotOwnerSlug }), {
        playerId: d.playerId,
        round: d.round,
        slot: d.draftSlot,
        season: d.season,
      });
    }
    if (d.isKeeper && d.ownerSlug) {
      const key = `${d.season}|${d.ownerSlug}`;
      keptBy.set(key, (keptBy.get(key) ?? new Set()).add(d.playerId));
    }
  }

  /** Seasons with a draft on file, to tell a lapsed contract from the end of the record. */
  const draftSeasons = new Set(getDrafts().map((d) => d.season));

  return { trades, rosters, weeksBySeason, drafted, keptBy, draftSeasons };
}

export function buildTradeTree(trade: Trade): TradeTree {
  const { trades, rosters, weeksBySeason, drafted, keptBy, draftSeasons } = index();
  const history = getPlayerHistory();

  /** The next trade in which `owner` sent this exact asset away. */
  const sentOn = (leg: TradeLeg, owner: string, after: number): Trade | null => {
    let best: Trade | null = null;
    for (const t of trades) {
      if (t.timestamp <= after) continue;
      for (const l of t.legs) {
        if (l.fromSlug !== owner || l.kind !== leg.kind) continue;
        const same =
          leg.kind === "player"
            ? l.playerId === leg.playerId
            : Boolean(l.pick && leg.pick && pickKey(l.pick) === pickKey(leg.pick));
        if (same && (!best || t.timestamp < best.timestamp)) best = t;
      }
    }
    return best;
  };

  /** Points this player earned for this owner, season by season, from a week. */
  const produce = (
    playerId: string,
    owner: string,
    fromSeason: number,
    fromWeek: number,
    until: number | null,
  ) => {
    const bySeason: Array<{ season: number; stat: TradeStat }> = [];
    let season = fromSeason;
    let week = fromWeek;
    // Held for as long as the contract is kept; a season the player is not
    // retained ends the spell.
    for (;;) {
      const stat = blank();
      for (const w of weeksBySeason.get(season) ?? []) {
        if (w < week) continue;
        if (until !== null && season === fromSeason && w >= until) break;
        const side = rosters.get(`${season}|${w}|${owner}`);
        const points = side?.playerPoints[playerId];
        if (points === undefined) continue;
        if (onBye(season, w, playerId, points)) continue;
        stat.games += 1;
        if (side!.starters.includes(playerId)) {
          stat.started += 1;
          stat.startPoints = Number((stat.startPoints + points).toFixed(2));
        } else {
          stat.benchPoints = Number((stat.benchPoints + points).toFixed(2));
        }
      }
      if (stat.games) bySeason.push({ season, stat });
      if (until !== null) break;
      if (!keptBy.get(`${season + 1}|${owner}`)?.has(playerId)) break;
      season += 1;
      week = 1;
    }
    return bySeason;
  };

  let depth = 0;

  const build = (leg: TradeLeg, owner: string, at: Trade, level: number, seen: Set<string>): TreeNode | null => {
    // FAAB has no lineage: it is spent, not held, and it never becomes anything
    // that can be followed. It stays in the trade's own legs, where it belongs.
    if (leg.kind === "faab") return null;
    const key = `${owner}|${leg.kind}|${leg.playerId ?? (leg.pick ? pickKey(leg.pick) : "")}`;
    if (seen.has(key) || level > 8) return null;
    seen.add(key);
    depth = Math.max(depth, level);

    const node: TreeNode = {
      id: `${at.id}|${key}`,
      kind: leg.kind === "pick" ? "pick" : "player",
      playerId: leg.playerId,
      pick: leg.pick,
      owner,
      from: { season: at.season, week: at.week },
      value: blank(),
      bySeason: [],
      ended: { kind: "held" },
      children: [],
    };

    const onwards = sentOn(leg, owner, at.timestamp);

    if (leg.kind === "player" && leg.playerId) {
      node.bySeason = produce(
        leg.playerId,
        owner,
        at.season,
        at.week,
        onwards && onwards.season === at.season ? onwards.week : null,
      );
    }
    node.value = node.bySeason.reduce((acc, s) => add(acc, s.stat), blank());

    if (onwards) {
      // Diluted when that trade also sent out something this lineage never
      // contained — the return is then not purely attributable to the root.
      const alsoSent = onwards.legs.filter(
        (l) =>
          l.fromSlug === owner &&
          !(l.kind === leg.kind &&
            (leg.kind === "player"
              ? l.playerId === leg.playerId
              : Boolean(l.pick && leg.pick && pickKey(l.pick) === pickKey(leg.pick)))),
      );
      node.ended = {
        kind: "traded",
        tradeId: onwards.id,
        season: onwards.season,
        week: onwards.week,
        diluted: alsoSent.length > 0,
        alsoSent: alsoSent.map((l) => ({
          kind: l.kind,
          playerId: l.playerId,
          pick: l.pick,
          amount: l.amount,
        })),
      };
      for (const back of onwards.legs) {
        if (back.toSlug !== owner) continue;
        const child = build(back, owner, onwards, level + 1, seen);
        if (child) node.children.push(child);
      }
      return node;
    }

    if (leg.kind === "pick" && leg.pick) {
      const made = drafted.get(pickKey(leg.pick));
      if (made) {
        node.ended = { kind: "drafted", season: made.season, round: made.round, slot: made.slot };
        // The pick's own child is the player it became — a spell of its own,
        // starting at week 1 of the draft's season.
        const child = build(
          { kind: "player", playerId: made.playerId, fromSlug: null, toSlug: owner },
          owner,
          { ...at, season: made.season, week: 1 },
          level + 1,
          seen,
        );
        if (child) node.children.push(child);
      }
      return node;
    }

    // A player nobody traded on. Three different endings, and the difference
    // matters: a drop is a decision, a lapsed contract is the rules, and the end
    // of the record is neither.
    if (leg.playerId) {
      const lastSeason = node.bySeason.at(-1)?.season ?? at.season;
      const dropped = (history[leg.playerId] ?? []).find(
        (e) =>
          e.action === "drop" &&
          e.ownerSlug === owner &&
          e.season === lastSeason &&
          e.week >= (lastSeason === at.season ? at.week : 1),
      );
      if (dropped) {
        node.ended = { kind: "dropped", season: dropped.season, week: dropped.week };
      } else if (!draftSeasons.has(lastSeason + 1)) {
        // No draft has happened since, so he is simply still there — calling that
        // "expired" would report the end of the data as a decision.
        node.ended = { kind: "held" };
      } else {
        node.ended = { kind: "expired" };
      }
    }
    return node;
  };

  const roots = trade.ownerSlugs.map((owner) => {
    const nodes = trade.legs
      .filter((l) => l.toSlug === owner)
      .map((l) => build(l, owner, trade, 0, new Set<string>()))
      .filter((n): n is TreeNode => n !== null);

    /** Everything downstream, and the part whose every input traces to the root. */
    const walk = (n: TreeNode, pureSoFar: boolean): [TradeStat, TradeStat] => {
      let total = n.value;
      let pure = pureSoFar ? n.value : blank();
      for (const c of n.children) {
        const stillPure = pureSoFar && !(n.ended.kind === "traded" && n.ended.diluted);
        const [t, p] = walk(c, stillPure);
        total = add(total, t);
        pure = add(pure, p);
      }
      return [total, pure];
    };

    let total = blank();
    let pure = blank();
    for (const n of nodes) {
      const [t, p] = walk(n, true);
      total = add(total, t);
      pure = add(pure, p);
    }
    // Season rollup over the WHOLE subtree, not just the assets the side received
    // — a player drafted three deals later still pays into the season he played.
    const seasons = new Map<number, TradeStat>();
    const collect = (n: TreeNode) => {
      for (const s of n.bySeason) seasons.set(s.season, add(seasons.get(s.season) ?? blank(), s.stat));
      n.children.forEach(collect);
    };
    nodes.forEach(collect);
    const bySeason = [...seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, stat]) => ({ season, stat }));

    return { owner, nodes, total, pure, bySeason };
  });

  return { tradeId: trade.id, roots, depth };
}
