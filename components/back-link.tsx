"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

/**
 * A back link that names where you actually came from.
 *
 * Every page used to hardcode its parent — "← History" on an owner page even if
 * you arrived from a matchup — so the label was often a lie and the destination
 * threw away where you were.
 *
 * TWO THINGS MAKE THIS WORK, and both matter:
 *
 * `router.back()`, not a `<Link>` to the previous path. A Link is a PUSH: it
 * appends to history and starts the new page at the top, so returning to a table
 * you had scrolled halfway down dumps you at its header. Going back is a POP, and
 * the browser restores the scroll position it saved.
 *
 * A TRAIL KEYED ON HISTORY POSITION, not a naive stack. Marking each history
 * entry with an index tells a genuine back from a forward navigation to a page
 * you have already seen — a plain stack cannot, and gets A → B → A wrong, which
 * would leave the button labelled one thing and going somewhere else. A label
 * that disagrees with the destination is worse than a hardcoded one.
 */

const TRAIL = "ff:trail";
const LAST = "ff:trail-last";

interface Entry {
  path: string;
  label: string;
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing. The fallback link still works.
  }
};

/** Notifies mounted BackLinks that the trail moved. */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The entry before the one being viewed, or null at the start of a session. */
function previous(): Entry | null {
  if (typeof window === "undefined") return null;
  const idx = (window.history.state as { ffIdx?: number } | null)?.ffIdx;
  if (typeof idx !== "number" || idx <= 0) return null;
  return read<Record<string, Entry>>(TRAIL, {})[String(idx - 1)] ?? null;
}

const noneOnServer = () => null;

/**
 * Records each page as it is visited. Mounted once, in the layout.
 *
 * The label is the page's own `<h1>`, so nothing has to declare a name for the
 * benefit of other pages — titles were the obvious alternative and are not set
 * on every route, while an h1 is.
 */
export function BackTrail() {
  const pathname = usePathname();

  useEffect(() => {
    const state = (window.history.state ?? {}) as { ffIdx?: number };
    let idx = state.ffIdx;

    if (typeof idx !== "number") {
      // A fresh entry: Next pushed it without our marker. Number it one past the
      // furthest we have seen, so a pop later reads a LOWER index and is not
      // mistaken for a new page.
      idx = read<number>(LAST, -1) + 1;
      window.history.replaceState({ ...state, ffIdx: idx }, "");
    }

    const h1 = document.querySelector("h1")?.textContent ?? "";
    const label = h1.replace(/\s+/g, " ").trim().slice(0, 40) || "Back";

    const trail = read<Record<string, Entry>>(TRAIL, {});
    trail[String(idx)] = { path: pathname, label };
    write(TRAIL, trail);
    write(LAST, Math.max(idx, read<number>(LAST, -1)));
    emit();
  }, [pathname]);

  return null;
}

/**
 * Back to the previous page, or to `fallback` when there is not one.
 *
 * The fallback is what a page used to hardcode, and is still needed: someone
 * arriving from a shared link has no history to go back to, and `router.back()`
 * would take them off the site.
 */
export function BackLink({ fallback }: { fallback: { href: string; label: string } }) {
  const router = useRouter();
  const prev = useSyncExternalStore(subscribe, previous, noneOnServer);

  const className = "text-xs text-chalk-600 transition-colors hover:text-accent";

  if (!prev) {
    return (
      <Link href={fallback.href} className={className}>
        ← {fallback.label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={className}>
      ← {prev.label}
    </button>
  );
}
