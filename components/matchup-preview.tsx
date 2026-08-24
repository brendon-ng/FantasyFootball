"use client";

import Link from "next/link";

import { EmptyState, Panel, PanelHeader, fmt } from "@/components/ui";
import { useLiveSeason, useSeasonGames } from "@/lib/live";
import type { LeagueRef } from "@/lib/league-ref";
import type { LiveSeason, LiveTeam } from "@/lib/types";

/**
 * The live half of a matchup that has not been played.
 *
 * WHAT A PREVIEW CAN HONESTLY SAY is the whole design here. A finished matchup
 * page is a report — a winner, a margin, the lineups that produced it — and none
 * of that exists yet. What does exist is form: how both teams got here, what they
 * average, and what happened the last time they met. So this answers "who is
 * playing and how are they going", and says nothing that would have to be taken
 * back.
 *
 * NO PROJECTIONS AND NO ODDS. Both providers publish a projected score and it is
 * tempting to show it, but everything else on this site is a fact that happened;
 * a number that turns out wrong every other week would be the only thing here
 * that is allowed to be.
 *
 * It handles the LIVE case too, not just the future one. A week in progress is
 * the same page with points on it — the scoreline appears once anybody scores,
 * on the same rule the home strip uses.
 */

export interface MatchupPreviewProps {
  refBySeason: Record<string, LeagueRef>;
  initial: LiveSeason | null;
  userIdToSlug: Record<string, string>;
  season: number;
  week: number;
  /** Owner slugs, as the fixture lists them. */
  a: string;
  b: string;
  ownerNames: Record<string, string>;
  /** How long the season runs, so the form table covers all of it. */
  seasonWeeks: number;
}

/** One completed week for one team. */
interface Form {
  week: number;
  points: number;
  against: number;
  opponent: string | null;
  result: "W" | "L" | "T";
}

