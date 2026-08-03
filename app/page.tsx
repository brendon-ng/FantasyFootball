import Link from "next/link";

import { HomeKeeperBoard } from "@/components/home-keeper-board";
import {
  Col,
  EmptyState,
  ListHeader,
  LiveBadge,
  Panel,
  PanelHeader,
  Stat,
  fmt,
  placeColor,
} from "@/components/ui";
import {
  creditedNames,
  features,
  getAdp,
  getConfig,
  getKeepers,
  getLiveSeason,
  getOwnerMap,
  getOwnerRecords,
  getPlayers,
  getRecordThresholds,
  getSeasons,
  meetingId,
} from "@/lib/data";

/**
 * League at a glance.
 *
 * The page adapts to where the calendar actually is. In season it leads with
 * standings and this week's matchups; in the offseason neither exists yet, so it
 * leads with keeper contracts heading into the draft and last season's final
 * table — which is what people are actually arguing about in August.
 */
export default async function HomePage() {
  const live = await getLiveSeason();
  const seasons = getSeasons();
  const owners = getOwnerMap();
  const records = getOwnerRecords();
  const keepers = getKeepers();
  const players = getPlayers();
  const adp = getAdp();
  const cfg = getConfig();

  const finalized = seasons.filter((s) => s.finalized).sort((a, b) => b.season - a.season);
  const lastSeason = finalized[0];
  const inSeason = live?.seasonType === "regular" || live?.seasonType === "post";
  const currentSeason = live?.season ?? (lastSeason ? lastSeason.season + 1 : 0);

  // Live rosters first — they are authoritative for the season being played, and
  // are the only source in a league's first year, before any season finalizes.
  const leagueSize = live?.teams.length || lastSeason?.teams || 0;

  // Was hardcoded "10 teams · PPR keeper", which is wrong for any other league.
  const format = `${leagueSize} teams · PPR ${features().keepers ? "keeper" : "redraft"}`;
  const preDraftNote = features().keepers
    ? "Pre-draft · keeper deadline is 3 days before the draft"
    : "Pre-draft";

  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  // Live contracts grouped by owner, best (earliest round) first.
  const byOwner = new Map<string, typeof keepers.final>();
  for (const c of keepers.final) {
    if (!c.ownerSlug) continue;
    byOwner.set(c.ownerSlug, [...(byOwner.get(c.ownerSlug) ?? []), c]);
  }
  for (const list of byOwner.values()) list.sort((a, b) => a.round - b.round);

  const MAX_KEEPERS = 4;

  /**
   * Where a live score would land in the record book if the week ended now.
   *
   * Compared against the same arrays the record page renders, so a chip here
   * and a row there cannot disagree.
   */
  const thresholds = getRecordThresholds();
  const pace = (points: number): { rank: number; tone: "good" | "bad" } | null => {
    const hi = thresholds.high.findIndex((p) => points > p);
    if (hi >= 0) return { rank: hi + 1, tone: "good" };
    const lo = thresholds.low.findIndex((p) => points < p);
    if (lo >= 0) return { rank: lo + 1, tone: "bad" };
    return null;
  };

  // Home is a snapshot of the league as it stands, so the leaderboard is current
  // owners only. Departed owners (and the full table) live on the history page.
  //
  // Length is the league's team count, not a fixed 10, so a 12-team league is
  // not silently cut to 10. Note it is TEAMS, not active owners: co-owned teams
  // mean Den Ops has 12 active owners across 10 teams, so the last couple still
  // fall below the fold here. The full table on /history has everyone.
  const leaders = records
    .filter((r) => owners.get(r.ownerSlug)?.active)
    .slice(0, leagueSize || 10);

  return (
    <div className="space-y-5 sm:space-y-6">
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

      {lastSeason ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat
            label={`${lastSeason.season} Champion`}
            value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.champion)}</span>}
            tone="gold"
          />
          <Stat
            label="Runner-up"
            value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.runnerUp)}</span>}
          />
          <Stat
            label="Third"
            value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.thirdPlace)}</span>}
          />
          <Stat
            label="Last Place"
            value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.lastPlace)}</span>}
            sub="Toilet bowl loser"
          />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-5 lg:gap-6">
        <Panel className="lg:col-span-3">
          <PanelHeader
            title={inSeason ? "Standings" : `${lastSeason?.season ?? ""} Final Standings`}
            meta={inSeason ? "live" : "final"}
            href={lastSeason ? `/history/${lastSeason.season}/` : undefined}
            hrefLabel="Season detail"
          />
          {inSeason && live ? (
            <StandingsLive live={live} owners={owners} />
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
            title={inSeason ? "This Week" : "All-Time Leaders"}
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
                                    ? `On pace for the ${p.rank === 1 ? "highest" : `#${p.rank}`} weekly score in league history`
                                    : `On pace for the ${p.rank === 1 ? "lowest" : `#${p.rank}`} weekly score in league history`
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
                <Col className="w-16 shrink-0 text-right" hint="All-time regular-season wins-losses">
                  W-L
                </Col>
                <Col
                  className="w-12 shrink-0 text-right"
                  hint="Win percentage, counting a tie as half a win"
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

      {features().keepers ? (
        <Panel>
          <PanelHeader
            title={`Keeper Board · Entering ${currentSeason}`}
            meta={
              adp.capturedAt
                ? `top ${MAX_KEEPERS} per team · ADP ${adp.frozen ? "locked" : "live"}`
                : `top ${MAX_KEEPERS} eligible per team`
            }
            legend={
              <>
                Columns: <span className="text-chalk-400">Sleeper ADP</span> ·{" "}
                <span className="text-chalk-400">rounds cheaper (+) or dearer (−) than market</span>{" "}
                · <span className="text-chalk-400">keeps left</span> ·{" "}
                <span className="text-chalk-400">round it costs to keep</span>
              </>
            }
            href="/keepers/"
            hrefLabel="Full keeper tracker"
          />
          {byOwner.size === 0 ? (
            <EmptyState>No contracts yet — run npm run data.</EmptyState>
          ) : (
            <HomeKeeperBoard
              contractsByOwner={[...byOwner.entries()].sort(([a], [b]) =>
                (owners.get(a)?.name ?? a).localeCompare(owners.get(b)?.name ?? b),
              )}
              ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
              userIdToSlug={Object.fromEntries(
                [...owners.values()].filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
              )}
              players={players}
              adp={Object.fromEntries(adp.byPlayer)}
              leagueId={cfg.knownLeagueIds[String(currentSeason)] ?? null}
              maxKeepers={MAX_KEEPERS}
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

/** In-season standings, ordered by wins then points for (bylaws 1.8.2.4). */
function StandingsLive({
  live,
  owners,
}: {
  live: NonNullable<Awaited<ReturnType<typeof getLiveSeason>>>;
  owners: ReturnType<typeof getOwnerMap>;
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
            {owners.get(t.ownerSlug)?.name ?? t.ownerSlug}
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
