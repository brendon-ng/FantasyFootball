"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Paired record lists that expand together.
 *
 * Two lists side by side are read as a comparison — highest against lowest,
 * blowouts against nail-biters — so letting one grow to 20 while its partner
 * stays at 10 breaks the alignment that makes the pair legible. A row shares one
 * open state.
 */
const RowCtx = createContext<{ open: boolean; toggle: () => void } | null>(null);

export function ExpandableRow({
  children,
  className = "grid gap-5 lg:grid-cols-2",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, toggle: () => setOpen((v) => !v) }), [open]);
  return (
    <RowCtx.Provider value={value}>
      <div className={className}>{children}</div>
    </RowCtx.Provider>
  );
}

/**
 * Shows the head of a list with a control to reveal the rest.
 *
 * Rows are built by the server component and passed through as elements, so
 * nothing about the data or its rendering moves to the client — only the
 * decision of how many to display. Falls back to local state when used outside
 * a row.
 */
export function ExpandableList({
  items,
  initial = 10,
  max = 20,
  noun = "entries",
}: {
  items: React.ReactNode[];
  initial?: number;
  /** Hard cap once expanded; the underlying arrays hold more. */
  max?: number;
  noun?: string;
}) {
  const row = useContext(RowCtx);
  const [localOpen, setLocalOpen] = useState(false);
  const open = row ? row.open : localOpen;
  const toggle = row ? row.toggle : () => setLocalOpen((v) => !v);

  const capped = items.slice(0, max);
  const shown = open ? capped : capped.slice(0, initial);

  return (
    <>
      <ol className="divide-y divide-ink-700">{shown}</ol>
      {capped.length > initial ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1.5 border-t border-ink-600 px-4 py-2 text-[11px] font-medium text-chalk-500 transition-colors hover:bg-ink-700/40 hover:text-accent"
        >
          {open ? `Show top ${initial}` : `Show top ${capped.length} ${noun}`}
          <span aria-hidden className={`text-[8px] transition-transform ${open ? "rotate-180" : ""}`}>
            ▼
          </span>
        </button>
      ) : null}
    </>
  );
}
