"use client";

import Link from "next/link";

import { LANE_PAD, NODE_H, NODE_W, edgePath, hueFor, layoutTradeGraph } from "@/lib/trade-graph";
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
        width={g.width + pad * 2 + LANE_PAD}
        height={g.height + pad * 2}
        viewBox={`${-pad - LANE_PAD} ${-pad} ${g.width + pad * 2 + LANE_PAD} ${g.height + pad * 2}`}
        className="max-w-none"
        role="img"
        aria-label="Trade lineage graph"
      >
        <defs>
          <marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {/* LANES FIRST, behind everything. Two sides of a trade branch into the
            same canvas and the arrows alone do not say whose is whose.

            A NEUTRAL TINT WAS NOT ENOUGH — alternating two greys a few percent
            apart is invisible on a dark surface. Each side now takes a hue and
            wears it four ways: the band, a solid rail down its left, its name,
            and the left edge of every node and arrow in it. */}
        {g.lanes.map((lane) => (
          <g key={lane.owner}>
            <rect
              x={-LANE_PAD + 4}
              y={lane.top}
              width={g.width + LANE_PAD}
              height={lane.bottom - lane.top}
              rx={8}
              fill={lane.hue}
              fillOpacity={0.1}
            />
            <rect
              x={-LANE_PAD + 4}
              y={lane.top}
              width={3}
              height={lane.bottom - lane.top}
              rx={1.5}
              fill={lane.hue}
            />
            <text
              x={-LANE_PAD + 13}
              y={lane.top + 16}
              fill={lane.hue}
              className="text-[10px] font-bold uppercase tracking-wide"
            >
              {(ownerNames[lane.owner] ?? lane.owner).split(" ")[0]}
            </text>
          </g>
        ))}

        {g.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          // AN ARROW TAKES ITS SIDE'S COLOUR, which is the whole point: a branch
          // can be traced back to its party without following it to a lane label.
          // An outside asset keeps the neutral grey — it belongs to no side here.
          const hue = e.outside ? null : hueFor(g.lanes, b.owner ?? a.owner);
          return (
            <g
              key={i}
              style={hue ? { color: hue } : undefined}
              className={e.outside ? "text-ink-400" : e.draft ? "text-accent-dim" : "text-ink-500"}
            >
              <path
                d={edgePath(a, b)}
                fill="none"
                stroke={hue ?? "currentColor"}
                strokeOpacity={hue ? 0.75 : 1}
                strokeWidth={hue ? 2 : 1.5}
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
          // `overflow-hidden`: without it a long name can paint outside the
          // frame, which reads as a label floating loose of its box.
          <foreignObject
            key={n.id}
            x={n.x}
            y={n.y}
            width={NODE_W}
            height={NODE_H}
            className="overflow-hidden"
          >
            <NodeBox
              node={n}
              hue={hueFor(g.lanes, n.owner)}
              players={players}
              ownerNames={ownerNames}
              onOpenTrade={onOpenTrade}
            />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}

function NodeBox({
  node,
  hue,
  players,
  ownerNames,
  onOpenTrade,
}: {
  node: GraphNode;
  /** The owner lane's hue, or null for the root trade, which owns no side. */
  hue: string | null;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const box =
    "flex h-full w-full flex-col justify-center gap-0.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight";
  // THE SIDE IS ON THE NODE ITSELF, not only on the band behind it. Once a node
  // sits at the edge of its lane the band alone stops answering whose it is.
  const side = hue ? { borderLeftColor: hue, borderLeftWidth: 3 } : undefined;

  if (node.kind === "trade") {
    const t = node.trade!;
    const label = `${t.season} wk${t.week}`;
    // One line, wholly inside the box. "This" sitting apart from the date read as
    // a tag stuck on the outside rather than the node's own name.
    const content = (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="tabular truncate font-semibold">
          {t.root ? "This trade" : "Trade"} · {label}
        </span>
      </div>
    );
    // OPAQUE, every one of them. A translucent fill picks up whichever lane band
    // happens to sit behind it, so the same box was a different colour on every
    // trade. The root's green is the accent at 15% over ink-800, precomputed.
    const tone = t.root
      ? "border-accent bg-[#0c2e26] text-accent"
      : "border-trade/60 bg-ink-800 text-trade";
    return onOpenTrade && !t.root ? (
      <button
        type="button"
        onClick={() => onOpenTrade(t.id)}
        title={`See the ${label} trade`}
        style={side}
        className={`${box} ${tone} transition-colors hover:border-trade`}
      >
        {content}
      </button>
    ) : (
      <div style={side} className={`${box} ${tone}`}>
        {content}
      </div>
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
    // No "outside" caption: the dashed grey border already says it, and the word
    // was competing with the name for a narrow box.
    return (
      <div
        className={`${box} border-dashed border-ink-400 bg-ink-800 text-chalk-600`}
        title="Sent in that deal but not part of this lineage — the reason its return is not purely attributable"
      >
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
      <div className="flex items-center gap-1.5">
        <span
          className={`shrink-0 text-[8px] font-bold uppercase ${
            n.kind === "pick" ? "text-trade" : "text-chalk-600"
          }`}
        >
          {n.kind === "pick" ? "Pick" : (meta?.position ?? "—")}
        </span>
        <span className="truncate">{label}</span>
        {n.bySeason.length > 1 ? (
          <span
            className="ml-auto shrink-0 rounded border border-accent-dim/60 px-1 text-[8px] font-bold uppercase text-accent"
            title={`Kept — held for ${n.bySeason.length} seasons`}
          >
            Kept
          </span>
        ) : null}
      </div>
      {/* A second line rather than a bare integer in the corner. One decimal, and
          the rate beside the total — the same reason the side headers carry it. */}
      {n.value.started ? (
        <div className="tabular flex items-baseline gap-1 text-[9px] text-chalk-500">
          <span className="font-semibold text-chalk-100">{pts.toFixed(1)}</span>
          <span>· {n.value.started} GS</span>
          <span className="text-accent">· {(pts / n.value.started).toFixed(1)}/GS</span>
        </div>
      ) : null}
      {/* A KEPT PLAYER IS SEVERAL SEASONS IN ONE NODE, and the aggregate hides
          which of them earned it — 61.3 could be two good years or one good and
          one wasted. The split is the interesting part of a contract. */}
      {n.bySeason.length > 1 ? (
        <div className="tabular flex flex-wrap gap-1 text-[9px] text-chalk-600">
          {n.bySeason.map((s) => (
            <span key={s.season} className="rounded bg-ink-700 px-1">
              &apos;{String(s.season).slice(2)}{" "}
              <span className="text-chalk-400">{s.stat.startPoints.toFixed(1)}</span>
            </span>
          ))}
        </div>
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
      style={side}
      className={`${box} border-ink-600 bg-ink-800 text-chalk-300 transition-colors hover:border-accent-dim`}
    >
      {inner}
    </Link>
  ) : (
    <div style={side} className={`${box} border-ink-600 bg-ink-800 text-chalk-300`} title={title}>
      {inner}
    </div>
  );
}
