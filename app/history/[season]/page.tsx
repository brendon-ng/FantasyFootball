import Link from "next/link";
import { notFound } from "next/navigation";

import { Bracket } from "@/components/bracket";
import { WeeklyLowBadge } from "@/components/weekly-low";
import { Col, ListHeader, Panel, PanelHeader, fmt, placeColor } from "@/components/ui";
import {
  creditedNames,
  features,
  getAllMeetings,
  getDrafts,
  getMatchupHistory,
  getOwnerMap,
  getSeasons,
  getWeeklyLowKeys,
  getWeeklyLows,
  meetingId,
} from "@/lib/data";
import type { BracketMatch } from "@/lib/types";

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
  /**
   * A co-owned team is ONE team here — one row, both owners named. Personal
   * records credit each owner separately, but a season table is a table of
   * teams, so splitting them would invent standings positions that never existed.
   */
  const teamLabel = (row: { ownerSlugs: string[]; ownerSlug: string }) =>
    (row.ownerSlugs.length ? row.ownerSlugs : [row.ownerSlug]).map(name).join(" & ");

  const seedOf = (slug: string | null) =>
    slug ? (summary.standings.find((r) => r.ownerSlug === slug)?.seed ?? null) : null;
  // Only link to games that actually generated a page — an undecided bracket
  // slot or a bye has no matchup page, and a dead link is worse than no link.
  const existing = new Set(getAllMeetings().map((m) => m.id));
  const hrefFor = (m: BracketMatch) => {
    if (!m.team1 || !m.team2 || m.isBye) return null;
    const id = meetingId(season, m.week, m.team1, m.team2);
    return existing.has(id) ? `/matchups/${id}/` : null;
  };

  // Imported ESPN seasons kept no draft data, so the link would 404. The page
  // only exists for seasons that have picks.
  const hasDraft = getDrafts().some((p) => p.season === season);
  const lowKeys = getWeeklyLowKeys();
  // Counted per team for THIS season's standings. Credited to the primary owner,
  // matching how the standings row is keyed.
  const lowsByOwner = new Map<string, number>();
  for (const w of getWeeklyLows().filter((w) => w.season === season)) {
    lowsByOwner.set(w.ownerSlug, (lowsByOwner.get(w.ownerSlug) ?? 0) + 1);
  }

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
          {/* Kept on the title side. Beside the champion it read as an arrow
              pointing AT the champion. */}
          {hasDraft ? (
            <Link
              href={`/history/${season}/draft/`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ink-500 px-3 py-1.5 text-xs font-medium text-chalk-400 transition-colors hover:border-accent hover:text-accent"
            >
              View draft results
            </Link>
          ) : null}
        </div>
        <div className="flex items-end gap-4">
          <div className="text-right text-sm">
            <div className="eyebrow">Champion</div>
            <div className="text-lg font-bold text-gold">{creditedNames(summary.standings, summary.champion, "TBD")}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Regular Season" meta={`${summary.regularSeasonWeeks} weeks`} />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-600">
                {(
                  [
                    ["Seed", "Playoff seed, by wins then points for"],
                    ["Owner", ""],
                    ["W-L", "Wins-losses in the regular season; a tie shows as a third number"],
                    ["PF", "Points For — points scored in the regular season"],
                    ["PA", "Points Against — regular-season points their opponents scored"],
                    ...(features().weeklyLowPunishment
                      ? ([["🚽", "Weeks finishing lowest in the league — punishments owed"]] as const)
                      : []),
                  ] as const
                ).map(([h, hint], i) => (
                  <th
                    key={h}
                    title={hint || undefined}
                    className={`eyebrow px-3 py-2 ${i <= 1 ? "text-left" : "text-right"} ${
                      hint ? "cursor-help" : ""
                    }`}
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
                      {teamLabel(r)}
                    </Link>
                    {r.teamName ? (
                      <div className="truncate text-[11px] text-chalk-600">{r.teamName}</div>
                    ) : null}
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2 text-right text-chalk-300">
                    {fmt.record(r.wins, r.losses, r.ties)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-chalk-500">
                    {fmt.pts1(r.pointsFor)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-chalk-500">
                    {fmt.pts1(r.pointsAgainst)}
                  </td>
                  {features().weeklyLowPunishment ? (
                    <td className="tabular px-3 py-2 text-right">
                      {lowsByOwner.get(r.ownerSlug) ? (
                        <span className="text-loss">{lowsByOwner.get(r.ownerSlug)}</span>
                      ) : (
                        <span className="text-chalk-600">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <PanelHeader title="Final Standings" meta="after playoffs" />
          <ListHeader>
            <Col className="w-6 shrink-0" hint="Final placement after playoffs and the toilet bowl">
              #
            </Col>
            <Col className="flex-1">Owner</Col>
            <Col className="shrink-0" hint="Where they entered the postseason">
              Entered as
            </Col>
          </ListHeader>
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
                    {teamLabel(r)}
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
        <PanelHeader
          title="Playoffs"
          meta={`top ${summary.standings.filter((r) => r.madePlayoffs).length} seeds`}
        />
        <div className="p-4 sm:p-5">
          <Bracket
            matches={summary.winnersBracket}
            finalLabel="🏆 Championship"
            finalPlace={1}
            nameOf={name}
            seedOf={seedOf}
            hrefFor={hrefFor}
          />
        </div>
      </Panel>

      {summary.extraBrackets.map((b) => (
        <Panel key={b.key}>
          <PanelHeader title={b.title} legend={b.note} />
          <div className="p-4 sm:p-5">
            <Bracket
              matches={b.matches}
              finalLabel={b.finalLabel}
              finalPlace={b.finalPlace}
              nameOf={name}
              seedOf={seedOf}
              hrefFor={hrefFor}
            />
          </div>
        </Panel>
      ))}

      <Panel>
        <PanelHeader
          title={summary.ladderConsolation ? "Consolation Ladder" : "Consolation Bracket"}
          meta={summary.ladderConsolation ? "win to climb" : "lose to advance"}
        />
        <div className="p-4 sm:p-5">
          <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-chalk-500">
            {summary.ladderConsolation ? (
              <>
                A ladder, not a bracket: winning moves you <em>up</em> a rung and losing moves
                you down. The loser of the bottom rung in the final week finishes last.
              </>
            ) : (
              <>
                An anti-tournament for the teams that missed the playoffs: the <em>loser</em> of
                each matchup advances. The final is the <strong className="text-chalk-300">toilet
                bowl</strong> — losing it means last place. Winning here is how you escape.
              </>
            )}
          </p>
          <Bracket
            matches={summary.losersBracket}
            finalLabel="🚽 Toilet Bowl · Last Place"
            finalPlace={summary.teams}
            nameOf={name}
            seedOf={seedOf}
            hrefFor={hrefFor}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Every Matchup"
          meta={`${matchups.length} matchups`}
          legend="Open a matchup for lineups and per-player scores."
        />
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
                    <Link
                      key={m.matchupId}
                      href={`/matchups/${meetingId(m.season, m.week, m.home.ownerSlug, m.away.ownerSlug)}/`}
                      className="group/game bg-ink-850 px-4 py-2.5 transition-colors hover:bg-ink-700/50"
                    >
                      {[m.home, m.away].map((side) => (
                        <div
                          key={side.ownerSlug}
                          className={`flex items-center justify-between gap-2 text-sm ${
                            m.winner === side.ownerSlug
                              ? "font-semibold text-chalk-100"
                              : "text-chalk-500"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span data-owner={side.ownerSlug} className="truncate">
                              {name(side.ownerSlug)}
                            </span>
                            {lowKeys.has(`${m.season}:${m.week}:${side.ownerSlug}`) ? (
                              <WeeklyLowBadge size="glyph" />
                            ) : null}
                          </span>
                          <span className="tabular">{fmt.pts(side.points)}</span>
                        </div>
                      ))}
                      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-chalk-600">
                        <span>
                          {m.kind !== "regular" ? m.kind : ""}
                        </span>
                        <span
                          aria-hidden
                          className="opacity-0 transition-opacity group-hover/game:opacity-100"
                        >
                          lineups →
                        </span>
                      </div>
                    </Link>
                  ))}
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
