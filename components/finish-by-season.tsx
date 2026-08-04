"use client";

import Link from "next/link";
import { useState } from "react";

import { FinishTimeline, type TimelineRow } from "@/components/finish-timeline";
import { Panel, PanelHeader, fmt, placeColor } from "@/components/ui";

/**
 * Finish by season, as a heatmap or as lines.
 *
 * Two views of one dataset because they answer different questions: the grid is
 * for looking a season up ("who won 2022"), the lines are for trajectory ("who is
 * climbing"). Neither is a superset of the other, so it toggles rather than
 * replacing.
 *
 * The grid is the default — it is exact, every value is labelled, and it degrades
 * to a phone. The chart is denser and needs interaction to be readable.
 */

const VIEWS = [
  { key: "grid", label: "Grid" },
  { key: "lines", label: "Lines" },
] as const;

type View = (typeof VIEWS)[number]["key"];

export function FinishBySeason({
  seasons,
  rows,
  teamsBySeason,
}: {
  seasons: number[];
  rows: TimelineRow[];
  teamsBySeason: Record<number, number>;
}) {
  const [view, setView] = useState<View>("grid");

  return (
    <Panel>
      <PanelHeader
        title="Finish by Season"
        meta={view === "grid" ? "1st is brightest" : "1st at the top"}
        legend={
          view === "grid"
            ? "Each cell is that owner's final placement for the season; brighter means a better finish. Hover a cell for the exact result."
            : "Each line is one owner's placement over time. Hover or tap a line — or its legend entry — to pick it out of the field."
        }
      />

      <div className="flex gap-1 px-4 pt-3 sm:px-5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              view === v.key
                ? "bg-ink-600 text-chalk-100"
                : "text-chalk-500 hover:text-chalk-300"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "grid" ? (
        // Name column width comes from --finish-name-col (see globals.css): it
        // stretches on desktop so the cells right-justify, and is capped on a
        // phone, where stretching pushed a one-season league's only column off
        // screen.
        <div className="overflow-x-auto p-4 sm:p-5">
          <div
            className="finish-grid grid items-center gap-1"
            style={{ gridTemplateColumns: `var(--finish-name-col) repeat(${seasons.length}, 44px)` }}
          >
            <div />
            {seasons.map((s) => (
              <div key={s} className="eyebrow text-center text-[10px]">
                {s}
              </div>
            ))}
            {rows.map((r) => (
              <FinishRow key={r.slug} {...r} seasons={seasons} />
            ))}
          </div>
        </div>
      ) : (
        <FinishTimeline seasons={seasons} rows={rows} teamsBySeason={teamsBySeason} />
      )}
    </Panel>
  );
}

function FinishRow({
  name,
  slug,
  finishes,
  seasons,
}: TimelineRow & { seasons: number[] }) {
  const byYear = new Map(finishes.map((f) => [f.season, f.place]));
  return (
    <>
      <Link
        href={`/owners/${slug}/`}
        className="truncate pr-2 text-sm font-medium transition-colors hover:text-accent"
      >
        {name}
      </Link>
      {seasons.map((s) => {
        const place = byYear.get(s) ?? null;
        // Opacity encodes finish: 1st is fully opaque, 10th nearly transparent.
        const strength = place ? 1 - (place - 1) / 11 : 0;
        return (
          <div
            key={s}
            title={place ? `${s}: ${fmt.ordinal(place)}` : `${s}: did not play`}
            className="flex h-8 items-center justify-center rounded"
            style={{
              backgroundColor: place
                ? `color-mix(in srgb, var(--color-accent) ${Math.round(strength * 70)}%, var(--color-ink-700))`
                : "var(--color-ink-850)",
            }}
          >
            <span className={`tabular text-xs font-bold ${placeColor(place)}`}>
              {place ?? "·"}
            </span>
          </div>
        );
      })}
    </>
  );
}
