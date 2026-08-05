"use client";

import { useState } from "react";

import { TradeCard } from "@/components/trade-card";
import { TradeModal } from "@/components/trade-modal";
import type { DraftPickRecord, PlayerMeta, Trade, TradeReturn } from "@/lib/types";

/**
 * A list of trades, each openable for the detail.
 *
 * THE LIST SHOWS THE DEAL, THE MODAL SHOWS THE VERDICT. Every trade carrying its
 * own return table made a season's nine trades an unreadable wall of numbers, and
 * the thing people scan a list for is who traded what. The rest-of-season table
 * is one click away, where there is room to read it.
 *
 * A DEDICATED BUTTON, not a clickable card. The card is full of links — to owners,
 * to players, to the season — and a link inside a clickable region either fires
 * both or has to cancel one of them. An explicit control is unambiguous and keeps
 * every link working.
 */
export function TradeList({
  trades,
  players,
  ownerNames,
  outcomes,
  returns,
  handoffs,
  allTrades,
  showSeason = true,
}: {
  trades: Trade[];
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
  /** Only handed to the modal — the list itself stays a summary. */
  returns: Record<string, TradeReturn>;
  handoffs: Record<string, string>;
  /**
   * Every trade in the league, so the modal can jump to one this list does not
   * contain — an owner page shows eight of their own, and the trade that moved a
   * pick on may be neither.
   */
  allTrades: Record<string, Trade>;
  showSeason?: boolean;
}) {
  const [open, setOpen] = useState<Trade | null>(null);
  const jump = (tradeId: string) => setOpen(allTrades[tradeId] ?? null);

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
          onOpenTrade={jump}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {trades.map((t) => (
        <TradeCard
          key={t.id}
          trade={t}
          players={players}
          ownerNames={ownerNames}
          outcomes={outcomes}
          showSeason={showSeason}
          onOpen={() => setOpen(t)}
        />
      ))}
    </>
  );
}
