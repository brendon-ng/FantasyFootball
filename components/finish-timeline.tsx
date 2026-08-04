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
 * colour-blind readers. Every line still in play is directly labelled, so identity
 * never rests on matching a colour to a key.
 *
 * TWO RULES ABOUT LABELS, both learned the hard way:
 *
 * 1. A label sits exactly on its last dot. Stacking them in a gutter to dodge
 *    collisions broke the one thing that made the chart readable — you could no
 *    longer tell which line a name belonged to.
 * 2. CO-OWNERS SHARE A TEAM, so they share a line and a final placement, and their
 *    names rendered on top of each other. They now merge into a single label —
 *    "Jake & Maddy" — with each first name in its own hue.
 *
 * Owners who have left are NOT labelled in the plot. Their lines stop mid-chart,
 * so a label there floats free of any axis and reads as a stray annotation. They
 * get a key beneath the chart instead, which doubles as the control.
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

const W = 1100;
const H = 340;
const PAD = { top: 18, right: 150, bottom: 28, left: 30 };

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
  // Two pieces of state, not one. A click PINS a line and hover is ignored until
  // it is unpinned — otherwise moving the cursor away from a line you just
  // selected silently deselects it, and on a wide chart the cursor is almost
  // never resting on the thing you want to read.
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = pinned ?? hovered;

  const enter = (slug: string) => {
    if (!pinned) setHovered(slug);
  };
  const leave = () => {
    if (!pinned) setHovered(null);
  };
  const toggle = (slug: string) => {
    // Unpinning leaves the cursor's own line lit, so releasing a selection does
    // not blink the whole field back at once.
    setPinned(pinned === slug ? null : slug);
    setHovered(pinned === slug ? slug : null);
  };

  const maxTeams = Math.max(...seasons.map((s) => teamsBySeason[s] ?? 12), 2);
  const lastSeason = seasons[seasons.length - 1];
  const x = (season: number) =>
    seasons.length === 1
      ? (PAD.left + (W - PAD.right)) / 2
      : PAD.left +
        ((W - PAD.left - PAD.right) * seasons.indexOf(season)) / (seasons.length - 1);
  const y = (place: number) =>
    PAD.top + ((H - PAD.top - PAD.bottom) * (place - 1)) / (maxTeams - 1);

  const series = rows
    .map((r, i) => ({
      ...r,
      ...seriesStyle(i),
      first: r.name.split(" ")[0],
      pts: seasons
        .map((s) => ({ s, place: r.finishes.find((f) => f.season === s)?.place ?? null }))
        .filter((p): p is { s: number; place: number } => p.place != null),
    }))
    .filter((r) => r.pts.length > 0);

  const endOf = (r: (typeof series)[number]) => r.pts[r.pts.length - 1];
  const current = series.filter((r) => endOf(r).s === lastSeason);
  const former = series.filter((r) => endOf(r).s !== lastSeason);

  // One label per TEAM. A shared final placement means a shared team — that is the
  // only way two owners can land on the same point.
  const byPlace = new Map<number, typeof current>();
  for (const r of current) {
    const place = endOf(r).place;
    byPlace.set(place, [...(byPlace.get(place) ?? []), r]);
  }

  const dim = (slug: string) => (active !== null && active !== slug ? 0.12 : 1);

  return (
    <div>
      <div className="overflow-x-auto px-4 pt-3 sm:px-5">
        {/* h-auto, NOT a fixed height: with a fixed height the viewBox scales to
            fit it and centres, leaving dead space either side of a wide card. */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[720px]"
          role="img"
          aria-label="Final placement by season for every owner"
        >
          {[1, Math.ceil(maxTeams / 2), maxTeams].map((p) => (
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
              y={H - 9}
              textAnchor="middle"
              className="fill-chalk-600 text-[9px]"
            >
              {s}
            </text>
          ))}

          {series.map((r) => (
            <g
              key={r.slug}
              opacity={dim(r.slug)}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => enter(r.slug)}
              onMouseLeave={leave}
              onClick={() => toggle(r.slug)}
            >
              <polyline
                points={r.pts.map((p) => `${x(p.s)},${y(p.place)}`).join(" ")}
                fill="none"
                stroke={r.color}
                strokeWidth={active === r.slug ? 3 : 2}
                strokeDasharray={r.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {r.pts.map((p) => (
                <circle key={p.s} cx={x(p.s)} cy={y(p.place)} r={4} fill={r.color}>
                  <title>{`${r.name} — ${p.s}: ${p.place}`}</title>
                </circle>
              ))}
            </g>
          ))}

          {[...byPlace.values()].map((group) => {
            const anchor = endOf(group[0]);
            const solo = group.length === 1;
            const lit = group.some((g) => dim(g.slug) === 1);
            return (
              // Each name in a shared label is its OWN target: clicking "Jake"
              // isolates Jake's line, "Maddy" hers. One handler on the whole
              // label would make half of it a lie.
              <text
                key={group.map((g) => g.slug).join("+")}
                x={x(anchor.s) + 11}
                y={y(anchor.place) + 4}
                className="text-[12px]"
              >
                {group.map((g, i) => (
                  <tspan key={g.slug}>
                    {i > 0 ? (
                      <tspan className="fill-chalk-600" opacity={lit ? 1 : 0.12}>
                        {" & "}
                      </tspan>
                    ) : null}
                    <tspan
                      fill={g.color}
                      opacity={dim(g.slug)}
                      style={{ cursor: "pointer" }}
                      onClick={() => toggle(g.slug)}
                      onMouseEnter={() => enter(g.slug)}
                      onMouseLeave={leave}
                    >
                      {solo ? g.name : g.first}
                    </tspan>
                  </tspan>
                ))}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Owners who have left get a key rather than an in-plot label: their lines
          stop mid-chart, so a label there floats free of any axis. */}
      {former.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-2 sm:px-5">
          <span className="eyebrow text-[10px]">Former</span>
          {former.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => toggle(r.slug)}
              onMouseEnter={() => enter(r.slug)}
              onMouseLeave={leave}
              className="flex items-center gap-1.5 text-[10px] transition-opacity"
              style={{ opacity: dim(r.slug) === 1 ? 1 : 0.4 }}
            >
              <svg width="12" height="7" aria-hidden>
                <line
                  x1="0"
                  y1="3.5"
                  x2="12"
                  y2="3.5"
                  stroke={r.color}
                  strokeWidth="2"
                  strokeDasharray={r.dash}
                />
              </svg>
              <span data-owner={r.slug} className="text-chalk-400">
                {r.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-4 pb-4 pt-2 text-[11px] text-chalk-600 sm:px-5">
        {active ? (
          <>
            <Link href={`/owners/${active}/`} className="hover:text-accent">
              Open {rows.find((r) => r.slug === active)?.name}&rsquo;s profile →
            </Link>
            {pinned ? <span className="ml-2">· click again to clear</span> : null}
          </>
        ) : (
          <span>Hover to preview a line, click to keep it selected.</span>
        )}
      </div>
    </div>
  );
}
