"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip that actually appears.
 *
 * Native `title` was doing none of the jobs asked of it: roughly a second of
 * delay before showing, nothing at all on touch, and no styling. It stays on
 * the trigger as a fallback for anything that reads the accessibility tree.
 *
 * POSITIONED FIXED, VIA A PORTAL. Panels are `overflow-hidden` and wide tables
 * sit in `overflow-x-auto` — which also clips vertically once it computes — so
 * an absolutely positioned bubble inside the layout gets cut off exactly where
 * the long explanations live. Rendering to `document.body` escapes every
 * clipping context.
 *
 * Opens on hover, focus and tap, so it is reachable by keyboard and on a phone.
 */
export function Tip({
  text,
  children,
  className = "",
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: r.left + r.width / 2 });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  // A tooltip pinned to a viewport coordinate goes stale the moment anything
  // moves, so dismiss rather than chase it.
  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos, hide]);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        role="button"
        aria-label={text}
        title={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        className={`cursor-help decoration-dotted underline-offset-2 outline-none hover:underline focus-visible:underline ${className}`}
      >
        {children}
      </span>

      {pos
        ? createPortal(
            <span
              role="tooltip"
              // -translate-x-1/2 centres on the trigger; clamped by max-width so
              // a long note near the viewport edge still fits.
              className="pointer-events-none fixed z-[200] max-w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border border-ink-500 bg-ink-900 px-2.5 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-chalk-300 shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
