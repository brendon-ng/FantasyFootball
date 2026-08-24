"use client";

import Link from "next/link";
import { type LeagueRef } from "@/lib/league-ref";

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
import { MatchupCards, type H2HRecord } from "@/components/matchup-cards";
import { isCurrentSeason, resolvePhase } from "@/lib/phase";
import type { RecordThresholds } from "@/lib/record-marks";
import { useLiveDraft, useLiveSeason } from "@/lib/live";
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

export type { H2HRecord };

export interface HomeOwner {
  slug: string;
  name: string;
}

export function SeasonPanels({
  initial,
  refBySeason,
  ownerNames,
  userIdToSlug,
  teamByPlayer,
  lastSeason,
  leaders,
  thresholds,
  format,
  preDraftNote,
  fallbackSeason,
  lastSeasonTiles,
  h2h,
  upcomingIds,
  children,
}: {
  initial: LiveSeason | null;
  refBySeason: Record<string, LeagueRef>;
  ownerNames: Record<string, string>;
  /** Sleeper user id -> slug. Needed to credit co-owners on a live roster. */
  userIdToSlug: Record<string, string>;
  /** Sleeper player id -> NFL team; see `useLiveSeason`. */
  teamByPlayer?: Record<string, string>;
  lastSeason: SeasonSummary | null;
  leaders: OwnerRecord[];
  thresholds: RecordThresholds;
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
  /** All-time head-to-head, owner -> opponent -> record. */
  h2h: Record<string, Record<string, H2HRecord>>;
  /** Fixture ids the build generated a preview page for. See `MatchupCards`. */
  upcomingIds?: string[];
  /**
   * Rendered between the header and the panels.
   *
   * The draft panel and last season's tiles sit there and are SERVER content, so
   * they arrive as children rather than being re-implemented client-side — and
   * one `useLiveSeason` still serves the whole page.
   */
  children?: React.ReactNode;
}) {
  const live = useLiveSeason(refBySeason, initial, userIdToSlug, teamByPlayer);
  const draft = useLiveDraft(refBySeason[String(live?.season ?? fallbackSeason)] ?? null);
  const phase = resolvePhase({ live, draft: draft.data });

  // Keyed on the PHASE, not on seasonType. Sleeper still reports "pre" between
  // the draft and week 1, but by then last season is over — the draft is what
  // starts the new one, so that is when the page stops looking backwards.
  const inSeason = isCurrentSeason(phase);
  const currentSeason = live?.season ?? fallbackSeason;
  const name = (slug: string | null | undefined) => (slug && ownerNames[slug]) || "\u2014";

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

      {/*
        BOTH SLOTS ARE WRAPPED, and the wrapper is load-bearing rather than tidy.
        `children` and `lastSeasonTiles` arrive as props, so React never saw them
        created by JSX in this file and has not stamped them as validated. Dropped
        straight into this fragment they become entries in the array this component
        returns, and the reconciler reports them as list children with no key —
        which is where "check the top-level render call using <SeasonPanels>" came
        from. A fragment makes the array entry an element created here, and the
        prop becomes its only child rather than a member of a list.
      */}
      <>{children}</>

      {/* Same slot last season's champion tiles occupy in the offseason: the
          top strip is for whatever the league is currently about. */}
      <>
        {inSeason ? (
          <MatchupCards
              live={live}
              ownerNames={ownerNames}
              thresholds={thresholds}
              h2h={h2h}
              archivedThrough={lastSeason?.season ?? 0}
              upcomingIds={upcomingIds}
            />
        ) : (
          lastSeasonTiles
        )}
      </>

      <div className="grid gap-5 lg:grid-cols-5 lg:gap-6">
        <Panel className="lg:col-span-3">
          <PanelHeader
            title={
              inSeason ? `${currentSeason} Standings` : `${lastSeason?.season ?? ""} Final Standings`
            }
            meta={inSeason ? (phase === "drafted" ? "season not started" : "live") : "final"}
            /* THE SEASON THIS PANEL IS ABOUT, which is not always the last
               finalized one. Headed "2026 Standings" while linking to
               /history/2025/ sent a reader from a live table to last year's
               archive. The in-progress season has its own page. */
            href={
              inSeason
                ? `/history/${currentSeason}/`
                : lastSeason
                  ? `/history/${lastSeason.season}/`
                  : undefined
            }
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
            title="All-Time Leaders"
            meta="current owners"
            href="/history/"
            hrefLabel="Full history"
          />
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
  // Structurally the same table as the final standings below it — same columns,
  // same widths, same playoff cut line. Only the contents differ, and two tables
  // that mean the same thing should not look different.
  const rows = live.teams.slice().sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);

  return (
    <>
      <ListHeader>
        <Col className="w-5 shrink-0" hint="Standing, by wins then points for">
          #
        </Col>
        <Col className="flex-1">Owner · Team name</Col>
        <Col className="w-16 shrink-0 text-right" hint="Regular-season wins-losses">
          W-L
        </Col>
        <Col
          className="hidden w-20 shrink-0 text-right sm:block"
          hint="Points For — total points scored so far this season"
        >
          PF
        </Col>
      </ListHeader>
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
              {(t.ownerSlugs?.length ? t.ownerSlugs : [t.ownerSlug])
                .map((s) => ownerNames[s] ?? s)
                .join(" & ")}
              {t.teamName ? (
                <span className="ml-2 hidden text-[11px] text-chalk-600 sm:inline">
                  {t.teamName}
                </span>
              ) : null}
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
    </>
  );
}

