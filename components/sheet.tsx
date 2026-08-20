"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * How much of the screen the on-screen keyboard is covering.
 *
 * A `position: fixed` element is placed against the LAYOUT viewport, and iOS
 * does not shrink that when the keyboard opens — it only shrinks the VISUAL
 * viewport and scrolls the focused field into view. So a bottom sheet pinned
 * with `items-end` sits underneath the keyboard, which is exactly what a sheet
 * containing a text field does the moment it autofocuses.
 *
 * `visualViewport` is the only thing that reports this on iOS.
 * `interactive-widget=resizes-content` on the viewport meta does the same job
 * declaratively but is Chromium-only, and `dvh` accounts for browser chrome
 * rather than the keyboard.
 *
 * `offsetTop` is in the sum because iOS scrolls the visual viewport within the
 * layout viewport to reveal the field; without it the inset is overstated by
 * however far it scrolled.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset(
        Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
      );
    // Deferred rather than called here: the keyboard is not up yet on the frame
    // a dialog mounts, and setting state during an effect is a cascading render.
    const first = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(first);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}

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
  const keyboard = useKeyboardInset();
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
      // Padding rather than a height or a transform: `items-end` then lands the
      // panel on the padding edge, which is the top of the keyboard, and the
      // centred desktop case keeps working untouched because the inset is 0.
      style={keyboard ? { paddingBottom: keyboard } : undefined}
      className={`sheet-backdrop fixed inset-0 flex items-end justify-center bg-ink-900/80 backdrop-blur-sm sm:items-center ${zClassName} ${backdropClassName}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        // The panel's own `max-h` is a share of the WHOLE screen, which is more
        // room than there is once the keyboard has taken half of it. Inline so
        // it beats the class, and only while the keyboard is up.
        style={
          keyboard
            ? { maxHeight: `calc(100dvh - ${keyboard}px - 1rem)` }
            : undefined
        }
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
