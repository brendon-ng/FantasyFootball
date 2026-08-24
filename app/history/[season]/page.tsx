import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { LiveSeasonDetail } from "@/components/live-season-detail";

import { Bracket } from "@/components/bracket";
import { SeasonPunishmentPanel } from "@/components/season-punishment";
import { SeasonPunishments } from "@/components/season-punishments";
import { TradeList } from "@/components/trade-list";
import { WeeklyLowBadge } from "@/components/weekly-low";
import {
  Col,
  ListHeader,
  Panel,
  PanelHeader,
  fmt,
  placeColor,
  verboseKind,
} from "@/components/ui";
import {
  creditedNames,
  features,
  getAllMeetings,
  getDrafts,
  getMatchupHistory,
  getOwnerMap,
  getOwnerRecords,
  getRecordThresholds,
  getPickHandoffs,
  getPickOutcomes,
  getTradeReturns,
  getPlayers,
  getPunishmentLows,
  getConfig,
  getPunishmentTeams,
  getSeasonPunishment,
  getLeagueRefs,
  getLiveSchedule,
  getLiveSeason,
  getSeasons,
  getTrades,
  getUserIdToSlug,
  getWeeklyLowKeys,
  getWeeklyLows,
  matchupChip,
  meetingId,
  punishmentsSource,
} from "@/lib/data";
import type { BracketMatch, Matchup } from "@/lib/types";

/**
 * The season being played, or null outside one.
 *
 * A LEAGUE REF THE DERIVED DATA HAS NOT FINALIZED. Refs are keyed by season and
 * come from config plus discovery, so this is known at BUILD time with no
 * network — which it has to be, since `generateStaticParams` decides which HTML
 * files exist and a static export cannot mint a page later.
 */
function inProgressSeason(): number | null {
  const finalized = new Set(getSeasons().filter((s) => s.finalized).map((s) => s.season));
  const live = Object.keys(getLeagueRefs())
    .map(Number)
    .filter((s) => Number.isFinite(s) && !finalized.has(s));
  return live.length ? Math.max(...live) : null;
}

