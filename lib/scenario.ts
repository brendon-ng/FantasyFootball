"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A hypothetical draft: who kept whom, and what order the board runs in.
 *
 * EXPERIMENTAL — this module exists on the strategy-lab branch only and is not
 * meant to reach main. It is a planning tool, not a view of the league.
 *
 * THIS IS AN OVERRIDE, NOT A MOCK, and the distinction matters. Every existing
 * mock in this codebase (`lib/sticky-params.ts`, `?mockPhase=...`) only ever
 * FILLS IN A MISSING VALUE, so it goes quiet on its own once Sleeper has the real
 * thing. A scenario does the opposite: it deliberately contradicts live data so
 * you can ask "what if Cassidy passes on A.J. Brown". That means it can never be
 * allowed to go quiet, and every surface reading it must say so loudly — see
 * `ScenarioBadge`. A board rendered from a scenario is indistinguishable from a
 * real one, and that is exactly the screenshot someone would believe.
 *
 * Keyed by roster id rather than owner slug because that is what the draft board
 * and Sleeper's payloads both speak; the slug mapping only exists once rosters
 * have loaded in the browser.
 */

export interface Scenario {
  /**
   * slot -> rosterId. Null defers to Sleeper (which, before the order is drawn,
   * means the board says so rather than guessing).
   */
  order: Record<number, number> | null;
  /**
   * rosterId -> playerIds kept. A roster ABSENT from this map defers to whatever
   * it has locked in on Sleeper; a roster present with an empty array is an
   * explicit "keeps nobody". Those are different states and collapsing them
   * would make "pass on everyone" impossible to express.
   */
  keepers: Record<number, string[]>;
  /**
   * Fill unspent picks on the board with ADP — who the market says is available at each
   * unspent pick.
   *
   * A VIEW PREFERENCE, not part of the hypothetical, so it is deliberately left
   * out of `active`: turning the column off should not make the scenario badge
   * disappear. It rides along in the same record purely so it survives a reload
   * like everything else here.
   */
  fillAdp: boolean;
  /**
   * Player ids you have starred — a personal watchlist.
   *
   * NOT PART OF THE HYPOTHETICAL, like `fillAdp`: excluded from `active` and
   * preserved across a reset, because clearing a what-if should not throw away
   * the shortlist you built while exploring it. An array rather than a Set so it
   * round-trips through JSON.
   */
  starred: string[];
}

export const EMPTY_SCENARIO: Scenario = { order: null, keepers: {}, fillAdp: true, starred: [] };

/** Scoped per league: one browser visits both and roster ids do not correspond. */
const KEY = `ff:${process.env.NEXT_PUBLIC_LEAGUE ?? "den-ops"}:scenario`;

const listeners = new Set<() => void>();
let cache: Scenario = EMPTY_SCENARIO;
let loaded = false;

function load(): Scenario {
  if (loaded) return cache;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) cache = { ...EMPTY_SCENARIO, ...(JSON.parse(raw) as Scenario) };
  } catch {
    // Private browsing, or a shape from an older iteration. Start clean.
  }
  return cache;
}

function commit(next: Scenario): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Non-persistent is still usable for the session.
  }
  for (const l of listeners) l();
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  // Another tab editing the same scenario should not silently diverge.
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

// Null on the server: localStorage cannot be known during SSR, and rendering a
// guess would be a hydration mismatch. Callers gate on `ready`.
const serverSnapshot = () => null;

export interface ScenarioApi {
  scenario: Scenario;
  /** False until localStorage has been read. Render nothing scenario-shaped before this. */
  ready: boolean;
  /** True when the scenario says anything at all — drives the badge. */
  active: boolean;
  setOrder: (order: Record<number, number> | null) => void;
  setKeepers: (rosterId: number, playerIds: string[]) => void;
  /** Drop a roster's override so it follows Sleeper again. */
  clearRoster: (rosterId: number) => void;
  setFillAdp: (on: boolean) => void;
  toggleStar: (playerId: string) => void;
  clearStars: () => void;
  reset: () => void;
  /** Seed every roster from what Sleeper currently has, as a starting point. */
  seed: (keepersByRoster: Record<number, string[]>) => void;
}

export function useScenario(): ScenarioApi {
  const snap = useSyncExternalStore(subscribe, load, serverSnapshot);
  const scenario = snap ?? EMPTY_SCENARIO;
  const ready = snap !== null;

  const setOrder = useCallback((order: Record<number, number> | null) => {
    commit({ ...load(), order });
  }, []);

  const setKeepers = useCallback((rosterId: number, playerIds: string[]) => {
    const cur = load();
    commit({ ...cur, keepers: { ...cur.keepers, [rosterId]: playerIds } });
  }, []);

  const clearRoster = useCallback((rosterId: number) => {
    const cur = load();
    const next = { ...cur.keepers };
    delete next[rosterId];
    commit({ ...cur, keepers: next });
  }, []);

  const setFillAdp = useCallback((on: boolean) => {
    commit({ ...load(), fillAdp: on });
  }, []);

  const toggleStar = useCallback((playerId: string) => {
    const cur = load();
    const has = cur.starred.includes(playerId);
    commit({
      ...cur,
      starred: has ? cur.starred.filter((id) => id !== playerId) : [...cur.starred, playerId],
    });
  }, []);

  const clearStars = useCallback(() => commit({ ...load(), starred: [] }), []);

  // Keeps the view preference and the watchlist across a reset — you are clearing a hypothesis,
  // not changing your mind about which columns you want to see.
  const reset = useCallback(
    () => commit({ ...EMPTY_SCENARIO, fillAdp: load().fillAdp, starred: load().starred }),
    [],
  );

  const seed = useCallback((keepersByRoster: Record<number, string[]>) => {
    commit({ ...load(), keepers: keepersByRoster });
  }, []);

  return {
    scenario,
    ready,
    active: ready && (scenario.order !== null || Object.keys(scenario.keepers).length > 0),
    setOrder,
    setKeepers,
    clearRoster,
    setFillAdp,
    toggleStar,
    clearStars,
    reset,
    seed,
  };
}

/**
 * A draft order drawn at random.
 *
 * Distinct from `mockDraftOrder` in lib/draft-slots.ts, which is deterministic
 * and seeded by the draft id so a screenshot stays reproducible. Here you WANT a
 * different answer each time — the whole point is sampling where your slot could
 * land, which is the risk the keeper deadline forces you to take blind.
 */
export function randomOrder(rosterIds: number[]): Record<number, number> {
  const pool = [...rosterIds];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return Object.fromEntries(pool.map((rosterId, i) => [i + 1, rosterId]));
}
