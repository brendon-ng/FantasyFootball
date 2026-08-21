"use client";

import { useEffect, useRef } from "react";

/**
 * The prize wheel.
 *
 * TWO PHASES, AND THE HANDOFF BETWEEN THEM IS THE POINT.
 *
 * 1. FREE — starts the instant the button is pressed, before the server has
 *    answered. A linear infinite rotation, so there is no dead moment while a
 *    write is in flight. Nothing has been decided yet and the wheel does not
 *    pretend otherwise; it is just moving.
 * 2. LANDING — the draw comes back, and the wheel decelerates onto the slice
 *    that is already written down. The draw was never the wheel's to make, so
 *    this is a reveal.
 *
 * THE HANDOFF READS THE LIVE MATRIX rather than assuming where the free spin
 * had got to. Swapping an infinite animation for a transform would otherwise
 * snap the wheel back to zero and then ease from there, which looks like a
 * glitch. Reading the computed rotation, pinning it, flushing layout, and only
 * then setting the target makes the deceleration continue from exactly where
 * the spin was.
 *
 * ALL OF IT IS IMPERATIVE, driven from a ref. The phase never changes what is
 * rendered — only how the same `<g>` is being animated — so holding it in state
 * would re-render for nothing and put a setState inside an effect.
 *
 * SLICE 0 STARTS AT TWELVE O'CLOCK and they run clockwise, so slice `i` sits
 * under the pointer when the wheel has turned by `-(i * step + step / 2)` plus
 * any whole number of turns.
 *
 * LABELS RUN ALONG THE RADIUS, from the rim inward. Anchored at the rim with
 * `text-anchor="start"` and rotated to `mid + 90`, which points the reading
 * direction at the hub — so a label always begins at the edge and every one
 * starts in the same place however long it is.
 *
 * THE ROOM IS THE RADIUS, NOT THE WEDGE, and that is what sets the character
 * budget: the same ~120px from rim to hub whether the pool has four or
 * seventeen. Only the font shrinks with slice count, because a narrow wedge
 * bounds the line HEIGHT rather than the length. Truncation is measured against
 * that, not guessed — the first version allowed 48 characters in a quarter
 * wedge and ran the text clean across the wheel and out the far side.
 *
 * REDUCED MOTION SKIPS THE FREE SPIN ENTIRELY. The blanket rule in globals.css
 * clamps every duration to almost nothing, which would leave an infinite
 * animation restarting every frame — a strobe, and a busy CPU. There the wheel
 * simply waits, then snaps to the answer, and the reveal still fires.
 */

/** The dataviz palette, in its validated order. See the charts note in AGENTS. */
const HUES = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

/** How fast the wheel turns while it waits. The landing is matched to it. */
const FREE_MS_PER_TURN = 650;
const FREE_DEG_PER_MS = 360 / FREE_MS_PER_TURN;

/**
 * The shape of the run-down.
 *
 * ONLY TWO THINGS ABOUT THIS CURVE MATTER. Its slope where it ENDS is zero, so
 * the wheel comes to rest rather than stopping dead. Its slope where it BEGINS
 * is `OPENING_SLOPE`, which is what the duration is derived from below and what
 * keeps the handoff from the free spin seamless.
 *
 * A CUBIC EASE-OUT, arrived at by trying longer tails and preferring this. A
 * fatter tail keeps the wheel visibly creeping later — five times as much
 * travel left at 90% of the run-down — but in practice that reads as the wheel
 * struggling to stop rather than coming to rest, and it costs seconds. Constant
 * deceleration (quadratic) is the other end and stops too briskly.
 *
 * `cubic-bezier(1/3, 1, 2/3, 1)` IS `1 - (1 - x)^3` exactly, not an
 * approximation: those control points make x(t) = t, so the easing is precisely
 * that polynomial and its opening slope is exactly 3. That is what lets the
 * duration below be derived rather than tuned.
 */
const OPENING_SLOPE = 3;
const EASE = "cubic-bezier(0.333, 1, 0.667, 1)";
/** Turns to travel beyond whatever is needed to reach the slice. */
const EXTRA_TURNS = 3;

const SIZE = 320;
const C = SIZE / 2;
const R = C - 6;
/** Labels start just inside the rim and read toward the hub. */
const LABEL_R = R - 8;
/** Everything between the rim and the hub is theirs. */
const LABEL_SPACE = LABEL_R - 30;

/**
 * The palette repeats every eight slices, so a pool of nine or seventeen puts
 * the same hue at both ends of the ring — where they meet, and read as one
 * slice. Nudging the last one along is cheaper than inventing more hues that
 * would not be separable anyway.
 */
export const hueFor = (i: number, total: number) =>
  HUES[
    (i === total - 1 && total % HUES.length === 1 ? i + 1 : i) % HUES.length
  ];

const point = (deg: number, radius: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(rad), C + radius * Math.sin(rad)] as const;
};

