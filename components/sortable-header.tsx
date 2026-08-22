"use client";

import type { ReactNode } from "react";

/**
 * A clickable column heading.
 *
 * Shared by the available-pool table and the keeper-selection list, which want
 * identical behaviour — a second copy would be a second answer to "which way
 * does the first click go".
 */

export type Dir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: Dir;
}

export function SortHeader<K extends string>({
  k,
  first,
  w,
  t,
  align = "right",
  state,
  onSort,
  children,
}: {
  k: K;
  /**
   * Which way this column goes on its FIRST click.
   *
   * Descending for anything where more is better, ascending for names and for
   * figures that count up as value counts down (ADP, cost round). Making every
   * column start ascending means the first click on "points" shows the worst
   * players in the league and you always click twice.
   */
  first: Dir;
  w: string;
  t: string;
  align?: "left" | "right";
  state: SortState<K>;
  onSort: (next: SortState<K>) => void;
  children: ReactNode;
}) {
  const active = state.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: k, dir: active ? (state.dir === "asc" ? "desc" : "asc") : first })}
      title={`${t} — click to sort`}
      className={`${w} shrink-0 uppercase tracking-wide transition-colors ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-accent" : "hover:text-chalk-300"}`}
    >
      {children}
      {active ? <span className="ml-0.5">{state.dir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

/**
 * Compares two sort values, sinking blanks in BOTH directions.
 *
 * A blank is "this does not apply", not a zero: sorting passing yards ascending
 * must not open with three hundred receivers before the first quarterback. Only
 * the present values reverse.
 */
export function compareSort(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: Dir,
): number {
  const blank = (v: typeof a) => v == null || v === "" || v === 0;
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  const cmp =
    typeof a === "string" || typeof b === "string"
      ? String(a).localeCompare(String(b))
      : (a as number) - (b as number);
  return dir === "asc" ? cmp : -cmp;
}
