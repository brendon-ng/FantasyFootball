"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A control's state, kept in the query string.
 *
 * WHY THE URL AND NOT `useState`. A view someone has set up — the graph open, the
 * picks folded in — is worth sending to somebody else, and on a static site the
 * query string is the only place to put it. It also survives a reload, which
 * plain state does not.
 *
 * DELIBERATELY NOT STICKY. Nothing is written to storage and no `<Link>` carries
 * these params, so they die with the page. That is the difference between "here
 * is the view I am looking at" and a preference — a toggle that followed you onto
 * every later trade would be a setting nobody asked to change.
 *
 * `replaceState`, NOT `pushState`. A toggle is not a navigation: pushing would
 * make the back button undo a checkbox rather than leave the page, and it would
 * mint a history entry that `BackTrail` then stamps and labels as a page visit.
 * The existing state object is passed straight back through for the same reason —
 * that is where `ffIdx` lives, and dropping it breaks the back button outright.
 *
 * A DEFAULT VALUE CLEARS THE PARAM rather than spelling itself out, so an
 * untouched page has a clean URL and the two toggles cannot leave `?view=cascade`
 * behind after a round trip.
 */
export function useUrlState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  /**
   * The whole query string is the snapshot, because it is a STRING: React
   * compares snapshots with `Object.is`, and two equal strings pass. Returning a
   * parsed object here would never settle and would loop — the mistake this
   * codebase has already made once, in `back-link.tsx`.
   */
  const search = useSyncExternalStore(subscribe, read, onServer);
  const raw = new URLSearchParams(search).get(key);
  const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

  const set = useCallback(
    (next: T) => {
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(window.history.state, "", url);
      emit();
    },
    [key, fallback],
  );

  return [value, set];
}

/** The on/off flavour. Off is the default, so off leaves no param behind. */
export function useUrlFlag(key: string): [boolean, (on: boolean) => void] {
  const [value, set] = useUrlState(key, FLAG, "0");
  return [value === "1", useCallback((on: boolean) => set(on ? "1" : "0"), [set])];
}

const FLAG = ["0", "1"] as const;

const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};

/**
 * `popstate` as well as our own writes: the params survive a reload, so someone
 * can arrive on a mid-history entry that carries them.
 */
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};

const read = () => window.location.search;

/**
 * No query string at build time, so every control renders its default into the
 * HTML and takes the URL's value on hydration.
 */
const onServer = () => "";
