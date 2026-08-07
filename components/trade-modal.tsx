"use client";

import { useEffect } from "react";

import { TradeCard } from "@/components/trade-card";
import type { DraftPickRecord, PlayerMeta, Trade, TradeReturn } from "@/lib/types";

/**
 * The whole deal, over the page that mentioned one leg of it.
 *
 * A modal rather than a link away: the question "what came back" is asked WHILE
 * reading a player's timeline, and navigating to `/trades` to find the matching
 * row loses your place in it.
 *
 * A BOTTOM SHEET ON A PHONE, flush to the bottom and the sides, which is the
 * shape people expect there. The breathing room goes INSIDE, under the tables —
 * padding the sheet away from the edges instead just made it a floating box.
 *
 * Reuses `TradeCard`, so the trade reads identically here, on the trades page and
 * on an owner page. Three renderings of one thing would drift.
 *
 * A LITTLE WIDER THAN A DIALOG USUALLY WANTS TO BE, because the card carries a
 * return table per side and the point is reading them against each other. At the
 * original width the two stacked and the comparison was a scroll apart; at the
 * width after that it sprawled. 45rem is between Tailwind's 2xl and 3xl — an
 * arbitrary value because the scale has no step there — and is the narrowest
 * that still fits both tables on a line.
 */
export function TradeModal({
  trade,
  players,
  ownerNames,
  historySeasons,
  outcomes,
  returns,
  handoffs,
  onOpenTrade,
  onClose,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  /** See `TradeCard` — seasons that have a history page. */
  historySeasons?: number[];
  outcomes?: Record<string, DraftPickRecord>;
  returns?: TradeReturn;
  handoffs?: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
  onClose: () => void;
}) {
  // Escape closes, and the page behind does not scroll while it is open —
  // otherwise the wheel moves the list underneath rather than the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trade detail"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/80 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        // The backdrop closes; a click INSIDE must not bubble up to it, or
        // selecting text in the dialog would dismiss it.
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-[50rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-ink-600 bg-ink-800 px-4 py-3 sm:px-5">
          <div>
            <div className="eyebrow text-[10px]">Trade</div>
            <div className="text-sm font-semibold">
              {trade.season} · {trade.preseason ? "Preseason" : `Week ${trade.week}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
          >
            Close
          </button>
        </div>
        {/* Breathing room UNDER the tables, not around the sheet. On a phone the
            sheet runs to the edges — that is the shape people expect — but the
            last row of numbers sitting on the screen edge reads as cut off. */}
        <div className="pb-6 sm:pb-1">
          <TradeCard
          historySeasons={historySeasons}
            trade={trade}
            players={players}
            ownerNames={ownerNames}
            outcomes={outcomes}
            returns={returns}
            handoffs={handoffs}
            onOpenTrade={onOpenTrade}
            showSeason={false}
          />
        </div>
      </div>
    </div>
  );
}