// Static export: every season page is generated at build time.
export const dynamicParams = false;
export function generateStaticParams() {
  const seasons = getSeasons()
    .filter((s) => s.finalized)
    .map((s) => String(s.season));
  const live = inProgressSeason();
  // The season in progress gets a page too, so the home page's "Season detail"
  // link has somewhere current to point. Without it that link went to LAST
  // season while the panel above it was headed with THIS one.
  if (live != null) seasons.push(String(live));
  return seasons.map((season) => ({ season }));
}

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season: seasonParam } = await params;
  const season = Number(seasonParam);
  const summary = getSeasons().find((s) => s.season === season && s.finalized);
  // The season being played has no derived summary — nothing about it is
  // archived yet — so it gets its own page built from the live layer.
  if (!summary) {
    if (season === inProgressSeason()) return <InProgressSeasonPage season={season} />;
    notFound();
  }

  const owners = getOwnerMap();
  // Newest first within the season, matching how an owner page lists them.
  const trades = getTrades().filter((t) => t.season === season).reverse();

  const players = getPlayers();
  const ownerNames = Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]));
  const seasonPunishment = getSeasonPunishment(season);
  const outcomes = getPickOutcomes();
  const returns = getTradeReturns();
  const handoffs = getPickHandoffs();
  // Every trade, so the modal can open one this page does not list.
  const allTrades = Object.fromEntries(getTrades().map((t) => [t.id, t]));
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
  const meetings = new Map(getAllMeetings().map((m) => [m.id, m]));
  const hrefFor = (m: BracketMatch) => {
    if (!m.team1 || !m.team2 || m.isBye) return null;
    const id = meetingId(season, m.week, m.team1, m.team2);
    return meetings.has(id) ? `/matchups/${id}/` : null;
  };

  /**
   * What a postseason game actually was, not just which bracket it sat in.
   *
   * `Matchup.kind` only distinguishes playoff from consolation, so the finals of
   * both read as their bracket name. `Meeting.label` carries the placement the
   * game decided — Championship, 3rd place, Toilet bowl — and falls back to the
   * bracket when a game decided no particular place.
   *
   * Spelled out at every width here, unlike the record book: this row has the
   * space, and "3rd place" sitting under two team names would otherwise read as a
   * season finish rather than the game that settled it.
   */
  const gameLabel = (m: Matchup): string => {
    const id = meetingId(m.season, m.week, m.home.ownerSlug, m.away.ownerSlug);
    return verboseKind(matchupChip(meetings.get(id)?.label ?? null, m.kind));
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
          <BackLink fallback={{ href: "/history/", label: "History" }} />
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
          {/* Scrolls rather than clipping: PF/PA and the weekly-low column do not
              fit a phone, and Panel is overflow-hidden.
              `min-w-max` sizes each column to its content instead of a fixed
              floor. A fixed floor left surplus width for auto-layout to dump
              somewhere arbitrary — flush against the card edge with five columns,
              a wide gap before W-L with six. Content sizing puts every column
              where it belongs whatever the league's shape.
              max-sm ONLY: at desktop the table is plain w-full and squishes to fit
              its card, which is how it looked before any of this. */}
          <div className="overflow-x-auto">
          <table className="w-full text-sm max-sm:min-w-max">
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
                    {/* Capped on an inner block, not the <td>: under table
                        auto-layout a cell's max-width is only a hint, and the cell
                        would still stretch to fit an unbreakable team name like
                        "twitch.tv/jamarrchase10". Capping here bounds the column so
                        W-L is on screen without scrolling, and gives `truncate`
                        below something to truncate against. */}
                    <div className="max-sm:max-w-[9.5rem]">
                      <Link
                        href={`/owners/${r.ownerSlug}/`}
                        className="font-medium transition-colors hover:text-accent"
                      >
                        {teamLabel(r)}
                      </Link>
                      {r.teamName ? (
                        <div className="truncate text-[11px] text-chalk-600">{r.teamName}</div>
                      ) : null}
                    </div>
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
          </div>
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

      {/* THE YEARLY PUNISHMENT COMES FIRST, above the weekly ledger. It is one
          record against fourteen rows, and it is the consequence of the final
          standings a reader has just looked at. Renders nothing for a season
          with no entry in season-punishments.json, which is most of them. */}
      {seasonPunishment ? (
        <SeasonPunishmentPanel
          league={getConfig().slug}
          punishment={seasonPunishment}
          teams={getPunishmentTeams()}
          names={ownerNames}
          cloud={getConfig().cloudinaryCloudName ?? null}
          preset={getConfig().cloudinaryUploadPreset ?? null}
        />
      ) : null}

      {/* Directly under the standings: the weekly low is a regular-season fact,
          and the table above is where a reader just saw the 🚽 count that this
          panel itemises. Renders nothing for a season the sheet has no record
          of, which is every season before 2025. */}
      {features().weeklyLowPunishment ? (
        <SeasonPunishments
          season={season}
          lows={getPunishmentLows().find((s) => s.season === season)?.lows ?? []}
          teams={getPunishmentTeams()}
          names={ownerNames}
          {...punishmentsSource()}
        />
      ) : null}

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
              ladder={b.ladder}
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
            // ESPN's is a ladder; Sleeper's toilet bowl is a real bracket.
            ladder={summary.ladderConsolation}
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
                        <span>{gameLabel(m)}</span>
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
      {trades.length ? (
        <Panel>
          <PanelHeader
            title="Trades"
            meta={`${trades.length} this season`}
            href="/trades/"
            hrefLabel="All trades"
          />
          <TradeList
                  trades={trades}
                  players={players}
                  ownerNames={ownerNames}
                  outcomes={outcomes}
                  returns={returns}
                  handoffs={handoffs}
                  allTrades={allTrades}
                  showSeason={false}
                />
        </Panel>
      ) : null}
    </div>
  );
}

/**
 * The season being played.
 *
 * A SERVER SHELL AROUND A CLIENT BODY. Everything on this page moves — records,
 * points, seeding — so it all comes from the live layer in the browser; what the
 * server contributes is the things that do not move: who the owners are, how many
 * teams make the playoffs, and the punishment panels, which are per-season and
 * already fetch their own feed.
 */
