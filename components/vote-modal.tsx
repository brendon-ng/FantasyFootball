"use client";

import { useState } from "react";

import { Sheet } from "@/components/sheet";
import { castBallot } from "@/lib/punishments-live";
import type { Ballot, PunishmentSuggestion } from "@/lib/punishments";

/**
 * Approve as many punishments as you like.
 *
 * NO VOTE COUNTS IN HERE, deliberately, and that is also why the list is ordered
 * BY ID rather than by score. The counts are public and shown on the page behind
 * this, but reading them while deciding is the bandwagon pressure a secret
 * ballot exists to avoid — and sorting by popularity would leak the ranking just
 * as effectively as printing it. Submission order is the neutral order.
 *
 * ONE SAVE, NOT AUTOSAVE PER TICK. Every write is a round trip to Apps Script at
 * about a second each, so a checkbox that saved itself would feel broken and
 * would race with itself when someone ticked four boxes quickly.
 *
 * THE BALLOT IS EDITABLE UNTIL VOTING CLOSES, so this opens pre-filled with what
 * the server has and a save replaces it wholesale — there is no add/remove
 * protocol to get out of step, and the row is keyed by voter so a second device
 * simply loads the same thing.
 */
export function VoteModal({
  endpoint,
  league,
  season,
  voter,
  suggestions,
  current,
  onSaved,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  voter: string;
  suggestions: PunishmentSuggestion[];
  /** What the server already has for this voter. */
  current: number[];
  onSaved: (ballot: Ballot, votes: Record<number, number>) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ballot = [...suggestions].sort((a, b) => a.id - b.id);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = async (close: (after?: () => void) => void) => {
    setBusy(true);
    setError(null);
    try {
      const { ballot: saved, votes } = await castBallot(endpoint, {
        league,
        season,
        voter,
        punishmentIds: [...picked].sort((a, b) => a - b),
      });
      close(() => {
        onSaved(saved, votes);
        onClose();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      label="Cast your votes"
      onClose={onClose}
      panelClassName="max-h-[85dvh] max-w-[32rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-800 px-4 py-3 sm:px-5">
            <div>
              <div className="eyebrow text-[10px]">{season} ballot</div>
              <div className="text-sm font-semibold">
                {picked.size
                  ? `${picked.size} selected`
                  : "Pick as many as you like"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close"
              className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Close
            </button>
          </div>

          <ul className="divide-y divide-ink-700">
            {ballot.map((s) => {
              const on = picked.has(s.id);
              return (
                <li key={s.id}>
                  {/* The whole row is the target. A 14px checkbox is a poor one
                      on a phone, and there is nothing else in the row to hit. */}
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors sm:px-5 ${
                      on ? "bg-accent/[0.07]" : "hover:bg-ink-700/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(s.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span
                      className={`text-sm ${on ? "text-chalk-100" : "text-chalk-300"}`}
                    >
                      {s.text}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-0 space-y-3 border-t border-ink-600 bg-ink-800 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
            {error ? (
              <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                {error}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void save(close)}
              disabled={busy}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save ballot"}
            </button>
            {picked.size ? (
              <p className="text-center text-[11px] text-chalk-600">
                You can change this until voting closes.
              </p>
            ) : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