export function MatchupPreview({
  refBySeason,
  initial,
  userIdToSlug,
  season,
  week,
  a,
  b,
  ownerNames,
  seasonWeeks,
}: MatchupPreviewProps) {
  const live = useLiveSeason(refBySeason, initial, userIdToSlug);
  const games = useSeasonGames(refBySeason[String(season)] ?? null, seasonWeeks);

  const name = (slug: string) => ownerNames[slug] ?? slug;
  const teamOf = (slug: string): LiveTeam | undefined =>
    live?.teams.find((t) => t.ownerSlug === slug || t.ownerSlugs?.includes(slug));
  const label = (slug: string): string => {
    const t = teamOf(slug);
    return (t?.ownerSlugs?.length ? t.ownerSlugs : [slug]).map(name).join(" & ");
  };
  const slugOfRoster = (rosterId: number) =>
    live?.teams.find((t) => t.rosterId === rosterId)?.ownerSlug ?? null;

  /**
   * Every week this team has finished, newest last.
   *
   * A week with no points on either side has not been played — the same test the
   * strip uses — so an unplayed fixture does not become an 0-0 tie in the record.
   */
  const formOf = (slug: string): Form[] => {
    const rosterId = teamOf(slug)?.rosterId;
    if (rosterId == null) return [];
    const out: Form[] = [];
    for (const wk of Object.keys(games).map(Number).sort((x, y) => x - y)) {
      if (wk >= week) continue;
      for (const g of games[wk]) {
        const mine = g.sides.find((s) => s.rosterId === rosterId);
        const other = g.sides.find((s) => s.rosterId !== rosterId);
        if (!mine || !other) continue;
        if (mine.points === 0 && other.points === 0) continue;
        out.push({
          week: wk,
          points: mine.points,
          against: other.points,
          opponent: slugOfRoster(other.rosterId),
          result: mine.points > other.points ? "W" : mine.points < other.points ? "L" : "T",
        });
      }
    }
    return out;
  };

  const formA = formOf(a);
  const formB = formOf(b);
  const played = formA.length || formB.length;

  const avg = (f: Form[]) => (f.length ? f.reduce((s, x) => s + x.points, 0) / f.length : null);

  /** This week's own scoreline, once there is one. Absent means not started. */
  const thisWeek = live?.week === week ? live.matchups.find(
    (m) =>
      [m.a.ownerSlug, m.b.ownerSlug].includes(a) && [m.a.ownerSlug, m.b.ownerSlug].includes(b),
  ) : undefined;
  const liveScore =
    thisWeek && (thisWeek.a.points > 0 || thisWeek.b.points > 0) ? thisWeek : null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {[a, b].map((slug) => {
          const t = teamOf(slug);
          const f = slug === a ? formA : formB;
          const mine = liveScore
            ? liveScore.a.ownerSlug === slug
              ? liveScore.a.points
              : liveScore.b.points
            : null;
          return (
            <Panel key={slug}>
              <div className="p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/owners/${slug}/`}
                    data-owner={slug}
                    className="min-w-0 truncate text-lg font-bold transition-colors hover:text-accent"
                  >
                    {label(slug)}
                  </Link>
                  {mine != null ? (
                    <span className="tabular shrink-0 text-xl font-bold text-chalk-100">
                      {fmt.pts1(mine)}
                    </span>
                  ) : null}
                </div>
                {t?.teamName ? (
                  <div className="truncate text-[11px] text-chalk-600">{t.teamName}</div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-chalk-500">
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {t ? fmt.record(t.wins, t.losses, t.ties) : "—"}
                    </span>{" "}
                    record
                  </span>
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {avg(f) == null ? "—" : fmt.pts1(avg(f) as number)}
                    </span>{" "}
                    per game
                  </span>
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {t ? fmt.pts1(t.pointsFor) : "—"}
                    </span>{" "}
                    for
                  </span>
                </div>
                {/* LAST FIVE, NEWEST LAST, so the row reads left to right the way
                    the season ran. Letters rather than scores: this is shape at a
                    glance, and the week-by-week detail is in the table below. */}
                {f.length ? (
                  <div className="mt-3 flex items-center gap-1">
                    {f.slice(-5).map((x) => (
                      <span
                        key={x.week}
                        title={`Week ${x.week}: ${fmt.pts1(x.points)} vs ${fmt.pts1(x.against)}`}
                        className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                          x.result === "W"
                            ? "bg-accent/15 text-accent"
                            : x.result === "L"
                              ? "bg-loss/15 text-loss"
                              : "bg-ink-700 text-chalk-500"
                        }`}
                      >
                        {x.result}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel>
        <PanelHeader
          title="This season"
          meta={played ? `through week ${week - 1}` : undefined}
        />
        {played ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-sm:min-w-max">
              <thead>
                <tr className="border-b border-ink-600">
                  <th className="eyebrow px-3 py-2 text-left">Wk</th>
                  {[a, b].map((slug) => (
                    <th key={slug} className="eyebrow px-3 py-2 text-right">
                      {label(slug)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: week - 1 }, (_, i) => i + 1).map((wk) => {
                  const rowA = formA.find((x) => x.week === wk);
                  const rowB = formB.find((x) => x.week === wk);
                  if (!rowA && !rowB) return null;
                  return (
                    <tr key={wk} className="border-b border-ink-700 last:border-0">
                      <td className="tabular px-3 py-2 text-chalk-500">{wk}</td>
                      {[rowA, rowB].map((r, i) => (
                        <td key={i} className="px-3 py-2 text-right">
                          {r ? (
                            <span
                              className={
                                r.result === "W"
                                  ? "text-accent"
                                  : r.result === "L"
                                    ? "text-chalk-500"
                                    : "text-chalk-400"
                              }
                            >
                              <span className="tabular font-medium">{fmt.pts1(r.points)}</span>
                              <span className="tabular text-chalk-600">
                                {" "}
                                – {fmt.pts1(r.against)}
                              </span>
                              {r.opponent ? (
                                <span className="ml-1.5 text-[11px] text-chalk-600">
                                  {name(r.opponent).split(" ")[0]}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-chalk-600">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>Neither team has played yet — this is week {week}.</EmptyState>
        )}
      </Panel>
    </>
  );
}
