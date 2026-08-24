"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { MatchupCards, type H2HRecord } from "@/components/matchup-cards";
import { EmptyState, Panel, PanelHeader, fmt } from "@/components/ui";
import type { RecordThresholds } from "@/lib/record-marks";
import { useLiveDraft, useLiveSeason, useSeasonGames } from "@/lib/live";
import { meetingId } from "@/lib/meeting";
import type { LeagueRef } from "@/lib/league-ref";
import { PHASE_LABEL, resolvePhase } from "@/lib/phase";
import { LiveRosters } from "@/components/live-rosters";
import type { LiveSeason, LiveTeam, PlayerMeta } from "@/lib/types";

/**
 * The season detail page for the season being PLAYED.
 *
 * A SEPARATE COMPONENT, NOT A FLAG ON THE HISTORICAL PAGE. The two answer
 * different questions from different sources: the historical page reads derived
 * JSON that is complete and immutable, and every panel on it — final placement,
 * both brackets, every matchup with a link to its lineups — is a statement about
 * something that finished. None of that exists for a season in progress, because
 * derive only builds finalized seasons. Threading "unless it is live" through
 * that page would put a null check on every row of it.
 *
 * WHAT IT DELIBERATELY DOES NOT RENDER:
 *
 *   - BRACKETS. There is no postseason field until the regular season ends and
 *     seeding is decided, and an empty bracket shell reads as a bracket nobody
 *     has filled in rather than one that does not exist yet.
 *   - FINAL STANDINGS, which cannot be known. The Playoff Picture takes that
 *     slot: the same question — where is everyone going to finish — asked of a
 *     season that can still answer it differently tomorrow.
 *   - LINKS INTO LINEUPS. `/matchups/<id>/` is statically generated from derived
 *     data, so no page exists for any game this season until it is archived.
 *     Linking anyway is a guaranteed 404.
 */

export interface LiveSeasonDetailProps {
  season: number;
  refBySeason: Record<string, LeagueRef>;
  initial: LiveSeason | null;
  userIdToSlug: Record<string, string>;
  /** Sleeper player id -> NFL team; see `useLiveSeason`. */
  teamByPlayer?: Record<string, string>;
  ownerNames: Record<string, string>;
  /**
   * How many teams make the playoffs, and how long the regular season is.
   *
   * FROM THE LAST FINALIZED SEASON, because neither provider publishes them in a
   * shape this page can trust — and both are league settings that change about
   * never. A league with no finished season yet gets nulls and the cut line is
   * simply not drawn, rather than a guess at where it falls.
   */
  playoffTeams: number | null;
  regularSeasonWeeks: number | null;
  /**
   * How many weeks the season runs to, so the WHOLE fixture list can be shown
   * rather than only the weeks played so far. Both platforms publish the full
   * schedule the moment the league is created; there is no reason to withhold
   * next week's opponent.
   */
  seasonWeeks: number;
  thresholds: RecordThresholds;
  /** All-time head-to-head, owner -> opponent -> record. */
  h2h: Record<string, Record<string, H2HRecord>>;
  /** Newest season with derived data, so matchup pages exist at or below it. */
  archivedThrough: number;
  /** Fixture ids the build generated a preview page for. See `MatchupCards`. */
  upcomingIds: string[];
  /** The baked player index, for naming and linking live rosters. */
  players: Record<string, PlayerMeta>;
  /** Rendered between the standings grid and the matchup list. */
  children?: ReactNode;
  /** Rendered last, below the matchup list — where Trades sits on a finished season. */
  footer?: ReactNode;
}

/** A team plus the standing derived from it. */
interface Row {
  team: LiveTeam;
  rank: number;
  games: number;
}

/**
 * Seed order: wins, then points for.
 *
 * The same rule the derived standings use, recomputed here because a live season
 * has no `seed` — nothing has ranked these teams yet. A tie counts as half a win
 * so a 5-4-1 team sits above a 5-5-0 one.
 */
