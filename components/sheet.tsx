"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The one bottom sheet.
 *
 * Every dialog on the site is the same thing at two widths — flush to the bottom
 * edge of a phone, centred on a desktop — and each one had grown its own copy of
 * the escape key, the scroll lock, the backdrop click and the stopPropagation
 * that stops selecting text from dismissing it. Three copies of four behaviours
 * is three chances for one of them to be missing, and the identity picker was
 * already missing the scroll lock.
 *
 * WHY A RENDER PROP. Closing has to be animated, and an animated close cannot be
 * "call `onClose`" — that unmounts the dialog mid-slide. Everything that
 * dismisses goes through `close()`, which plays the exit and then hands control
 * back. Children need to reach it (a Close button, a successful submit, picking
 * an owner), and passing it down is more honest than a context for one value.
 *
 * `close(after)` runs `after` INSTEAD of `onClose` when given, which is how a
 * choice that also dismisses — the identity picker — animates out before it
 * takes effect.
 *
 * A NULL `onClose` MEANS THE DIALOG MUST BE ANSWERED: no escape key, no backdrop
 * click. The first-visit identity prompt is the case. `close(after)` still
 * works, because choosing is how you answer it.
 */
export function Sheet({
  label,
  onClose,
  zClassName = "z-50",
  backdropClassName = "sm:p-4",
  panelClassName = "",
  children,
}: {
  label: string;
  /** Null when the dialog cannot be dismissed without answering it. */
  onClose: (() => void) | null;
  zClassName?: string;
  backdropClassName?: string;
  panelClassName?: string;
  children: (api: { close: (after?: () => void) => void }) => ReactNode;
}) {
  const [leaving, setLeaving] = useState(false);
  // Held in a ref rather than state: it is read once, by an animation callback,
  // and nothing renders differently for it.
  const pending = useRef<(() => void) | null>(null);

  const close = useCallback(
    (after?: () => void) => {
      const fn = after ?? onClose;
      if (!fn) return;
      // A second dismissal mid-exit must not restart the animation or swap what
      // happens at the end of it.
      setLeaving((already) => {
        if (!already) pending.current = fn;
        return true;
      });
    },
    [onClose],
  );

  const finish = useCallback(() => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) close();
    };
    // The page behind must not scroll — otherwise the wheel moves the list
    // underneath rather than the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, close]);

  /**
   * If `animationend` never arrives, close anyway.
   *
   * It does not arrive in a background tab, where animations are throttled, and
   * would not if a future stylesheet dropped the animation. A dialog stuck open
   * because a decoration failed is a far worse bug than one that closes without
   * sliding.
   */
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, 450);
    return () => clearTimeout(timer);
  }, [leaving, finish]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-leaving={leaving ? "" : undefined}
      onClick={onClose ? () => close() : undefined}
      className={`sheet-backdrop fixed inset-0 flex items-end justify-center bg-ink-900/80 backdrop-blur-sm sm:items-center ${zClassName} ${backdropClassName}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // Only this element's own animation counts. A child's — the skeleton
        // sweep, say — would otherwise close the dialog out from under it.
        onAnimationEnd={(e) => {
          if (leaving && e.target === e.currentTarget) finish();
        }}
        data-leaving={leaving ? "" : undefined}
        className={`sheet-panel w-full ${panelClassName}`}
      >
        {children({ close })}
      </div>
    </div>
  );
}
