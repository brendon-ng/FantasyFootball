"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Hand-set weekly projections, player id -> week -> points.
 *
 * A BELIEF ABOUT A PLAYER, NOT PART OF A TRADE, so it lives in this browser
 * rather than the query string and survives switching from one trade to the
 * next: "I think he is back in week 9" holds whichever deal is on screen. That
 * means a shared link does not carry them, which is why the page badges itself
 * whenever any are active — an overridden board renders exactly like a real one.
 *
 * A player present with no weeks is PINNED but unedited: added to the panel and
 * waiting for a number. Nothing reads an empty entry as an override.
 *
 * Scoped per league: one browser visits several, and a league's projections are
 * scored with its own settings.
 */
export type ProjectionOverrides = Record<string, Record<string, number>>;

const KEY = `ff:${process.env.NEXT_PUBLIC_LEAGUE ?? "den-ops"}:projection-overrides`;

const listeners = new Set<() => void>();
let cache: ProjectionOverrides = {};
let loaded = false;

function load(): ProjectionOverrides {
  if (loaded) return cache;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw) as ProjectionOverrides;
  } catch {
    // Private browsing, or something unreadable. Start clean.
  }
  return cache;
}

function commit(next: ProjectionOverrides): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Still usable for the session.
  }
  for (const l of listeners) l();
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  // Another tab editing the same overrides should not silently diverge.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
};

const EMPTY: ProjectionOverrides = {};

export interface OverridesApi {
  overrides: ProjectionOverrides;
  /** Players with at least one week actually overridden. */
  activeCount: number;
  /** Add a player to the panel with nothing overridden yet. */
  pin: (id: string) => void;
  /** Set one week, or clear it with null. */
  setWeek: (id: string, week: number, points: number | null) => void;
  /** Set or clear every week in `weeks` at once. */
  setWeeks: (id: string, weeks: readonly number[], points: number | null) => void;
  /** Drop the player from the panel entirely. */
  remove: (id: string) => void;
  clearAll: () => void;
  /** Replace every override at once — adopting a share link's set. */
  replaceAll: (next: ProjectionOverrides) => void;
}

export function useProjectionOverrides(): OverridesApi {
  const overrides = useSyncExternalStore(subscribe, load, () => EMPTY);

  const pin = useCallback((id: string) => {
    const cur = load();
    if (!cur[id]) commit({ ...cur, [id]: {} });
  }, []);

  const setWeeks = useCallback((id: string, weeks: readonly number[], points: number | null) => {
    const cur = load();
    const next = { ...(cur[id] ?? {}) };
    for (const w of weeks) {
      if (points == null) delete next[String(w)];
      else next[String(w)] = points;
    }
    commit({ ...cur, [id]: next });
  }, []);

  const setWeek = useCallback(
    (id: string, week: number, points: number | null) => setWeeks(id, [week], points),
    [setWeeks],
  );

  const remove = useCallback((id: string) => {
    const next = { ...load() };
    delete next[id];
    commit(next);
  }, []);

  const clearAll = useCallback(() => commit({}), []);
  const replaceAll = useCallback((next: ProjectionOverrides) => commit({ ...next }), []);

  const activeCount = Object.values(overrides).filter((w) => Object.keys(w).length > 0).length;

  return { overrides, activeCount, pin, setWeek, setWeeks, remove, clearAll, replaceAll };
}

/**
 * Projections with the overrides laid on top, for the weeks given.
 *
 * An override can ADD a player the feed had nothing for — a player coming back
 * from injury is exactly the case — so it is written in whether or not the feed
 * had an entry.
 */
export function applyOverrides(
  byWeek: Record<number, Record<string, number>>,
  overrides: ProjectionOverrides,
): Record<number, Record<string, number>> {
  const touched = Object.entries(overrides).filter(([, w]) => Object.keys(w).length);
  if (!touched.length) return byWeek;
  const out: Record<number, Record<string, number>> = {};
  for (const [w, points] of Object.entries(byWeek)) {
    const copy = { ...points };
    for (const [id, weeks] of touched) {
      const v = weeks[w];
      if (typeof v === "number" && Number.isFinite(v)) copy[id] = v;
    }
    out[Number(w)] = copy;
  }
  return out;
}

/**
 * Overrides as a share-link parameter: `id~week~points`, joined by `_`.
 *
 * EVERY CHARACTER IS URL-UNRESERVED, so the link carries it verbatim rather
 * than a wall of percent escapes — the same reason `give` is a bare list.
 * CANONICAL: sorted by player then week, numbers as `String()` writes them,
 * because the signature covers this string and the signer and the verifier
 * must produce it byte for byte. Only weeks in `weeks` are kept when given, so
 * an override for a week already played does not lengthen every link.
 */
export function encodeOverrides(overrides: ProjectionOverrides, weeks?: readonly number[]): string {
  const keep = weeks ? new Set(weeks.map(String)) : null;
  const out: string[] = [];
  for (const id of Object.keys(overrides).sort()) {
    const byWeek = overrides[id];
    for (const w of Object.keys(byWeek).sort((x, y) => Number(x) - Number(y))) {
      const v = byWeek[w];
      if (keep && !keep.has(w)) continue;
      // Two decimals, so `String()` never reaches for exponent notation.
      if (typeof v === "number" && Number.isFinite(v)) out.push(`${id}~${w}~${Math.round(v * 100) / 100}`);
    }
  }
  return out.join("_");
}

/**
 * The reverse, refusing anything malformed outright rather than salvaging
 * part of it: a link either carries the overrides it was signed with or it
 * verifies as nothing, and a half-read set would be a third answer.
 */
export function decodeOverrides(raw: string): ProjectionOverrides | null {
  if (!raw) return {};
  const out: ProjectionOverrides = {};
  for (const part of raw.split("_")) {
    const m = /^([A-Za-z0-9-]+)~(\d{1,2})~(-?\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return null;
    (out[m[1]] ??= {})[String(Number(m[2]))] = Number(m[3]);
  }
  return out;
}
