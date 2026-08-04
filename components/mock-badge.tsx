"use client";

import { useSyncExternalStore } from "react";

import { PHASE_LABEL } from "@/lib/phase";
import { mockPhase } from "@/lib/sticky-params";

/**
 * A persistent marker that this page view is faking a league phase.
 *
 * Every mocked surface renders identically to a real one — that is the point of
 * them — which makes it far too easy to screenshot a stand-in draft order, or a
 * scoreboard of invented numbers, and believe it. This sits in the nav for as
 * long as a flag is on.
 *
 * Read through `useSyncExternalStore` with a null server snapshot: the flag lives
 * in session storage, so the server cannot know it, and rendering it during SSR
 * would be a hydration mismatch.
 */

const subscribeToNothing = () => () => {};
const noneOnServer = () => null;

export function MockBadge() {
  const phase = useSyncExternalStore(subscribeToNothing, mockPhase, noneOnServer);
  if (!phase) return null;

  return (
    <span
      className="shrink-0 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold"
      title={`Simulating "${PHASE_LABEL[phase]}". Nothing here is necessarily real — remove the mock parameter from the URL to see the league as it is.`}
    >
      Mock · {PHASE_LABEL[phase]}
    </span>
  );
}
