"use client";

import Link from "next/link";

import {
  Col,
  EmptyState,
  ListHeader,
  LiveBadge,
  Panel,
  PanelHeader,
  fmt,
  placeColor,
} from "@/components/ui";
import { meetingId } from "@/lib/meeting";
import { isCurrentSeason, resolvePhase } from "@/lib/phase";
import { useLiveDraft, useLiveSeason } from "@/lib/sleeper-browser";
import type { LiveSeason, OwnerRecord, SeasonSummary } from "@/lib/types";

/**
 * Everything on the home page that depends on the CURRENT season.
 *
 * Server-rendered from the build's snapshot and then refreshed in the browser:
 * `useLiveSeason` is seeded with `initial`, so this never flashes a loading state
 * and never blanks when Sleeper is down — it only replaces a good value with a
 * fresher one.
 *
 * Worth being live even though standings move weekly: during games a score that
 * is a quarter of an hour old is visibly wrong, and the 15-minute game-window
 * rebuilds cannot do better than that.
 *
 * The panels swap wholesale between offseason and in-season rather than trying to
 * be one flexible layout — "last season's final table" and "this week's live
 * scores" answer different questions and share nothing but a slot.
 */

export interface HomeOwner {
  slug: string;
  name: string;
}

export function SeasonPanels({
  initial,
  leagueIdBySeason,
  ownerNames,
  lastSeason,
  leaders,
  thresholds,
  format,
  preDraftNote,
  fallbackSeason,
  lastSeasonTiles,
  children,
}: {
  initial: LiveSeason | null;
  leagueIdBySeason: Record<string, string>;
  ownerNames: Record<string, string>;
  lastSeason: SeasonSummary | null;
  leaders: OwnerRecord[];
  thresholds: { high: number[]; low: number[] };
  /** "10 teams · PPR keeper", built from config on the server. */
  format: string;
  preDraftNote: string;
  /** Used before Sleeper answers at all. */
  fallbackSeason: number;
  /**
   * Last season's champion tiles. Dropped once the new season starts — the draft
   * has run, so who won last year is history rather than the state of play.
   */
  lastSeasonTiles?: React.ReactNode;
  /**
   * Rendered between the header and the panels.
   *
   * The draft panel and last season's tiles sit there and are SERVER content, so
   * they arrive as children rather than being re-implemented client-side — and
   * one `useLiveSeason` still serves the whole page.
   */
  children?: React.ReactNode;
}) {
  const live = useLiveSeason(leagueIdBySeason, initial);
  const draft = useLiveDraft(leagueIdBySeason[String(live?.season ?? fallbackSeason)] ?? null);
  const phase = resolvePhase({ live, draft: draft.data });

  // Keyed on the PHASE, not on seasonType. Sleeper still reports "pre" between
  // the draft and week 1, but by then last season is over — the draft is what
  // starts the new one, so that is when the page stops looking backwards.
  const inSeason = isCurrentSeason(phase);
  const currentSeason = live?.season ?? fallbackSeason;
  const name = (slug: string | null | undefined) => (slug && ownerNames[slug]) || "\u2014";

  /**
   * Where a live score would land in the record book if the week ended now.
   */
  const pace = (points: number): { rank: number; tone: "good" | "bad" } | null => {
    const hi = thresholds.high.findIndex((p) => points > p);
    if (hi >= 0) return { rank: hi + 1, tone: "good" };
    const lo = thresholds.low.findIndex((p) => points < p);
    if (lo >= 0) return { rank: lo + 1, tone: "bad" };
    return null;
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {currentSeason} Season
          </h1>
          <p className="mt-1 text-sm text-chalk-500">
            {inSeason
              ? `Week ${live?.displayWeek || live?.week} · ${format}`
              : live?.status === "pre_draft"
                ? preDraftNote
                : `Offseason · ${format}`}
          </p>
        </div>
        {inSeason ? (
          <LiveBadge label={`WEEK ${live?.displayWeek || live?.week}`} />
        ) : (
          <span className="rounded-full border border-ink-500 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-chalk-500">
            {live?.status === "pre_draft" ? "PRE-DRAFT" : "OFFSEASON"}
          </span>
        )}
      </div>

      {children}

      {inSeason ? null : lastSeasonTiles}

      <div className="grid gap-5 lg:grid-cols-5 lg:gap-6">
        <Panel className="lg:col-span-3">
          <PanelHeader
            title={
              inSeason ? `${currentSeason} Standings` : `${lastSeason?.season ?? ""} Final Standings`
            }
            meta={inSeason ? (phase === "drafted" ? "season not started" : "live") : "final"}
            href={lastSeason ? `/history/${lastSeason.season}/` : undefined}
            hrefLabel="Season detail"
          />
          {inSeason && live ? (
            <StandingsLive live={live} ownerNames={ownerNames} />
          ) : lastSeason ? (
            <>
              <ListHeader>
                <Col className="w-5 shrink-0" hint="Final placement after playoffs">
                  #
                </Col>
                <Col className="flex-1">Owner · Team name</Col>
                <Col className="w-16 shrink-0 text-right" hint="Regular-season wins-losses">
                  W-L
                </Col>
                <Col
                  className="hidden w-20 shrink-0 text-right sm:block"
                  hint="Points For — total points scored across the regular season"
                >
                  PF
                </Col>
              </ListHeader>
              <ol>
              {lastSeason.standings
                .slice()
                .sort((a, b) => (a.finalPlace ?? 99) - (b.finalPlace ?? 99))
                .map((row) => (
                  <li
                    key={row.ownerSlug}
                    className="flex items-center gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0 sm:px-5"
                  >
                    <span
                      className={`tabular w-5 shrink-0 text-sm font-bold ${placeColor(row.finalPlace)}`}
                    >
                      {row.finalPlace ?? "—"}
                    </span>
                    <Link
                      href={`/owners/${row.ownerSlug}/`}
                      className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                    >
                      {(row.ownerSlugs?.length ? row.ownerSlugs : [row.ownerSlug])
                        .map(name)
                        .join(" & ")}
                      {row.teamName ? (
                        <span className="ml-2 hidden text-[11px] text-chalk-600 sm:inline">
                          {row.teamName}
                        </span>
                      ) : null}
                    </Link>
                    <span className="tabular w-16 shrink-0 whitespace-nowrap text-right text-sm text-chalk-300">
                      {fmt.record(row.wins, row.losses, row.ties)}
                    </span>
                    <span className="tabular hidden w-20 shrink-0 text-right text-sm text-chalk-500 sm:block">
                      {fmt.pts1(row.pointsFor)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <EmptyState>No finalized season yet.</EmptyState>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader
            title={
              inSeason
                ? phase === "drafted" || phase === "weekPreview"
                  ? `Week ${live?.week ?? 1} Preview`
                  : "This Week"
                : "All-Time Leaders"
            }
            meta={inSeason ? undefined : "current owners"}
            href={inSeason ? undefined : "/history/"}
            hrefLabel="Full history"
          />
          {inSeason && live?.matchups.length ? (
            <ul>
              {live.matchups.map((m) => (
                <li key={m.matchupId} className="border-b border-ink-700 last:border-0">
                  <Link
                    href={`/matchups/${meetingId(live!.season, live!.week, m.a.ownerSlug, m.b.ownerSlug)}/`}
                    className="block px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5"
                  >
                    {[m.a, m.b].map((side) => {
                      const p = pace(side.points);
                      return (
                        <div
                          key={side.ownerSlug}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate text-sm font-medium">
                            {name(side.ownerSlug)}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {/* Chip sits LEFT of the score so the numbers stay
                                in column whether or not a game is on pace. */}
                            {p ? (
                              <span
                                title={
                                  p.tone === "good"
                                    ? `On pace for the ${p.rank === 1 ? "highest" : `#${p.rank}`} single-week score in league history`
                                    : `On pace for the ${p.rank === 1 ? "lowest" : `#${p.rank}`} single-week score in league history`
                                }
                                className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                                  p.tone === "bad"
                                    ? "border-loss/40 bg-loss/10 text-loss"
                                    : "border-gold/40 bg-gold/10 text-gold"
                                }`}
                              >
                                #{p.rank}
                              </span>
                            ) : null}
                            <span className="tabular text-sm font-bold">
                              {fmt.pts1(side.points)}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    <div className="mt-1.5 text-[11px] text-chalk-600">
                      Matchup detail <span aria-hidden>→</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ListHeader>
                <Col className="w-4 shrink-0">#</Col>
                <Col className="flex-1">Owner</Col>
                <Col className="shrink-0" hint="Championships won">
                  Titles
                </Col>
                <Col className="w-16 shrink-0 text-right" hint="All-time record across every game, regular season and postseason">
                  W-L
                </Col>
                <Col
                  className="w-12 shrink-0 text-right"
                  hint="Win percentage across every game, counting a tie as half a win"
                >
                  Win%
                </Col>
              </ListHeader>
              <ul>
              {leaders.map((r, i) => (
                <li
                  key={r.ownerSlug}
                  className="flex items-center gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0 sm:px-5"
                >
                  <span className="tabular w-4 text-[11px] text-chalk-600">{i + 1}</span>
                  <Link
                    href={`/owners/${r.ownerSlug}/`}
                    className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                  >
                    {name(r.ownerSlug)}
                  </Link>
                  {/* Fixed-width slot LEFT of the numbers, so a team with no
                      titles does not shift its record out of column. */}
                  <span
                    className="w-8 shrink-0 text-center text-xs text-gold"
                    title={`${r.championships} championship${r.championships === 1 ? "" : "s"}`}
                  >
                    {r.championships > 0 ? "★".repeat(r.championships) : ""}
                  </span>
                  <span className="tabular w-16 shrink-0 whitespace-nowrap text-right text-sm text-chalk-300">
                    {fmt.record(r.wins, r.losses, r.ties)}
                  </span>
                  <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-500">
                    {fmt.pct(r.winPct)}
                  </span>
                </li>
              ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

function StandingsLive({
  live,
  ownerNames,
}: {
  live: NonNullable<LiveSeason>;
  ownerNames: Record<string, string>;
}) {
  const rows = live.teams.slice().sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);

  return (
    <ol>
      {rows.map((t, i) => (
        <li
          key={t.rosterId}
          className={`flex items-center gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0 sm:px-5 ${
            // Playoff cut line after the 6th seed (bylaws 1.8.2.1).
            i === 5 ? "border-b-accent-dim" : ""
          }`}
        >
          <span className="tabular w-5 shrink-0 text-sm font-bold text-chalk-500">{i + 1}</span>
          <Link
            href={`/owners/${t.ownerSlug}/`}
            className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
          >
            {ownerNames[t.ownerSlug] ?? t.ownerSlug}
          </Link>
          <span className="tabular w-16 shrink-0 whitespace-nowrap text-right text-sm text-chalk-300">
            {fmt.record(t.wins, t.losses, t.ties)}
          </span>
          <span className="tabular hidden w-20 shrink-0 text-right text-sm text-chalk-500 sm:block">
            {fmt.pts1(t.pointsFor)}
          </span>
        </li>
      ))}
    </ol>
  );
}

