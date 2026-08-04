"use client";

/**
 * Query params that survive navigation.
 *
 * `?mockDraftOrder=true` is useless if it falls off the first time you click
 * through to an owner page. These are remembered for the tab and reapplied to the
 * URL after each navigation.
 *
 * SESSION STORAGE IS THE SOURCE OF TRUTH, not the URL. Rewriting every `<Link>`
 * would mean the server-rendered href and the client's disagree, which is a
 * hydration mismatch; and a reader that only checked the URL would race the
 * component that restores it. Storage is set before anything reads it and does not
 * depend on when the restore effect runs.
 *
 * Scoped to `sessionStorage`, so it dies with the tab. A debug flag that outlived
 * the session would be a great way to confuse yourself a week later.
 */

/** Params worth carrying. Add sparingly — each one is global state. */
export const STICKY_PARAMS = ["mockDraftOrder", "mockDraft"] as const;

const KEY = "ff:sticky-params";

type Bag = Record<string, string>;

const read = (): Bag => {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}") as Bag;
  } catch {
    return {};
  }
};

const write = (bag: Bag): void => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(bag));
  } catch {
    // Private browsing and similar. The flag simply will not persist.
  }
};

/**
 * Folds anything in the CURRENT url into storage, and returns the merged set.
 *
 * The URL wins when it names a param, which is what makes a flag switchable:
 * `?mockDraftOrder=false` (or any falsy value) clears it rather than being
 * shadowed by what was stored earlier.
 */
export function syncStickyParams(): Bag {
  if (typeof window === "undefined") return {};
  const bag = read();
  const url = new URLSearchParams(window.location.search);
  let changed = false;
  for (const name of STICKY_PARAMS) {
    if (!url.has(name)) continue;
    const value = url.get(name) ?? "";
    if (value === "" || value === "false") {
      if (name in bag) {
        delete bag[name];
        changed = true;
      }
    } else if (bag[name] !== value) {
      bag[name] = value;
      changed = true;
    }
  }
  if (changed) write(bag);
  return bag;
}

/** The live value of a sticky param, url or storage. */
export function stickyParam(name: (typeof STICKY_PARAMS)[number]): string | null {
  if (typeof window === "undefined") return null;
  return syncStickyParams()[name] ?? null;
}

/**
 * The two draft mocks, resolved together.
 *
 * MUTUALLY EXCLUSIVE, and `mockDraft` wins. It is the later state of the same
 * timeline — a finished draft implies an order — so honouring both would mean
 * asking for a drafted league and an undrafted one at once.
 */
export function draftMocks(): { order: boolean; complete: boolean } {
  const complete = stickyParam("mockDraft") === "true";
  return { complete, order: complete || stickyParam("mockDraftOrder") === "true" };
}

/** True when this session asked for a stand-in draft order. */
export const wantsMockOrder = (): boolean => draftMocks().order;

/** True when this session asked to see the league as if the draft had run. */
export const wantsMockCompleteDraft = (): boolean => draftMocks().complete;