function standing(teams: LiveTeam[]): Row[] {
  return [...teams]
    .map((team) => ({
      team,
      games: team.wins + team.losses + team.ties,
      rank: 0,
    }))
    .sort(
      (a, b) =>
        b.team.wins + b.team.ties / 2 - (a.team.wins + a.team.ties / 2) ||
        b.team.pointsFor - a.team.pointsFor,
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export function LiveSeasonDetail({
  season,
  refBySeason,
  initial,
  userIdToSlug,
  teamByPlayer,
  ownerNames,
  playoffTeams,
  regularSeasonWeeks,
  seasonWeeks,
  thresholds,
  h2h,
  archivedThrough,
  upcomingIds,
  players,
  children,
  footer,
}: LiveSeasonDetailProps) {
  const live = useLiveSeason(refBySeason, initial, userIdToSlug, teamByPlayer);
  const draft = useLiveDraft(refBySeason[String(season)] ?? null);
  const phase = resolvePhase({ live, draft: draft.data });

  const rows = standing(live?.teams ?? []);
  const played = rows.some((r) => r.games > 0);

  const name = (slug: string) => ownerNames[slug] ?? slug;
  /** A co-owned team is ONE row here, both people named — as on the historical page. */
  const teamLabel = (t: LiveTeam) =>
    (t.ownerSlugs?.length ? t.ownerSlugs : [t.ownerSlug]).map(name).join(" & ");

  /**
   * THE WHOLE SEASON, not just the weeks played.
   *
   * Both platforms publish the full schedule from the moment the league exists,
   * so a fixture list is available all year — capping this at the current week
   * showed one week in August and called it "Every Matchup". Weeks with no
   * scores render as pairings.
   */
  const games = useSeasonGames(refBySeason[String(season)] ?? null, seasonWeeks);
  /** Only for marking and opening the week being played. */
  const currentWeek = live?.week ?? 0;
  const upcoming = new Set(upcomingIds);
  const slugOf = (rosterId: number) =>
    live?.teams.find((t) => t.rosterId === rosterId)?.ownerSlug ?? `roster-${rosterId}`;
  const weeks = Object.keys(games)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Standings"
            meta={played ? PHASE_LABEL[phase].toLowerCase() : "season not started"}
          />
          {/* Scrolls rather than clipping, and sizes to content — same rule as
              the historical table; `Panel` is overflow-hidden. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm max-sm:min-w-max">
              <thead>
                <tr className="border-b border-ink-600">
                  {(
                    [
                      ["#", "Current seed — wins, then points for"],
                      ["Owner", ""],
                      ["W-L", "Wins-losses so far; a tie shows as a third number"],
                      ["PF", "Points For — points scored so far"],
                      ["PA", "Points Against — what their opponents have scored"],
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
                {rows.map((r) => (
                  <tr
                    key={r.team.ownerSlug}
                    className={`border-b border-ink-700 last:border-0 ${
                      // The playoff cut line, drawn only where the league has a
                      // finished season to take the spot count from.
                      played && r.rank === playoffTeams ? "border-b-accent-dim" : ""
                    }`}
                  >
                    {/* NO SEED BEFORE A GAME IS PLAYED. Every team is 0-0 with
                        no points, so 1..10 is input order wearing the costume of
                        a ranking — the same reason scores are hidden until
                        kickoff. */}
                    <td className="tabular px-3 py-2 font-bold text-chalk-500">
                      {played ? r.rank : <span className="text-chalk-600">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-sm:max-w-[9.5rem]">
                        <Link
                          href={`/owners/${r.team.ownerSlug}/`}
                          className="font-medium transition-colors hover:text-accent"
                        >
                          {teamLabel(r.team)}
                        </Link>
                        {r.team.teamName ? (
                          <div className="truncate text-[11px] text-chalk-600">
                            {r.team.teamName}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-2 text-right text-chalk-300">
                      {fmt.record(r.team.wins, r.team.losses, r.team.ties)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-chalk-500">
                      {fmt.pts1(r.team.pointsFor)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-chalk-500">
                      {fmt.pts1(r.team.pointsAgainst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length ? null : <EmptyState>Standings appear once the league is live.</EmptyState>}
        </Panel>

        {/* THE SLOT "FINAL STANDINGS" OCCUPIES ON A FINISHED SEASON. That panel
            states where everyone ended up; the equivalent for a season being
            played is what is happening in it right now. Same cards as the home
            page, from one renderer — see `MatchupCards`. */}
        <Panel>
          <PanelHeader
            title={currentWeek ? `Week ${currentWeek}` : "This Week"}
            meta={live?.matchups.length ? PHASE_LABEL[phase].toLowerCase() : undefined}
          />
          {live?.matchups.length ? (
            <MatchupCards
              live={live}
              ownerNames={ownerNames}
              thresholds={thresholds}
              h2h={h2h}
              archivedThrough={archivedThrough}
              upcomingIds={upcomingIds}
              layout="list"
            />
          ) : (
            <EmptyState>This week&rsquo;s fixtures appear once the draft has run.</EmptyState>
          )}
        </Panel>
      </div>

      {children}

      <Panel>
        <PanelHeader
          title="Every Matchup"
          meta={weeks.length ? `${weeks.length} week${weeks.length === 1 ? "" : "s"}` : undefined}
          /* Always, not conditionally: no game this season has a matchup page,
             so a reader who expects to click through to lineups needs telling
             once rather than being left with rows that do nothing. */
          legend="Per-player lineups are published once the season is archived."
        />
        {weeks.length ? (
          <div className="divide-y divide-ink-700">
            {weeks.map((week) => {
              const wk = games[week];
              // The week in progress opens by default — it is what the page is
              // being looked at for. Finished weeks stay collapsed, as on the
              // historical page.
              const current = week === currentWeek;
              const scored = wk.some((g) => g.sides.some((s) => s.points > 0));
              return (
                <details key={week} className="group" open={current}>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 transition-colors hover:bg-ink-700/40 sm:px-5">
                    <span className="text-sm font-semibold">
                      Week {week}
                      {regularSeasonWeeks && week > regularSeasonWeeks ? (
                        <span className="ml-2 text-[10px] font-medium text-chalk-600">
                          PLAYOFFS
                        </span>
                      ) : null}
                      {current ? (
                        <span className="ml-2 text-[10px] font-medium text-accent">THIS WEEK</span>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
                    {wk.map((g) => {
                      const [a, b] = g.sides;
                      if (!a || !b) return null;
                      // Same rule as the cards: link only where the build made a
                      // page. A finished season is not rendered by this component,
                      // so the preview pages are the only ones in play.
                      const id = meetingId(season, week, slugOf(a.rosterId), slugOf(b.rosterId));
                      const linked = upcoming.has(id);
                      const cls = `block bg-ink-850 px-4 py-2.5${
                        linked ? " transition-colors hover:bg-ink-700/50" : ""
                      }`;
                      const rows = (
                        <>
                          {[a, b].map((side) => {
                            const other = side === a ? b : a;
                            return (
                              <div
                                key={side.rosterId}
                                className={`flex items-center justify-between gap-2 text-sm ${
                                  scored && side.points > other.points
                                    ? "font-semibold text-chalk-100"
                                    : "text-chalk-500"
                                }`}
                              >
                                <span
                                  data-owner={slugOf(side.rosterId)}
                                  className="min-w-0 truncate"
                                >
                                  {name(slugOf(side.rosterId))}
                                </span>
                                {/* NO 0.00 BEFORE KICKOFF. A row of zeroes reads
                                    as "everyone scored nothing" rather than "not
                                    started" — the same rule the home strip uses. */}
                                {scored ? (
                                  <span className="tabular">{fmt.pts(side.points)}</span>
                                ) : null}
                              </div>
                            );
                          })}
                        </>
                      );
                      return linked ? (
                        <Link key={g.matchupId} href={`/matchups/${id}/`} className={cls}>
                          {rows}
                        </Link>
                      ) : (
                        <div key={g.matchupId} className={cls}>
                          {rows}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <EmptyState>The schedule appears once the draft has run.</EmptyState>
        )}
      </Panel>

      {/* TRADES ABOVE ROSTERS. A trade is news — it happened, it is dated, and it
          explains why a roster looks the way it does. The rosters are the current
          state those moves produced, and they are much the longer panel, so
          burying the short, eventful one underneath them reads backwards. */}
      {footer}

      <LiveRosters
        leagueRef={refBySeason[String(season)] ?? null}
        live={live}
        ownerNames={ownerNames}
        players={players}
      />
    </>
  );
}
