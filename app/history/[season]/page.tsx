import Link from "next/link";
import { notFound } from "next/navigation";

import { Bracket } from "@/components/bracket";
import { Panel, PanelHeader, fmt, placeColor } from "@/components/ui";
import { getMatchupHistory, getOwnerMap, getSeasons } from "@/lib/data";

// Static export: every season page is generated at build time.
export const dynamicParams = false;
export function generateStaticParams() {
  return getSeasons()
    .filter((s) => s.finalized)
    .map((s) => ({ season: String(s.season) }));
}

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season: seasonParam } = await params;
  const season = Number(seasonParam);
  const summary = getSeasons().find((s) => s.season === season);
  if (!summary) notFound();

  const owners = getOwnerMap();
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "TBD";
  const seedOf = (slug: string | null) =>
    slug ? (summary.standings.find((r) => r.ownerSlug === slug)?.seed ?? null) : null;
  const matchups = getMatchupHistory().filter((m) => m.season === season);
  const weeks = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/history/" className="text-xs text-chalk-600 hover:text-accent">
            ← History
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{season} Season</h1>
        </div>
        <div className="text-right text-sm">
          <div className="eyebrow">Champion</div>
          <div className="text-lg font-bold text-gold">{name(summary.champion)}</div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Regular Season" meta={`${summary.regularSeasonWeeks} weeks`} />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-600">
                {["Seed", "Owner", "W-L-T", "PF", "PA"].map((h, i) => (
                  <th
                    key={h}
                    className={`eyebrow px-3 py-2 ${i <= 1 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.standings.map((r) => (
                <tr
                  key={r.ownerSlug}
                  className={`border-b border-ink-700 last:border-0 ${
                    // Playoff cut line after the 6th seed.
                    r.seed === 6 ? "border-b-accent-dim" : ""
                  }`}
                >
                  <td className="tabular px-3 py-2 font-bold text-chalk-500">{r.seed}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/owners/${r.ownerSlug}/`}
                      className="font-medium transition-colors hover:text-accent"
                    >
                      {name(r.ownerSlug)}
                    </Link>
                    {r.teamName ? (
                      <div className="truncate text-[11px] text-chalk-600">{r.teamName}</div>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-chalk-300">
                    {fmt.record(r.wins, r.losses, r.ties)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-chalk-500">
                    {fmt.pts1(r.pointsFor)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-chalk-500">
                    {fmt.pts1(r.pointsAgainst)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <PanelHeader title="Final Standings" meta="after playoffs" />
          <ol>
            {summary.standings
              .slice()
              .sort((a, b) => (a.finalPlace ?? 99) - (b.finalPlace ?? 99))
              .map((r) => (
                <li
                  key={r.ownerSlug}
                  className="flex items-center gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0"
                >
                  <span
                    className={`tabular w-6 shrink-0 text-sm font-bold ${placeColor(r.finalPlace)}`}
                  >
                    {r.finalPlace ?? "—"}
                  </span>
                  <Link
                    href={`/owners/${r.ownerSlug}/`}
                    className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                  >
                    {name(r.ownerSlug)}
                  </Link>
                  <span className="text-[11px] text-chalk-600">
                    {r.seed <= 6 ? `${fmt.ordinal(r.seed)} seed` : "toilet bowl"}
                  </span>
                </li>
              ))}
          </ol>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Playoffs" meta={`top ${summary.standings.filter((r) => r.madePlayoffs).length} seeds`} />
        <div className="p-4 sm:p-5">
          <Bracket
            matches={summary.winnersBracket}
            finalLabel="🏆 Championship"
            nameOf={name}
            seedOf={seedOf}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Toilet Bowl" meta="lose to advance" />
        <div className="p-4 sm:p-5">
          <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-chalk-500">
            An anti-tournament: the <em>loser</em> of each game advances, and whoever loses
            the final is Last Place. Winning here is how you escape.
          </p>
          <Bracket
            matches={summary.losersBracket}
            finalLabel="💩 King (Last Place)"
            nameOf={name}
            seedOf={seedOf}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Every Matchup" meta={`${matchups.length} games`} />
        <div className="divide-y divide-ink-700">
          {weeks.map((week) => (
            <details key={week} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 transition-colors hover:bg-ink-700/40 sm:px-5">
                <span className="text-sm font-semibold">
                  Week {week}
                  {week >= 15 ? (
                    <span className="ml-2 text-[10px] font-medium text-chalk-600">PLAYOFFS</span>
                  ) : null}
                </span>
                <span className="text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                  ▸
                </span>
              </summary>
              <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
                {matchups
                  .filter((m) => m.week === week)
                  .map((m) => (
                    <div key={m.matchupId} className="bg-ink-850 px-4 py-2.5">
                      {[m.home, m.away].map((side) => (
                        <div
                          key={side.ownerSlug}
                          className={`flex items-center justify-between gap-2 text-sm ${
                            m.winner === side.ownerSlug
                              ? "font-semibold text-chalk-100"
                              : "text-chalk-500"
                          }`}
                        >
                          <span className="truncate">{name(side.ownerSlug)}</span>
                          <span className="tabular">{fmt.pts(side.points)}</span>
                        </div>
                      ))}
                      {m.kind !== "regular" ? (
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-chalk-600">
                          {m.kind}
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
