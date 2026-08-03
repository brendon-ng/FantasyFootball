import Link from "next/link";

import { Panel, PanelHeader, fmt, placeColor } from "@/components/ui";
import { getOwnerMap, getOwnerRecords, getSeasons } from "@/lib/data";

export const metadata = { title: "History · Den Ops" };

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
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  const allSeasons = seasons.map((s) => s.season).sort((a, b) => a - b);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">League History</h1>
        <p className="mt-1 text-sm text-chalk-500">
          {seasons.length} completed season{seasons.length === 1 ? "" : "s"} · tracked by owner,
          so team-name changes never break the record. 2020–2023 are imported from ESPN and have
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
                    <span className="truncate">{name(slug)}</span>
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
          legend="A co-owned team's record counts for each of its owners, so these columns will not sum to league totals."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-ink-600 text-left">
                {(
                  [
                    ["Owner", ""],
                    ["W-L-T", "All-time regular-season wins-losses-ties"],
                    ["Win%", "Win percentage, counting a tie as half a win"],
                    ["PF", "Points For — total points scored, all seasons"],
                    ["PF/G", "Points For per game — comparable across seasons of different length"],
                    ["PA", "Points Against — total points their opponents scored"],
                    ["PA/G", "Points Against per game"],
                    ["🏆", "Championships won"],
                    ["2nd", "Runner-up finishes"],
                    ["3rd", "Third-place finishes"],
                    ["Last", "Last-place finishes (toilet bowl losers)"],
                    ["Playoffs", "Playoff appearances out of seasons played"],
                    ["Avg Finish", "Mean final placement, 1 is best"],
                  ] as const
                ).map(([h, hint], i) => (
                    <th
                      key={h}
                      title={hint || undefined}
                      className={`eyebrow px-3 py-2.5 font-semibold ${i === 0 ? "text-left" : "text-right"} ${hint ? "cursor-help" : ""}`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.ownerSlug} className="border-b border-ink-700 last:border-0">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/owners/${r.ownerSlug}/`}
                      className="font-medium transition-colors hover:text-accent"
                    >
                      {name(r.ownerSlug)}
                    </Link>
                    {owners.get(r.ownerSlug)?.active === false ? (
                      <span className="ml-1.5 text-[10px] text-chalk-600" title="Former owner">
                        ·former
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-300">
                    {fmt.record(r.wins, r.losses, r.ties)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold">
                    {fmt.pct(r.winPct)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {fmt.pts1(r.pointsFor)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-medium text-chalk-300">
                    {fmt.pts1(r.pointsForPerGame)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {fmt.pts1(r.pointsAgainst)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {fmt.pts1(r.pointsAgainstPerGame)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-gold">
                    {r.championships || "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {r.runnerUps || "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {r.thirdPlaces || "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-loss">
                    {r.lastPlaces || "—"}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-chalk-500">
                    {r.playoffAppearances}/{r.seasonsPlayed}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold">
                    {r.averageFinish?.toFixed(1) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
