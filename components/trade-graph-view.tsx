"use client";

import Link from "next/link";

import { NODE_H, NODE_W, edgePath, layoutTradeGraph } from "@/lib/trade-graph";
import type { GraphNode } from "@/lib/trade-graph";
import type { TradeTree } from "@/lib/trade-tree";
import type { PlayerMeta, Trade } from "@/lib/types";

/**
 * The same lineage as the cascade, drawn as a graph with the trades as nodes.
 *
 * WHAT THIS SHOWS THAT THE CASCADE CANNOT. A trade here is a box that things
 * enter and leave, so an asset arriving from outside the lineage is an arrow into
 * that box rather than a line of text. When a return is diluted you can see the
 * dilution instead of reading about it.
 *
 * FOREIGN OBJECTS, NOT SVG TEXT. Names need truncation, links and hover states,
 * and `<text>` gives none of those — every label would need manual measuring to
 * avoid overflowing its box. `foreignObject` lets each node be ordinary HTML
 * inside a positioned SVG frame.
 *
 * Columns are generations, so it reads left to right in time order and lays out
 * identically on every render. See `lib/trade-graph.ts` for why not a force
 * simulation.
 */
export function TradeGraphView({
  trade,
  tree,
  players,
  ownerNames,
  onOpenTrade,
}: {
  trade: Trade;
  tree: TradeTree;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const g = layoutTradeGraph(trade, tree);
  if (!g.nodes.length) return null;

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const pad = 8;

  return (
    <div className="overflow-x-auto">
      <svg
        width={g.width + pad * 2}
        height={g.height + pad * 2}
        viewBox={`${-pad} ${-pad} ${g.width + pad * 2} ${g.height + pad * 2}`}
        className="max-w-none"
        role="img"
        aria-label="Trade lineage graph"
      >
        <defs>
          <marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {g.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <g
              key={i}
              className={e.outside ? "text-ink-400" : e.draft ? "text-accent-dim" : "text-ink-500"}
            >
              <path
                d={edgePath(a, b)}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={e.outside || e.draft ? "3 3" : undefined}
                markerEnd="url(#tg-arrow)"
              />
              {e.label ? (
                <text
                  x={(a.x + NODE_W + b.x) / 2}
                  y={(a.y + b.y) / 2 + NODE_H / 2 - 6}
                  textAnchor="middle"
                  className="fill-current text-[9px] font-bold"
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {g.nodes.map((n) => (
          <foreignObject key={n.id} x={n.x} y={n.y} width={NODE_W} height={NODE_H}>
            <NodeBox node={n} players={players} ownerNames={ownerNames} onOpenTrade={onOpenTrade} />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}

function NodeBox({
  node,
  players,
  ownerNames,
  onOpenTrade,
}: {
  node: GraphNode;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const box =
    "flex h-full w-full items-center gap-1.5 rounded-md border px-1.5 text-[11px] leading-tight";

  if (node.kind === "trade") {
    const t = node.trade!;
    const label = `${t.season} wk${t.week}`;
    const content = (
      <>
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide opacity-70">
          {t.root ? "This" : "Trade"}
        </span>
        <span className="tabular truncate font-semibold">{label}</span>
      </>
    );
    const tone = t.root
      ? "border-accent-dim bg-accent/10 text-accent"
      : "border-trade/50 bg-trade/10 text-trade";
    return onOpenTrade && !t.root ? (
      <button
        type="button"
        onClick={() => onOpenTrade(t.id)}
        title={`See the ${label} trade`}
        className={`${box} ${tone} transition-colors hover:bg-trade/20`}
      >
        {content}
      </button>
    ) : (
      <div className={`${box} ${tone}`}>{content}</div>
    );
  }

  if (node.kind === "outside") {
    const o = node.outside!;
    const label =
      o.kind === "player"
        ? (players[o.playerId ?? ""]?.full_name ?? o.playerId ?? "?")
        : o.kind === "pick" && o.pick
          ? `${o.pick.season} R${o.pick.round}`
          : `$${o.amount} FAAB`;
    return (
      <div
        className={`${box} border-dashed border-ink-400 bg-ink-850/60 text-chalk-600`}
        title="Sent in that deal but not part of this lineage — the reason its return is not purely attributable"
      >
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide">Outside</span>
        <span className="truncate">{label}</span>
      </div>
    );
  }

  const n = node.node!;
  const meta = n.playerId ? players[n.playerId] : undefined;
  const label =
    n.kind === "pick" && n.pick
      ? `${n.pick.season} R${n.pick.round}`
      : (meta?.full_name ?? n.playerId ?? "—");
  const pts = n.value.startPoints;
  const inner = (
    <>
      <span
        className={`shrink-0 text-[8px] font-bold uppercase ${
          n.kind === "pick" ? "text-trade" : "text-chalk-600"
        }`}
      >
        {n.kind === "pick" ? "Pick" : (meta?.position ?? "—")}
      </span>
      <span className="truncate">{label}</span>
      {pts ? (
        <span className="tabular ml-auto shrink-0 font-semibold text-chalk-100">
          {pts.toFixed(0)}
        </span>
      ) : null}
    </>
  );
  const title = `${label}${
    n.kind === "pick" && n.pick?.originalSlug
      ? ` — originally ${ownerNames[n.pick.originalSlug] ?? n.pick.originalSlug}'s`
      : ""
  }${pts ? ` · ${pts.toFixed(1)} started points over ${n.value.started} starts` : ""}`;

  return n.playerId ? (
    <Link
      href={`/players/${n.playerId}/`}
      title={title}
      className={`${box} border-ink-600 bg-ink-850 text-chalk-300 transition-colors hover:border-accent-dim`}
    >
      {inner}
    </Link>
  ) : (
    <div className={`${box} border-ink-600 bg-ink-850 text-chalk-300`} title={title}>
      {inner}
    </div>
  );
}
