"use client";

import { useState } from "react";

import { Sheet } from "@/components/sheet";
import { TeamNames } from "@/components/punishment-ledger";
import { completePunishment } from "@/lib/punishments-live";
import {
  formatCompleted,
  type LedgerRow,
  type TeamMap,
} from "@/lib/punishments";

/**
 * Today, in the reader's own timezone.
 *
 * NOT `toISOString().slice(0, 10)`, which is the UTC date — for anyone west of
 * Greenwich that is tomorrow for most of the evening, so logging a punishment
 * after dinner would date it a day late.
 */
const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Log the day a punishment was served.
 *
 * DEFAULTS TO TODAY, because that is when a punishment is nearly always logged
 * — somebody does the thing and somebody else marks it off. The field is a
 * native date input, so picking another day is the platform's own picker rather
 * than something invented here.
 *
 * CLEARING IS A FIRST-CLASS ACTION, not an omission. A date typed against the
 * wrong week has to be removable, and "mark it owed again" is the only way to
 * do that without editing the sheet by hand.
 */
export function CompleteModal({
  endpoint,
  league,
  season,
  row,
  teams,
  names,
  onSaved,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  row: LedgerRow;
  teams: TeamMap;
  names: Record<string, string>;
  onSaved: (completed: string | null) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(() => row.completed ?? today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (
    completed: string | null,
    close: (after?: () => void) => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await completePunishment(endpoint, {
        league,
        season,
        week: row.week,
        completed,
      });
      close(() => {
        onSaved(saved);
        onClose();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Sheet
      label="Log a completed punishment"
      onClose={onClose}
      panelClassName="max-h-[85dvh] max-w-[26rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3 sm:px-5">
            <div>
              <div className="eyebrow text-[10px]">
                {season} · Week {row.week}
              </div>
              <div className="text-sm font-semibold">
                <TeamNames
                  season={season}
                  slugs={row.losers}
                  teams={teams}
                  names={names}
                />
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

          <div className="space-y-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-5">
            {row.punishment ? (
              <p className="text-sm leading-relaxed text-chalk-300">
                {row.punishment.text}
              </p>
            ) : null}

            <label className="block">
              <span className="eyebrow text-[10px]">Completed on</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                // 16px on a phone: iOS zooms the whole page when a focused
                // field computes below that. See the note in AGENTS.
                className="mt-1.5 w-full rounded-lg border border-ink-500 bg-ink-850 px-3 py-2.5 text-base text-chalk-100 outline-none transition-colors focus:border-accent-dim sm:text-sm"
              />
            </label>

            {error ? (
              <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void save(date, close)}
              disabled={busy || !date}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : "Mark as completed"}
            </button>

            {/* Only where there is something to undo. Offering it on a row that
                was never completed is a control that cannot do anything. */}
            {row.completed ? (
              <button
                type="button"
                onClick={() => void save(null, close)}
                disabled={busy}
                className="w-full text-center text-xs text-chalk-500 underline-offset-2 transition-colors hover:text-loss hover:underline disabled:opacity-40"
              >
                Clear {formatCompleted(row.completed)} and mark it owed again
              </button>
            ) : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
