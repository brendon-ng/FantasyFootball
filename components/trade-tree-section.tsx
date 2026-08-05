"use client";

import { useState } from "react";

import { TradeGraphView } from "@/components/trade-graph-view";
import { TradeModal } from "@/components/trade-modal";
import { TradeTreeView } from "@/components/trade-tree-view";
import type { TradeTree } from "@/lib/trade-tree";
import { useUrlState } from "@/lib/url-state";
import type { DraftPickRecord, PlayerMeta, Trade, TradeReturn } from "@/lib/types";

/**
 * The tree, with every onward deal in it openable.
 *
 * A node that says "traded 2024" is naming another trade, and the next question
 * is always what that one was. A MODAL rather than a link to its page: the chain
 * is the thing being read, and navigating away to answer a side question loses
 * your place in it — which is the same reason the player timeline opens deals
 * this way rather than sending you to /trades.
 *
 * Also owns the cascade/graph toggle, since both views share the modal and the
 * same jump handler.
 */
const VIEWS = ["cascade", "graph"] as const;

export function TradeTreeSection({
  trade,
  tree,
  players,
  ownerNames,
  outcomes,
  returns,
  handoffs,
  allTrades,
}: {
  trade: Trade;
  tree: TradeTree;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
  returns: Record<string, TradeReturn>;
  handoffs: Record<string, string>;
  allTrades: Record<string, Trade>;
}) {
  const [open, setOpen] = useState<Trade | null>(null);
  /**
   * CASCADE BY DEFAULT, and on purpose. It reflows on a phone, needs no
   * horizontal scrolling, and answers "what came from what" perfectly well. The
   * graph earns its place only when a deal was mixed, where seeing the outside
   * assets arrive beats reading about them.
   *
   * IN THE URL so the view can be linked and survives a reload. Not sticky —
   * see `useUrlState`.
   */
  const [view, setView] = useUrlState("view", VIEWS, "cascade");
  // Nothing branches: a graph would be one box and a row of assets.
  const worthGraphing = tree.depth > 0;

  return (
    <>
      {open ? (
        <TradeModal
          trade={open}
          players={players}
          ownerNames={ownerNames}
          outcomes={outcomes}
          returns={returns[open.id]}
          handoffs={handoffs}
          onOpenTrade={(id) => setOpen(allTrades[id] ?? open)}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {worthGraphing ? (
        <div className="mb-3 flex items-center gap-1 text-[11px]">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md border px-2 py-1 capitalize transition-colors ${
                view === v
                  ? "border-accent-dim bg-accent/10 text-accent"
                  : "border-ink-600 text-chalk-500 hover:border-ink-500 hover:text-chalk-300"
              }`}
            >
              {v}
            </button>
          ))}
          {view === "graph" ? (
            <span className="ml-2 text-chalk-600">
              Boxes are trades. Dashed arrows are assets from outside this lineage.
            </span>
          ) : null}
        </div>
      ) : null}

      {view === "graph" && worthGraphing ? (
        <TradeGraphView
          trade={trade}
          tree={tree}
          players={players}
          ownerNames={ownerNames}
          onOpenTrade={(id) => setOpen(allTrades[id] ?? null)}
        />
      ) : (
        <TradeTreeView
          tree={tree}
          players={players}
          ownerNames={ownerNames}
          onOpenTrade={(id) => setOpen(allTrades[id] ?? null)}
        />
      )}
    </>
  );
}
