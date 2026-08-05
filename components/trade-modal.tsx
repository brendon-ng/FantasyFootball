"use client";

import { useEffect } from "react";

import { TradeCard } from "@/components/trade-card";
import type { PlayerMeta, Trade } from "@/lib/types";

/**
 * The whole deal, over the page that mentioned one leg of it.
 *
 * A modal rather than a link away: the question "what came back" is asked WHILE
 * reading a player's timeline, and navigating to `/trades` to find the matching
 * row loses your place in it.
 *
 * Reuses `TradeCard`, so the trade reads identically here, on the trades page and
 * on an owner page. Three renderings of one thing would drift.
 */
export function TradeModal({
  trade,
  players,
  ownerNames,
  onClose,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        // The backdrop closes; a click INSIDE must not bubble up to it, or
        // selecting text in the dialog would dismiss it.
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
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
        <TradeCard
          trade={trade}
          players={players}
          ownerNames={ownerNames}
          showSeason={false}
        />
      </div>
    </div>
  );
}
