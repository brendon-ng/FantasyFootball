"use client";

import { useId, useState } from "react";

/**
 * Final placement by season, as a line chart.
 *
 * FORM: change-over-time for one entity → a line. Single series, so there is no
 * legend — the panel title names it — and no categorical palette to validate;
 * the only colour check that applies is contrast against the dark surface.
 *
 * THE Y AXIS IS INVERTED. Placement counts up as performance goes down, so 1st
 * sits at the top. Plotted naively, a championship would appear as a trough.
 *
 * THE FLOOR LINE IS NOT DECORATION. The league was 12 teams through 2023 and 10
 * from 2024, so "10th" means last place in one era and mid-table in another.
 * The dashed line traces last place each season; without it the chart silently
 * misrepresents how bad a finish was.
 */

export interface FinishPoint {
  season: number;
  place: number | null;
  teams: number;
}

// Wide and short: the chart sits in a half-width column beside the trophy case,
// and six points need horizontal room far more than vertical.
const W = 560;
const H = 168;
const PAD = { top: 14, right: 16, bottom: 24, left: 26 };

const MEDAL: Record<number, string> = {
  1: "var(--color-gold)",
  2: "var(--color-silver)",
  3: "var(--color-bronze)",
};

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function FinishChart({ points }: { points: FinishPoint[] }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const data = points.filter((p) => p.place != null) as Array<FinishPoint & { place: number }>;
  if (data.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-chalk-600">No finishes yet.</div>;
  }

  const maxPlace = Math.max(...points.map((p) => p.teams), ...data.map((p) => p.place));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // A single season would divide by zero; pin it to the centre instead.
  const x = (i: number) =>
    PAD.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (place: number) => PAD.top + ((place - 1) / (maxPlace - 1)) * innerH;

  const linePath = data.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.place)}`).join(" ");
  const areaPath = `${linePath} L${x(data.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`;
  const floorPath = data.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.teams)}`).join(" ");

  const gridPlaces = [1, ...(maxPlace >= 6 ? [Math.ceil(maxPlace / 2)] : []), maxPlace];
  const active = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Final placement by season: ${data
          .map((p) => `${p.season} ${ordinal(p.place)} of ${p.teams}`)
          .join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${clipId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid — reference, never competing with the data. */}
        {gridPlaces.map((p) => (
          <g key={p}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(p)}
              y2={y(p)}
              stroke="var(--color-ink-600)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(p) + 3.5}
              textAnchor="end"
              className="fill-chalk-600"
              style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
            >
              {p}
            </text>
          </g>
        ))}

        {/* Last place each season. Dashed and dim: context, not a data series. */}
        <path
          d={floorPath}
          fill="none"
          stroke="var(--color-ink-400)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        <path d={areaPath} fill={`url(#${clipId}-fill)`} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((p, i) => (
          <g key={p.season}>
            {/* 2px surface ring keeps a marker legible where it meets the line. */}
            <circle
              cx={x(i)}
              cy={y(p.place)}
              r={hover === i ? 5.5 : 4}
              fill={MEDAL[p.place] ?? "var(--color-accent)"}
              stroke="var(--color-ink-850)"
              strokeWidth="2"
            />
            <text
              x={x(i)}
              y={H - 7}
              textAnchor="middle"
              className={hover === i ? "fill-chalk-300" : "fill-chalk-600"}
              style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
            >
              {p.season}
            </text>
            {/* Hit target far larger than the mark, per interaction guidance. */}
            <rect
              x={x(i) - innerW / Math.max(2, data.length * 2)}
              y={PAD.top}
              width={innerW / Math.max(1, data.length)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              style={{ cursor: "pointer" }}
            />
          </g>
        ))}

        {active ? (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="var(--color-ink-500)"
            strokeWidth="1"
          />
        ) : null}
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-ink-500 bg-ink-900/95 px-2.5 py-1.5 text-center shadow-lg"
          style={{ left: `${(x(hover!) / W) * 100}%`, top: 0 }}
        >
          <div className="tabular text-[11px] font-semibold text-chalk-100">
            {active.season} · {ordinal(active.place)}
          </div>
          <div className="text-[10px] text-chalk-500">of {active.teams} teams</div>
        </div>
      ) : null}

      <p className="mt-0.5 px-1 text-[10px] leading-tight text-chalk-600">
        1st at top · dashed line is last place that season
      </p>
    </div>
  );
}
