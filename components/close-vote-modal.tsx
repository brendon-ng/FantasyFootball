"use client";

import { useState } from "react";

import { Sheet } from "@/components/sheet";
import { decideSeasonVote } from "@/lib/punishments-live";
import type { PunishmentSuggestion } from "@/lib/punishments";

/**
 * Closing the last-place vote, and recording what won.
 *
 * THE SERVER COUNTS. This dialog sends no tally and computes no winner — it asks
 * the script to decide inside the same lock that writes the result, for the same
 * reason the draw does: a browser would be asserting an outcome from numbers it
 * fetched some seconds ago, and two people closing at once could disagree.
 *
 * THE COUNTS APPEAR HERE AND NOWHERE EARLIER. The league chose turnout-only
 * while voting is open, and that argument expires the moment it closes — this is
 * the first screen entitled to show them, and it shows them as the thing being
 * confirmed rather than as a leaderboard.
 *
 * A TIE IS A RESULT, NOT A PROBLEM TO SOLVE HERE. It closes with several
 * finalists and no winner, and the league settles it on a wheel at the end of
 * the season — so this dialog reports the tie rather than asking anyone to break
 * it. Nothing further is needed from the commissioner.
 */
export function CloseVoteModal({
  endpoint,
  league,
  season,
  candidates,
  turnout,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  candidates: PunishmentSuggestion[];
  turnout: { voted: number; of: number };
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const textOf = (id: number) =>
    candidates.find((c) => c.id === id)?.text ?? `#${id}`;

  const decide = async (close: (after?: () => void) => void) => {
    setBusy(true);
    setError(null);
    try {
      const res = await decideSeasonVote(endpoint, { league, season });
      setCounts(res.counts);
      // A FULL RELOAD, not a local merge. Deciding moves the sheet's phase to
      // `live`, which changes the whole page — the ledger appears, the ballot
      // goes away — and reconstructing all of that from one response would be
      // guessing at what the feed now says.
      close(() => window.location.reload());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      label="Close the last-place vote"
      onClose={busy ? null : onClose}
      panelClassName="max-h-[85dvh] max-w-[32rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-5">
          <h2 className="text-sm font-semibold">Close the vote?</h2>
          <p className="mt-1 text-xs leading-relaxed text-chalk-500">
            {turnout.voted} of {turnout.of} have voted. The winner is recorded and
            cannot be changed from here afterwards — and if the top is tied, those
            punishments go to a wheel for last place to spin at the end of the
            season.
          </p>

          {counts ? (
            <ul className="mt-3 space-y-1 text-xs text-chalk-500">
              {Object.entries(counts)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => (
                  <li key={id} className="flex gap-2">
                    <span className="tabular w-5 shrink-0 text-right font-semibold text-chalk-300">
                      {n}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {textOf(Number(id))}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void decide(close)}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Counting…" : "Close and record"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
