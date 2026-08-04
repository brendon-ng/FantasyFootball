"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { STICKY_PARAMS, syncStickyParams } from "@/lib/sticky-params";

/**
 * Keeps sticky query params in the URL as you navigate.
 *
 * `<Link>` hrefs are written without them, so every client navigation drops them.
 * Rather than rewrite every link — which would make the server-rendered href
 * differ from the client's and break hydration — this puts them back afterwards.
 *
 * ONLY ADDS, never removes. A full page load reconciles storage to the URL before
 * anything reads it (see `adoptUrl`), so editing the address bar to drop a flag
 * works; this effect exists purely to carry flags across CLIENT navigation, where
 * `<Link>` hrefs are written without them.
 *
 * Cosmetic besides: readers use `stickyParam()`, backed by session storage, so
 * behaviour never depends on this effect having run.
 *
 * `replaceState`, not `push`: restoring a param is not a navigation, and pushing
 * would put a junk entry in history for every page you visit.
 */
export function StickyParams() {
  const pathname = usePathname();

  useEffect(() => {
    const bag = syncStickyParams();
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of STICKY_PARAMS) {
      const value = bag[name];
      if (value && url.searchParams.get(name) !== value) {
        url.searchParams.set(name, value);
        changed = true;
      }
      // Deliberately never DELETES from the URL. On a full load the URL is
      // already authoritative, and on a client navigation there is nothing to
      // remove — so a delete here could only ever fight the address bar.
    }
    if (changed) window.history.replaceState(null, "", url.toString());
  }, [pathname]);

  return null;
}