/** The rotation actually on screen right now, in degrees. */
function currentRotation(el: Element): number {
  const raw = getComputedStyle(el).transform;
  if (!raw || raw === "none") return 0;
  try {
    const m = new DOMMatrixReadOnly(raw);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch {
    return 0;
  }
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Wheel({
  slices,
  landOn,
  spinning,
  settledAt = null,
  onRest,
}: {
  slices: Array<{ id: number; text: string }>;
  /** Index into `slices`, or null until the draw has come back. */
  landOn: number | null;
  spinning: boolean;
  /**
   * Already drawn, before this dialog was ever opened.
   *
   * The wheel renders resting on it, with no animation and no reveal to fire —
   * a record of a draw that happened, not a draw about to happen.
   */
  settledAt?: number | null;
  onRest: () => void;
}) {
  const ref = useRef<SVGGElement>(null);
  const phase = useRef<"idle" | "free" | "landing">("idle");
  const step = 360 / slices.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Opened on a week that was drawn earlier: sit on the answer.
    if (settledAt != null && phase.current === "idle") {
      phase.current = "landing";
      el.style.transition = "none";
      el.style.transform = `rotate(${-(settledAt * step + step / 2)}deg)`;
      return;
    }

    // Spin the moment the button is pressed, not when the server answers.
    if (spinning && phase.current === "idle") {
      phase.current = "free";
      if (!prefersReducedMotion()) {
        el.style.transition = "none";
        el.style.animation = `wheel-free ${FREE_MS_PER_TURN}ms linear infinite`;
      }
    }

    // The write failed, so nothing was drawn and the wheel should stop.
    if (!spinning && phase.current === "free") {
      phase.current = "idle";
      el.style.animation = "none";
      el.style.transform = "rotate(0deg)";
    }

    if (landOn != null && phase.current === "free") {
      phase.current = "landing";
      const from = currentRotation(el);

      // Pin the wheel where it visibly is, with the animation and any
      // transition off, and force layout so the browser treats this as the
      // start of the next transition rather than folding both into one step.
      el.style.animation = "none";
      el.style.transition = "none";
      el.style.transform = `rotate(${from}deg)`;
      void el.getBoundingClientRect();

      /**
       * ANYWHERE ON THE RIGHT SLICE, not always its middle.
       *
       * The slice is the server's; where on it the pointer stops is not, and
       * always stopping dead centre is the tell that makes a wheel look
       * scripted. Kept to the middle 70% so it is never ambiguous which slice
       * won.
       */
      const offset = landOn * step + step * (0.15 + Math.random() * 0.7);
      // At least EXTRA_TURNS more from wherever the free spin happens to be.
      const settle =
        (((-(from + offset) % 360) + 360) % 360) + 360 * EXTRA_TURNS;

      /**
       * THE DECELERATION STARTS AT EXACTLY THE FREE SPIN'S SPEED.
       *
       * A fixed duration cannot do that: a 3.6s ease-out over two turns begins
       * about three times faster than the wheel was already going, so the
       * handoff read as a lurch — the wheel visibly grabbed and hauled itself
       * to the answer, which looks rigged.
       *
       * The curve opens at `OPENING_SLOPE`, so its opening speed is
       * `OPENING_SLOPE * distance / duration`. Setting `duration =
       * OPENING_SLOPE * distance / v0` makes that identically `v0`, and the
       * wheel simply keeps going and runs down — whatever curve is used.
       * Drawing the stop out further is therefore a matter of picking a
       * steeper-opening curve, and cannot reintroduce the lurch.
       *
       * The duration VARIES with how far it has to travel, which is the price
       * of a seamless handoff and is invisible: a spin that crosses more of the
       * wheel takes longer, exactly as a real one would.
       */
      const duration = Math.round((OPENING_SLOPE * settle) / FREE_DEG_PER_MS);
      el.style.transition = `transform ${duration}ms ${EASE}`;
      el.style.transform = `rotate(${from + settle}deg)`;
    }
  }, [spinning, landOn, settledAt, step]);

  // A narrow wedge bounds the line height, so the font follows the slice count;
  // the length available is the radius either way. 0.55em per character is a
  // deliberately pessimistic average for bold text, so nothing overruns the hub.
  const size = slices.length > 12 ? 9 : slices.length > 6 ? 10.5 : 12;
  const cap = Math.max(6, Math.floor(LABEL_SPACE / (size * 0.55)));

  return (
    <div className="relative mx-auto w-full max-w-[20rem]">
      {/* The pointer, biting into the top of the wheel. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-chalk-100 drop-shadow"
      />
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Wheel of ${slices.length} remaining punishments`}
      >
        <g
          ref={ref}
          style={{ transformOrigin: "50% 50%" }}
          onTransitionEnd={(e) => {
            if (e.propertyName === "transform" && phase.current === "landing") {
              onRest();
            }
          }}
        >
          {slices.map((s, i) => {
            const a0 = i * step;
            const a1 = a0 + step;
            const [x0, y0] = point(a0, R);
            const [x1, y1] = point(a1, R);
            const mid = a0 + step / 2;
            const [lx, ly] = point(mid, LABEL_R);
            const label =
              s.text.length > cap
                ? `${s.text.slice(0, cap - 1).trimEnd()}…`
                : s.text;
            return (
              <g key={s.id}>
                <path
                  d={`M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${x1} ${y1} Z`}
                  fill={hueFor(i, slices.length)}
                  stroke="#08080a"
                  strokeWidth={1.5}
                />
                <text
                  x={lx}
                  y={ly}
                  fill="#08080a"
                  fontSize={size}
                  fontWeight={700}
                  textAnchor="start"
                  dominantBaseline="central"
                  // `mid + 90` turns the text's own left-to-right into the
                  // inward radial direction, so it starts at the rim and reads
                  // toward the middle.
                  transform={`rotate(${mid + 90} ${lx} ${ly})`}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>
        {/* Rim and hub, drawn outside the rotating group so they stay put. */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="#2a2a33"
          strokeWidth={4}
        />
        <circle
          cx={C}
          cy={C}
          r={26}
          fill="#0e0e11"
          stroke="#2a2a33"
          strokeWidth={2}
        />
      </svg>
    </div>
  );
}