async function InProgressSeasonPage({ season }: { season: number }) {
  const owners = getOwnerMap();
  const ownerNames = Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]));
  const seasonPunishment = getSeasonPunishment(season);

  /**
   * League shape from the most recent FINISHED season.
   *
   * Neither provider publishes the playoff-team count and the regular-season
   * length in a form this page can rely on, and both are settings that change
   * about never. A league with no finished season yet passes nulls and the cut
   * line simply is not drawn — better than guessing where it falls.
   */
  const last = getSeasons()
    .filter((s) => s.finalized)
    .sort((a, b) => b.season - a.season)[0];
  const playoffTeams = last ? last.standings.filter((r) => r.madePlayoffs).length : null;

  const hasDraft = getDrafts().some((p) => p.season === season);
  const draftHref = hasDraft ? `/history/${season}/draft/` : null;

  /**
   * How many weeks the season runs to, from the last finished one — its highest
   * matchup week, which is the regular season plus however many playoff rounds
   * the league plays. 17 is the NFL's own ceiling and the fallback for a league
   * with nothing finished yet.
   */
  const seasonWeeks = last
    ? Math.max(
        ...getMatchupHistory()
          .filter((m) => m.season === last.season)
          .map((m) => m.week),
        last.regularSeasonWeeks,
      )
    : 17;

  /**
   * TRADES ARE ALREADY COMMITTED FOR A SEASON IN PROGRESS, unlike everything else
   * on this page. Sync fetches transactions through the week the league is ON
   * rather than the week it has SCORED — a completed trade is final the moment it
   * processes — and derive builds them through `loadLiveTradeSources()`. So this
   * is ordinary derived data and reads exactly as it does on a finished season.
   */
  const trades = getTrades().filter((t) => t.season === season).reverse();
  /**
   * ACTIVE OWNERS ONLY, as on the home page. Which pairs play this week is
   * decided in the browser, so the whole matrix has to ship — but a departed
   * owner cannot be in this week's fixtures, and dropping them cuts it by about
   * a third.
   */
  const h2h = Object.fromEntries(
    getOwnerRecords()
      .filter((r) => owners.get(r.ownerSlug)?.active)
      .map((r) => [
        r.ownerSlug,
        Object.fromEntries(
          Object.entries(r.vs)
            .filter(([opp]) => owners.get(opp)?.active)
            .map(([opp, v]) => [opp, { wins: v.wins, losses: v.losses, ties: v.ties }]),
        ),
      ]),
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <BackLink fallback={{ href: "/history/", label: "History" }} />
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{season} Season</h1>
          {draftHref ? (
            <Link
              href={draftHref}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ink-500 px-3 py-1.5 text-xs font-medium text-chalk-400 transition-colors hover:border-accent hover:text-accent"
            >
              View draft results
            </Link>
          ) : null}
        </div>
        {/* WHERE THE CHAMPION SITS ON A FINISHED SEASON. Naming one here — even
            as "TBD" — would put a trophy against a season nobody has won. */}
        <span className="rounded-full border border-accent-dim px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
          IN PROGRESS
        </span>
      </div>

      <LiveSeasonDetail
        season={season}
        refBySeason={getLeagueRefs()}
        initial={await getLiveSeason()}
        userIdToSlug={getUserIdToSlug()}
        ownerNames={ownerNames}
        playoffTeams={playoffTeams}
        regularSeasonWeeks={last?.regularSeasonWeeks ?? null}
        seasonWeeks={seasonWeeks}
        thresholds={getRecordThresholds()}
        h2h={h2h}
        archivedThrough={last?.season ?? 0}
        upcomingIds={(await getLiveSchedule()).map((g) => g.id)}
        players={getPlayers()}
        footer={
          trades.length ? (
            <Panel>
              <PanelHeader
                title="Trades"
                meta={`${trades.length} this season`}
                href="/trades/"
                hrefLabel="All trades"
              />
              <TradeList
                trades={trades}
                players={getPlayers()}
                ownerNames={ownerNames}
                outcomes={getPickOutcomes()}
                returns={getTradeReturns()}
                handoffs={getPickHandoffs()}
                allTrades={Object.fromEntries(getTrades().map((t) => [t.id, t]))}
                showSeason={false}
              />
            </Panel>
          ) : null
        }
      >
        {seasonPunishment ? (
          <SeasonPunishmentPanel
            league={getConfig().slug}
            punishment={seasonPunishment}
            teams={getPunishmentTeams()}
            names={ownerNames}
            cloud={getConfig().cloudinaryCloudName ?? null}
            preset={getConfig().cloudinaryUploadPreset ?? null}
          />
        ) : null}
        {features().weeklyLowPunishment ? (
          <SeasonPunishments
            season={season}
            lows={getPunishmentLows().find((s) => s.season === season)?.lows ?? []}
            teams={getPunishmentTeams()}
            names={ownerNames}
            {...punishmentsSource()}
          />
        ) : null}
      </LiveSeasonDetail>
    </div>
  );
}
