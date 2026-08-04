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
 * THE URL WINS ON A FULL PAGE LOAD. Storage only survives client navigation.
 *
 * Runs once per document load, before anything reads a flag — module state, not
 * an effect, because effects in child components run before the layout's and
 * would otherwise read a stale value.
 *
 * This is what makes a flag switchable by hand. Editing the address bar to drop
 * `?mockDraft=true` and pressing enter is a full load, so storage is rebuilt from
 * the bare URL and the flag is genuinely gone. Treating storage as authoritative
 * meant the app kept putting the param back, which is a horrible thing to fight.
 */
let adopted = false;

function adoptUrl(): Bag {
  const bag: Bag = {};
  const url = new URLSearchParams(window.location.search);
  for (const name of STICKY_PARAMS) {
    const value = url.get(name);
    // An explicit falsy value is a way to switch a flag off in one navigation.
    if (value && value !== "false") bag[name] = value;
  }
  write(bag);
  return bag;
}

/** The sticky set for this page view. */
export function syncStickyParams(): Bag {
  if (typeof window === "undefined") return {};
  if (!adopted) {
    adopted = true;
    return adoptUrl();
  }
  return read();
}

/** The live value of a sticky param. */
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
