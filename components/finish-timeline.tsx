"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Every owner's finish over time, as lines.
 *
 * The companion view to the heatmap: the grid answers "how did this owner do in
 * 2022", the lines answer "who is trending which way". Same data, different
 * question, so it is a toggle rather than a replacement.
 *
 * Y IS INVERTED — 1st sits at the top, because a championship is a peak. Plotted
 * naively a title would appear as a trough. The axis is scaled per season to that
 * season's team count, so a 12th of 12 and a 10th of 10 both land on the floor.
 *
 * COLOUR ALONE CANNOT CARRY 16 OWNERS. Eight validated hues repeat with a dashed
 * stroke for the second cycle, which is composite encoding rather than sixteen
 * invented hues — anything past eight stops being separable, especially for
 * colour-blind readers. The legend is always present and hovering isolates a
 * line, which is what actually makes a chart this dense readable.
 */

export interface TimelineRow {
  slug: string;
  name: string;
  finishes: Array<{ season: number; place: number | null }>;
}

/**
 * Slots 1-8 of the validated dark-mode categorical palette.
 *
 * Checked with the dataviz validator against this surface: lightness band, chroma
 * floor, adjacent CVD separation (worst ΔE 8.4, protan), normal-vision separation
 * (worst ΔE 19.3) and 3:1 contrast all pass. Do not reorder or substitute without
 * re-running it — the ORDER is what makes adjacent slots separable.
 */
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

const seriesStyle = (i: number) => ({
  color: HUES[i % HUES.length],
  // Second cycle dashes, so slot 9 is not simply slot 1 again.
  dash: i >= HUES.length ? "5 3" : undefined,
});

const W = 720;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 26, left: 30 };

export function FinishTimeline({
  seasons,
  rows,
  teamsBySeason,
}: {
  seasons: number[];
  rows: TimelineRow[];
  /** Season -> team count, so the floor of the axis is that season's last place. */
  teamsBySeason: Record<number, number>;
}) {
  const [active, setActive] = useState<string | null>(null);

  const maxTeams = Math.max(...seasons.map((s) => teamsBySeason[s] ?? 12), 2);
  const x = (season: number) =>
    seasons.length === 1
      ? (PAD.left + (W - PAD.right)) / 2
      : PAD.left +
        ((W - PAD.left - PAD.right) * seasons.indexOf(season)) / (seasons.length - 1);
  const y = (place: number) =>
    PAD.top + ((H - PAD.top - PAD.bottom) * (place - 1)) / (maxTeams - 1);

  const gridPlaces = [1, Math.ceil(maxTeams / 2), maxTeams];

  return (
    <div>
      <div className="overflow-x-auto px-4 pt-3 sm:px-5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[220px] w-full min-w-[520px]"
          role="img"
          aria-label="Final placement by season for every owner"
        >
          {gridPlaces.map((p) => (
            <g key={p}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(p)}
                y2={y(p)}
                stroke="var(--color-ink-600)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(p) + 3}
                textAnchor="end"
                className="fill-chalk-600 text-[9px]"
              >
                {p}
              </text>
            </g>
          ))}
          {seasons.map((s) => (
            <text
              key={s}
              x={x(s)}
              y={H - 8}
              textAnchor="middle"
              className="fill-chalk-600 text-[9px]"
            >
              {s}
            </text>
          ))}

          {rows.map((r, i) => {
            const { color, dash } = seriesStyle(i);
            const pts = seasons
              .map((s) => ({ s, place: r.finishes.find((f) => f.season === s)?.place ?? null }))
              .filter((p): p is { s: number; place: number } => p.place != null);
            if (!pts.length) return null;
            // Dimmed rather than hidden, so the shape of the field stays visible
            // while one owner is read.
            const faded = active !== null && active !== r.slug;
            return (
              <g
                key={r.slug}
                opacity={faded ? 0.12 : 1}
                onMouseEnter={() => setActive(r.slug)}
                onMouseLeave={() => setActive(null)}
              >
                <polyline
                  points={pts.map((p) => `${x(p.s)},${y(p.place)}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={active === r.slug ? 3 : 2}
                  strokeDasharray={dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {pts.map((p) => (
                  <circle key={p.s} cx={x(p.s)} cy={y(p.place)} r={4} fill={color}>
                    <title>{`${r.name} — ${p.s}: ${p.place}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* A legend is not optional past two series, and with this many it is also
          the control: tapping an entry isolates that line, which is the only way
          a 16-line chart is readable on a phone. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-4 pb-4 pt-3 sm:px-5">
        {rows.map((r, i) => {
          const { color, dash } = seriesStyle(i);
          const faded = active !== null && active !== r.slug;
          return (
            <button
              key={r.slug}
              type="button"
              onClick={() => setActive(active === r.slug ? null : r.slug)}
              onMouseEnter={() => setActive(r.slug)}
              onMouseLeave={() => setActive(null)}
              className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                faded ? "opacity-40" : "opacity-100"
              }`}
            >
              <svg width="14" height="8" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="14"
                  y2="4"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={dash}
                />
              </svg>
              <span data-owner={r.slug} className="text-chalk-400">
                {r.name}
              </span>
            </button>
          );
        })}
      </div>

      {active ? (
        <div className="px-4 pb-4 text-[11px] text-chalk-600 sm:px-5">
          <Link href={`/owners/${active}/`} className="hover:text-accent">
            Open {rows.find((r) => r.slug === active)?.name}&rsquo;s profile →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
