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
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    const apply = () => {
      if (document.title !== title) document.title = title;
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
