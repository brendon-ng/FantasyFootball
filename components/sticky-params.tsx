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
 * COSMETIC ONLY. Readers use `stickyParam()`, which is backed by session storage,
 * so behaviour never depends on this effect having run. All this does is keep the
 * address bar honest and the URL shareable.
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
      // A param cleared this session should not linger in the bar.
      if (!value && url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", url.toString());
  }, [pathname]);

  return null;
}
