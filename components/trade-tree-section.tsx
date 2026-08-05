"use client";

import { useState } from "react";

import { TradeModal } from "@/components/trade-modal";
import { TradeTreeView } from "@/components/trade-tree-view";
import type { TradeTree } from "@/lib/trade-tree";
import type { DraftPickRecord, PlayerMeta, Trade, TradeReturn } from "@/lib/types";

/**
 * The tree, with every onward deal in it openable.
 *
 * A node that says "traded 2024" is naming another trade, and the next question
 * is always what that one was. A MODAL rather than a link to its page: the chain
 * is the thing being read, and navigating away to answer a side question loses
 * your place in it — which is the same reason the player timeline opens deals
 * this way rather than sending you to /trades.
 */
export function TradeTreeSection({
  tree,
  players,
  ownerNames,
  outcomes,
  returns,
  handoffs,
  allTrades,
}: {
  tree: TradeTree;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
  returns: Record<string, TradeReturn>;
  handoffs: Record<string, string>;
  allTrades: Record<string, Trade>;
}) {
  const [open, setOpen] = useState<Trade | null>(null);

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
      <TradeTreeView
        tree={tree}
        players={players}
        ownerNames={ownerNames}
        onOpenTrade={(id) => setOpen(allTrades[id] ?? null)}
      />
    </>
  );
}
