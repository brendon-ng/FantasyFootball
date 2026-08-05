import Link from "next/link";

import { AllTimeTable } from "@/components/all-time-table";
import { FinishBySeason } from "@/components/finish-by-season";
import { H2HMatrix } from "@/components/h2h-matrix";
import { Panel, PanelHeader, Stat } from "@/components/ui";
import {
  creditedNames,
  features,
  getOwnerMap,
  getOwnerRecords,
  getSeasons,
  getTrades,
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
  const all = getTrades();
  // Counts describe what ACTUALLY happened, so a vetoed deal is excluded from
  // every total and named separately — folding it in would overstate the league.
  const trades = all.filter((t) => !t.vetoed);
  const vetoed = all.length - trades.length;
  // Counted by LEG, not by trade: one deal can move four players and six picks,
  // and "24 trades" alone says nothing about how much actually changed hands.
  const legs = trades.flatMap((t) => t.legs);
  const faab = legs.filter((l) => l.kind === "faab").reduce((n, l) => n + (l.amount ?? 0), 0);
  // Credited to every party, so a two-team trade counts for both. The totals are
  // therefore per-owner activity, not a partition of the trades.
  const byOwner = new Map<string, number>();
  for (const t of trades) {
    for (const o of t.ownerSlugs) byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
  }
  const busiest = [...byOwner.entries()].sort((a, b) => b[1] - a[1])[0];
  const perSeason = new Map<number, number>();
  for (const t of trades) perSeason.set(t.season, (perSeason.get(t.season) ?? 0) + 1);
  const multiTeam = trades.filter((t) => t.ownerSlugs.length > 2).length;
  // Null when the league has no such rule, so the column disappears entirely.
  const lowsByOwner = features().weeklyLowPunishment
    ? getWeeklyLows().reduce<Record<string, number>>((acc, w) => {
        acc[w.ownerSlug] = (acc[w.ownerSlug] ?? 0) + 1;
        return acc;
      }, {})
    : null;
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  const allSeasons = seasons.map((s) => s.season).sort((a, b) => a - b);
  // Alphabetical: a matrix is looked up by name, not read down by rank.
  const activeOwners = [...owners.values()]
    .filter((o) => o.active)
    .map((o) => ({ slug: o.slug, name: o.name, firstName: o.firstName }))
    .sort((x, y) => x.name.localeCompare(y.name));

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">League History</h1>
        <p className="mt-1 text-sm text-chalk-500">
          {seasons.length} completed season{seasons.length === 1 ? "" : "s"}
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
          meta="every game"
          legend="Click any column to sort. A co-owned team's record counts for each of its owners, so these columns will not sum to league totals."
        />
        <AllTimeTable
          records={records}
          owners={Object.fromEntries(owners)}
          weeklyLows={lowsByOwner}
        />
      </Panel>

      <FinishBySeason
        seasons={allSeasons}
        rows={records.map((r) => ({
          slug: r.ownerSlug,
          name: name(r.ownerSlug),
          finishes: r.finishes,
        }))}
        teamsBySeason={Object.fromEntries(seasons.map((x) => [x.season, x.teams]))}
      />

      {trades.length ? (
        <Panel>
          <PanelHeader
            title="Trades"
            meta={`${perSeason.size} season${perSeason.size === 1 ? "" : "s"} with a deal`}
            href="/trades/"
            hrefLabel="All trades"
          />
          {/* Counts, not a list: the full history is one click away, and a strip
              of totals says something the list cannot — how much this league
              actually trades. */}
          <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 sm:p-5">
            <Stat
              label="Trades"
              value={trades.length}
              sub={
                [
                  multiTeam ? `${multiTeam} with 3+ teams` : null,
                  vetoed ? `${vetoed} vetoed` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            <Stat
              label="Players moved"
              value={legs.filter((l) => l.kind === "player").length}
            />
            <Stat
              label="Picks moved"
              value={legs.filter((l) => l.kind === "pick").length}
              sub={faab ? `plus $${faab} FAAB` : undefined}
            />
            <Stat
              label="Most active"
              value={
                <span className="text-base sm:text-lg">
                  {busiest ? name(busiest[0]).split(" ")[0] : "—"}
                </span>
              }
              sub={busiest ? `${busiest[1]} deals` : undefined}
            />
          </div>
        </Panel>
      ) : null}
      <Panel>
        <PanelHeader
          title="Head to Head"
          meta="active owners"
          legend="Every pairing, read from the row's side. Click any cell for the full series."
        />
        <H2HMatrix owners={activeOwners} records={records} />
      </Panel>
    </div>
  );
}

