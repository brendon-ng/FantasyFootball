"use client";

import { useEffect } from "react";

/**
 * Rename the tab while something is on screen that the route's own title does
 * not describe.
 *
 * WHY THIS IS NOT JUST `document.title = x` IN AN EFFECT. The title is a SHARED
 * RESOURCE: the route's title is baked by `generateMetadata` at build time and
 * rendered into the head as a real element, so the framework is also a writer.
 * A one-shot imperative write wins only if nothing re-commits that element
 * afterwards, which is a timing assumption rather than a guarantee — and when
 * it loses, it loses silently and leaves the tab describing a page that is
 * behind a dialog.
 *
 * So this KEEPS the title rather than setting it: a MutationObserver on the
 * head re-asserts the value if anything else writes one. It watches the head
 * rather than the `<title>` node because a re-render can replace that node
 * outright, which an observer bound to the old one would never see.
 *
 * It cannot loop. `apply` only writes when the title actually differs, and the
 * write it makes satisfies that test — so the mutation it triggers is a no-op
 * and the cycle stops after one pass.
 *
 * Pass null when the thing is gone; the previous title is put back on the way
 * out, so dismissing a dialog restores the page's own name.
 *
 * THE ICON IS HELD THE SAME WAY, and only the title is meant to change. Renaming
 * the tab must not also restyle it: the favicon is the league's own avatar,
 * which is how two leagues served from one repo are told apart in a tab strip,
 * and a draw link is usually opened in a fresh tab where that is the only
 * marker of which league it belongs to. The href is snapshotted when the
 * dialog opens and re-asserted by the same observer, so anything that drops or
 * rewrites the link while the tab is renamed gets it back.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    const iconSelector = 'link[rel~="icon"]';
    const icon = document.head.querySelector<HTMLLinkElement>(iconSelector)?.href ?? null;
    const apply = () => {
      if (document.title !== title) document.title = title;
      if (!icon) return;
      const link = document.head.querySelector<HTMLLinkElement>(iconSelector);
      if (!link) {
        // Gone entirely: put one back rather than leaving the browser to fall
        // through to its own default.
        const replacement = document.createElement("link");
        replacement.rel = "icon";
        replacement.href = icon;
        document.head.appendChild(replacement);
      } else if (link.href !== icon) {
        link.href = icon;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [title]);
}
