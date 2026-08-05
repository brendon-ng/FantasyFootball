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
import { matchupMarks, type RecordMark, type RecordThresholds } from "@/lib/record-marks";
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
  userIdToSlug,
  lastSeason,
  leaders,
  thresholds,
  format,
  preDraftNote,
  fallbackSeason,
  lastSeasonTiles,
  h2h,
  children,
}: {
  initial: LiveSeason | null;
  leagueIdBySeason: Record<string, string>;
  ownerNames: Record<string, string>;
  /** Sleeper user id -> slug. Needed to credit co-owners on a live roster. */
  userIdToSlug: Record<string, string>;
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
  /**
   * Rendered between the header and the panels.
   *
   * The draft panel and last season's tiles sit there and are SERVER content, so
   * they arrive as children rather than being re-implemented client-side — and
   * one `useLiveSeason` still serves the whole page.
   */
  children?: React.ReactNode;
}) {
  const live = useLiveSeason(leagueIdBySeason, initial, userIdToSlug);
  const draft = useLiveDraft(leagueIdBySeason[String(live?.season ?? fallbackSeason)] ?? null);
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
          <MatchupStrip live={live} ownerNames={ownerNames} thresholds={thresholds} h2h={h2h} />
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

export interface H2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

/**
 * The week's matchups, one card per game, filling the row.
 *
 * Each card is the two teams with their season record, and beneath them the
 * all-time head-to-head — the thing that makes a fixture interesting before
 * anyone has scored.
 *
 * ONE STRUCTURE FOR EVERY WEEK PHASE. Preview, live and complete differ only in
 * what the score slot holds, never in how a card is built, so a card does not
 * move or resize as Sunday progresses.
 *
 THE CARD WIDTH IS AN INLINE STYLE, and that is not laziness. Four attempts to
 * express it in CSS did not reach the element — a grid template with a dynamic
 * column count (browsers reject `var()` as a `repeat()` count and drop the whole
 * declaration), and then `sm:flex-1`, which is present in the served stylesheet
 * and still did not apply. `flex: 1 0 10rem` inline cannot lose a cascade fight,
 * cannot be purged and cannot be served stale, and it needs no breakpoint:
 *
 *   desktop — free space splits evenly across equal bases, so the cards fill the
 *             row and stay the same width, five for a ten-team league or six for
 *             a twelve
 *   phone   — `flex-shrink: 0` holds each at 10rem, the row overflows, and the
 *             container scrolls it
 *
 * Stacking is what this avoids: five cards down a phone screen would push the
 * standings out of sight entirely.
 *
 * Scores appear only once someone has scored. A row of 0.00s before kickoff reads
 * as "everyone scored nothing" rather than "not started".
 */
function MatchupStrip({
  live,
  ownerNames,
  thresholds,
  h2h,
}: {
  live: LiveSeason | null;
  ownerNames: Record<string, string>;
  thresholds: RecordThresholds;
  h2h: Record<string, Record<string, H2HRecord>>;
}) {
  if (!live?.matchups.length) return null;
  const started = live.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
  // MARKS ONLY ONCE THE WEEK IS SCORED. A record is a fact about a finished game;
  // a partial score cannot have set one, and half a lineup sitting on 40 points
  // is not the lowest week in league history, it is Sunday lunchtime.
  const scored = (live.lastScoredLeg ?? 0) >= live.week;
  const name = (slug: string) => ownerNames[slug] ?? slug;
  const first = (slug: string) => name(slug).split(" ")[0];
  const recordOf = (slug: string) => live.teams.find((t) => t.ownerSlug === slug);

  /**
   * Every owner of the team, first names joined — "Jaymie & Katie".
   *
   * A co-owned team is one team with two people on it, and naming only the
   * primary makes the card disagree with the standings, which have credited both
   * since the ESPN import. First names because five of these share a row.
   */
  const credited = (slug: string): string => {
    const slugs = recordOf(slug)?.ownerSlugs;
    return (slugs?.length ? slugs : [slug]).map(first).join(" & ");
  };

  /**
   * "All time: Jake leads 5-4".
   *
   * PREFIXED, because a bare "Jake leads 5-4" under two names and two records
   * reads as this season. It is the whole series, going back to 2019.
   */
  const series = (a: string, b: string): string => {
    const r = h2h[a]?.[b];
    const total = r ? r.wins + r.losses + r.ties : 0;
    if (!r || !total) return "All time: first meeting";
    const score = r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
    if (r.wins === r.losses) return `All time: even at ${score}`;
    const leader = r.wins > r.losses ? a : b;
    const flipped = r.ties ? `${r.losses}-${r.wins}-${r.ties}` : `${r.losses}-${r.wins}`;
    return `All time: ${first(leader)} leads ${r.wins > r.losses ? score : flipped}`;
  };

  return (
    <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0">
      {live.matchups.map((m) => {
        const marks = scored ? matchupMarks(m.a.points, m.b.points, thresholds) : [];
        return (
        <Link
          key={m.matchupId}
          href={`/matchups/${meetingId(live.season, live.week, m.a.ownerSlug, m.b.ownerSlug)}/`}
          className="min-w-0 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2.5 transition-colors hover:border-accent-dim"
          style={{ flex: "1 0 10rem" }}
        >
          {[m.a, m.b].map((side, i) => {
            const other = i === 0 ? m.b : m.a;
            // LEADING IS NOT WINNING. Bold marks who is ahead; the accent is
            // reserved for a result, so it waits until the week is scored — a
            // green number at 2pm on Sunday asserts an outcome that has not
            // happened, and half these leads will not survive the late games.
            const leading = started && side.points > other.points;
            const won = scored && side.points > other.points;
            const rec = recordOf(side.ownerSlug);
            return (
              <div key={side.ownerSlug} className="flex items-baseline gap-1.5">
                <span
                  data-owner={side.ownerSlug}
                  className={`min-w-0 truncate text-sm ${
                    leading ? "font-semibold text-chalk-100" : "text-chalk-400"
                  }`}
                >
                  {credited(side.ownerSlug)}
                </span>
                {rec ? (
                  <span className="tabular shrink-0 text-[10px] text-chalk-600">
                    {fmt.record(rec.wins, rec.losses, rec.ties)}
                  </span>
                ) : null}
                {started ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <span
                      className={`tabular text-sm ${
                        won
                          ? "font-semibold text-accent"
                          : leading
                            ? "font-semibold text-chalk-200"
                            : "text-chalk-500"
                      }`}
                    >
                      {fmt.pts1(side.points)}
                    </span>
                  </span>
                ) : null}
              </div>
            );
          })}
          <div className="mt-1 truncate text-[10px] text-chalk-600">
            {series(m.a.ownerSlug, m.b.ownerSlug)}
          </div>
          {/* Only a game that actually made a record book gets chips, which is
              what keeps them worth reading — most weeks no card has one. */}
          {marks.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {marks.map((mark) => (
                <RecordChip key={`${mark.short}-${mark.side ?? "game"}`} mark={mark} />
              ))}
            </div>
          ) : null}
        </Link>
        );
      })}
    </div>
  );
}

/**
 * A record this game entered. Tone carries the direction — green for a peak, red
 * for a floor — and the title spells the rank out, since "#3 low" is terse.
 */
function RecordChip({ mark }: { mark: RecordMark }) {
  return (
    <span
      title={mark.full}
      className={`rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wide ${
        mark.tone === "good"
          ? "border-accent-dim/60 bg-accent/10 text-accent"
          : "border-loss/50 bg-loss/10 text-loss"
      }`}
    >
      {mark.short}
    </span>
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

