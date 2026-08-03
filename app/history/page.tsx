import Link from "next/link";

import { AllTimeTable } from "@/components/all-time-table";
import { Panel, PanelHeader, fmt, placeColor } from "@/components/ui";
import {
  creditedNames,
  features,
  getOwnerMap,
  getOwnerRecords,
  getSeasons,
  getWeeklyLows,
  pageTitle,
} from "@/lib/data";

export const generateMetadata = () => ({ title: pageTitle("History") });

/**
 * League history: the trophy case, the all-time table, and a finish-over-time
 * grid.
 *
 * The grid is a small-multiples heatmap rather than a line chart — with ten
 * owners, ten overlapping lines are unreadable, while a coloured cell per season
 * stays legible on a phone and scales as seasons accumulate.
 */
export default function HistoryPage() {
  const seasons = getSeasons().filter((s) => s.finalized).sort((a, b) => b.season - a.season);
  const records = getOwnerRecords();
  const owners = getOwnerMap();
  // Null when the league has no such rule, so the column disappears entirely.
  const lowsByOwner = features().weeklyLowPunishment
    ? getWeeklyLows().reduce<Record<string, number>>((acc, w) => {
        acc[w.ownerSlug] = (acc[w.ownerSlug] ?? 0) + 1;
        return acc;
      }, {})
    : null;
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  const allSeasons = seasons.map((s) => s.season).sort((a, b) => a - b);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">League History</h1>
        <p className="mt-1 text-sm text-chalk-500">
          {seasons.length} completed season{seasons.length === 1 ? "" : "s"} · tracked by owner,
          so team-name changes never break the record. The ESPN years are imported from archived pages and have
          standings and playoff results only.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Trophy Case" />
        <div className="grid gap-px bg-ink-600 sm:grid-cols-2 lg:grid-cols-3">
          {seasons.map((s) => (
            <Link
              key={s.season}
              href={`/history/${s.season}/`}
              className="group bg-ink-800 p-4 transition-colors hover:bg-ink-700/60 sm:p-5"
            >
              <div className="flex items-baseline justify-between">
                <span className="tabular text-lg font-bold tracking-tight">{s.season}</span>
                <span className="text-[11px] text-chalk-600 transition-colors group-hover:text-accent">
                  Detail →
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {(
                  [
                    ["🏆", s.champion, "text-gold"],
                    ["2nd", s.runnerUp, "text-silver"],
                    ["3rd", s.thirdPlace, "text-bronze"],
                    ["Last", s.lastPlace, "text-loss"],
                  ] as const
                ).map(([label, slug, tone]) => (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <span className={`w-8 shrink-0 text-[10px] font-semibold ${tone}`}>
                      {label}
                    </span>
                    <span className="truncate">{creditedNames(s.standings, slug)}</span>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="All-Time Table"
          meta="regular season"
          legend="Click any column to sort. A co-owned team's record counts for each of its owners, so these columns will not sum to league totals."
        />
        <AllTimeTable
          records={records}
          owners={Object.fromEntries(owners)}
          weeklyLows={lowsByOwner}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Finish by Season"
          meta="1st is brightest"
          legend="Each cell is that owner's final placement for the season; brighter means a better finish. Hover a cell for the exact result."
        />
        <div className="overflow-x-auto p-4 sm:p-5">
          <div className="min-w-[420px]">
            <div
              className="grid items-center gap-1"
              style={{ gridTemplateColumns: `minmax(120px,1fr) repeat(${allSeasons.length}, 44px)` }}
            >
              <div />
              {allSeasons.map((s) => (
                <div key={s} className="eyebrow text-center text-[10px]">
                  {s}
                </div>
              ))}
              {records.map((r) => (
                <FinishRow key={r.ownerSlug} name={name(r.ownerSlug)} slug={r.ownerSlug} finishes={r.finishes} seasons={allSeasons} />
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function FinishRow({
  name,
  slug,
  finishes,
  seasons,
}: {
  name: string;
  slug: string;
  finishes: Array<{ season: number; place: number | null }>;
  seasons: number[];
}) {
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
