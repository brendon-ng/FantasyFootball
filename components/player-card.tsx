"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { PlayerTransactions } from "@/components/player-live";
import { Sheet } from "@/components/sheet";
import { playerAge } from "@/lib/adp-format";
import type { LeagueRef } from "@/lib/league-ref";
import {
  fetchBio,
  fetchDepthChart,
  fetchHistory,
  fetchNews,
  fetchResearch,
  fetchSeasonLine,
  fetchWeeks,
  headshotUrl,
  teamLogoUrl,
  type NewsItem,
  type PlayerBio,
  type StatEntry,
} from "@/lib/live/player-card";
import { leagueScoring, scoreLine } from "@/lib/live/sleeper";
import { NFL_TEAMS } from "@/lib/nfl-teams";

/**
 * A read-only copy of Sleeper's player card: who he is, how he has done week by
 * week, every news item ever written about him, where he sits on his team's
 * depth chart, and every move he has made in this league.
 *
 * TWO LAYOUTS FROM ONE SET OF DATA. A wide screen gets the desktop card — a
 * header band over a game log, the news and a tabbed lower pane, each scrolling
 * on its own. A phone gets Sleeper's app layout: a tall header, then Summary,
 * Game log, Team and History tabs, scrolling as one. Both are rendered and CSS
 * shows one, so the fetches happen once and switching width never refetches.
 *
 * OPENED FROM ANYWHERE THROUGH CONTEXT. A name anywhere inside the provider asks
 * to open a card instead of each surface threading a callback down to its rows;
 * `PlayerName` reads it, and outside a provider a name is just a name.
 *
 * POINTS ARE SCORED THE LEAGUE'S WAY, from the stat line with the league's own
 * settings, the same as every projection on the trade pages — Sleeper's
 * `pts_ppr` is default scoring and would disagree with the lineups beside it.
 * Past seasons are scored with this year's settings, since that is the
 * question being asked of them.
 */

interface CardContext {
  open: (id: string) => void;
}

const Ctx = createContext<CardContext | null>(null);
export const usePlayerCard = (): CardContext | null => useContext(Ctx);

interface CardEnv {
  leagueRef: LeagueRef | null;
  season: number;
  /** The week the rostered / started percentages are read for. */
  week: number;
  /** Who rosters a player in this league, or null for a free agent. */
  holderOf: (id: string) => { label: string; slug: string } | null;
  /** Names for depth-chart rows, which the card's own feeds do not carry. */
  nameOf: (id: string) => string;
  /** Players with a page on this site. */
  linkable: Set<string>;
  /** The committed history file — see app/trade-analyzer/history.json. */
  historyUrl: string;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
}

export function PlayerCardProvider({ children, ...env }: CardEnv & { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ open: setId }}>
      {children}
      {id ? <PlayerCard key={id} id={id} env={env} onOpen={setId} onClose={() => setId(null)} /> : null}
    </Ctx.Provider>
  );
}

/** Fetch once per key; `ready` once it has settled either way. */
function useFetched<T>(key: string | null, load: () => Promise<T | null>): { ready: boolean; data: T | null } {
  const [state, setState] = useState<{ key: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load().then((data) => {
      if (!cancelled) setState({ key, data });
    });
    return () => {
      cancelled = true;
    };
    // `key` stands in for `load`, a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const hit = key && state?.key === key ? state : null;
  return { ready: Boolean(hit), data: hit?.data ?? null };
}

/**
 * News paging: five stories to start — the card is a glance, and a feed opening
 * fifty deep buries everything under it — then 50, then 100 at a time.
 */
const NEWS_FIRST = 5;
const nextNewsLimit = (limit: number) => (limit < 50 ? 50 : limit + 100);

type MobileTab = "summary" | "log" | "team" | "history";
type LowerTab = "depth" | "moves" | "career";

function PlayerCard({
  id,
  env,
  onOpen,
  onClose,
}: {
  id: string;
  env: CardEnv;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { leagueRef, season, week, holderOf, nameOf, linkable, historyUrl, userIdToSlug, ownerNames } = env;
  const leagueId = leagueRef?.id ?? null;
  const isDefense = /^[A-Z]{2,4}$/.test(id);
  const [tab, setTab] = useState(season);
  const [mobileTab, setMobileTab] = useState<MobileTab>("summary");
  const [lowerTab, setLowerTab] = useState<LowerTab>("depth");
  // The previous limit is kept so its page, already cached, shows while the next loads.
  const [newsPage, setNewsPage] = useState({ limit: NEWS_FIRST, prev: 0 });
  const newsLimit = newsPage.limit;

  const bio = useFetched(`bio:${id}`, () => fetchBio(id));
  const line = useFetched(`line:${id}:${season}`, () => fetchSeasonLine(id, season));
  const research = useFetched(`research:${season}:${week}`, () => fetchResearch(season, week));
  const stats = useFetched(`stats:${id}:${tab}`, () => fetchWeeks(id, tab, "stats"));
  const proj = useFetched(`proj:${id}:${tab}`, () => fetchWeeks(id, tab, "projections"));
  // The summary's projection strip is always this season, whatever the log shows.
  const nowStats = useFetched(`stats:${id}:${season}`, () => fetchWeeks(id, season, "stats"));
  const nowProj = useFetched(`proj:${id}:${season}`, () => fetchWeeks(id, season, "projections"));
  const scoring = useFetched(leagueId ? `scoring:${leagueId}` : null, () =>
    leagueId ? leagueScoring(leagueId) : Promise.resolve(null),
  );
  const team = bio.data?.team ?? (isDefense ? id : null);
  const depth = useFetched(team ? `depth:${team}` : null, () => (team ? fetchDepthChart(team) : Promise.resolve(null)));
  const news = useFetched(`news:${id}:${newsLimit}`, () => fetchNews(id, newsLimit));
  /**
   * The previous page stays on screen while the next loads, so "Show more"
   * grows the list instead of blanking it. Read back through the same cache —
   * it was fetched a moment ago, so it resolves at once.
   */
  const prevLimit = newsPage.prev;
  const prevNews = useFetched(prevLimit ? `news:${id}:${prevLimit}` : null, () => fetchNews(id, prevLimit));
  const shownNews: NewsItem[] | null = news.ready ? news.data : prevNews.data;
  const history = useFetched(`history:${historyUrl}`, () => fetchHistory(historyUrl));

  const b = bio.data;
  const rookieYear = Number(b?.metadata?.rookie_year) || (b?.years_exp != null ? season - b.years_exp : season);
  const seasons = Array.from({ length: Math.max(1, season - Math.max(2012, rookieYear) + 1) }, (_, i) => season - i);
  // Career is a request per season, so it waits until somebody looks at it.
  const wantCareer = mobileTab === "history" || lowerTab === "career";
  const career = useFetched(wantCareer && b ? `career:${id}:${seasons.join(",")}` : null, async () =>
    Promise.all(seasons.map(async (y) => ({ season: y, line: await fetchSeasonLine(id, y) }))),
  );

  const name = b ? `${b.first_name} ${b.last_name}` : nameOf(id);
  const position = b?.position ?? (isDefense ? "DEF" : null);
  const holder = holderOf(id);
  const ranks = line.data?.stats;
  const pct = research.data?.[id];

  const points = (s: Record<string, number> | undefined) =>
    s ? (scoring.data ? scoreLine(s, scoring.data) : (s.pts_ppr ?? 0)) : null;
  const perGame = ranks && (ranks.gp ?? 0) > 0 ? (points(ranks) ?? 0) / ranks.gp : null;

  const transactions = (
    <PlayerTransactions
      playerId={id}
      baked={history.data?.[id] ?? []}
      leagueRef={leagueRef}
      season={season}
      // The latest few weeks, where an unarchived move can still be.
      fromWeek={Math.max(1, week - 3)}
      userIdToSlug={userIdToSlug}
      ownerNames={ownerNames}
    />
  );
  const careerTable = <Career rows={career.data} loading={!career.ready} points={points} position={position} />;
  const depthChart =
    depth.data && team ? (
      <DepthChart chart={depth.data} focus={id} position={position} nameOf={nameOf} onOpen={onOpen} />
    ) : (
      <p className="px-4 py-6 text-center text-sm text-chalk-600 sm:px-5">
        {depth.ready || !team ? "No depth chart." : "Loading…"}
      </p>
    );
  const newsList = (
    <NewsList
      items={shownNews}
      more={Boolean(shownNews && shownNews.length >= newsLimit)}
      loading={!news.ready}
      onMore={() => setNewsPage((p) => ({ limit: nextNewsLimit(p.limit), prev: p.limit }))}
    />
  );
  const seasonTabs = (
    <div className="flex max-w-full gap-1 overflow-x-auto">
      {seasons.map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => setTab(y)}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
            tab === y ? "bg-accent/20 text-accent" : "text-chalk-500 hover:text-chalk-200"
          }`}
        >
          {y}
        </button>
      ))}
    </div>
  );
  const gameLog = (
    <GameLog
      position={position}
      stats={stats.data}
      proj={proj.data}
      loading={!stats.ready || !proj.ready}
      points={points}
      currentWeek={tab === season ? week : null}
      maxWeek={tab >= 2021 ? 18 : 17}
    />
  );
  const historyLink = linkable.has(id) ? (
    <Link href={`/players/${id}/`} className="text-chalk-400 transition-colors hover:text-accent">
      His history in this league →
    </Link>
  ) : null;

  return (
    <Sheet
      label={`${name} player card`}
      onClose={onClose}
      // Above the week sheet it is usually opened from.
      zClassName="z-[60]"
      /**
       * ON A WIDE SCREEN THE CARD DOES NOT SCROLL — the game log, the news and
       * the lower pane each do, so nothing is a long way down anything else. On
       * a phone the card scrolls as one, the way Sleeper's app does.
       */
      panelClassName="max-h-[92dvh] max-w-[72rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-850 shadow-2xl sm:rounded-xl lg:flex lg:h-[92dvh] lg:flex-col lg:overflow-hidden"
    >
      {({ close }) => (
        <>
          {/* ------------------------------------------------ phone layout */}
          <div className="lg:hidden">
            <MobileHeader
              id={id}
              bio={b}
              name={name}
              team={team}
              position={position}
              holder={holder}
              isDefense={isDefense}
              onClose={() => close()}
            />
            <div
              role="tablist"
              aria-label="Player card sections"
              className="sticky top-0 z-10 grid grid-cols-4 border-b border-ink-600 bg-ink-850"
            >
              {(
                [
                  ["summary", "Summary"],
                  ["log", "Game log"],
                  ["team", "Team"],
                  ["history", "History"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === v}
                  onClick={() => setMobileTab(v)}
                  className={`border-b-2 py-3 text-[12px] font-bold uppercase tracking-wide transition-colors ${
                    mobileTab === v ? "border-chalk-100 text-chalk-100" : "border-transparent text-chalk-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mobileTab === "summary" ? (
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-3 gap-3 px-4">
                  <SummaryStat title="Player rank">
                    <Figure value={ranks?.pos_rank_ppr ? `#${ranks.pos_rank_ppr}` : "—"} label={position ?? ""} />
                    <Figure value={ranks?.rank_ppr ? `#${ranks.rank_ppr}` : "—"} label="Overall" />
                  </SummaryStat>
                  <SummaryStat title="Ownership">
                    <Figure value={pct?.owned != null ? `${Math.round(pct.owned)}%` : "—"} label="Roster" />
                    <Figure value={pct?.started != null ? `${Math.round(pct.started)}%` : "—"} label="Start" />
                  </SummaryStat>
                  <SummaryStat title="Fpts / game">
                    <Figure value={perGame != null ? perGame.toFixed(2) : "—"} label={`${season}`} />
                  </SummaryStat>
                </div>
                <section>
                  <h3 className="eyebrow mb-2 px-4">Projections</h3>
                  <ProjectionStrip
                    stats={nowStats.data}
                    proj={nowProj.data}
                    points={points}
                    currentWeek={week}
                    maxWeek={season >= 2021 ? 18 : 17}
                  />
                </section>
                <section>
                  <h3 className="eyebrow mb-1 px-4">Recent news</h3>
                  {newsList}
                </section>
              </div>
            ) : mobileTab === "log" ? (
              <div className="py-3">
                <div className="mb-2 px-4">{seasonTabs}</div>
                {gameLog}
                {historyLink ? <div className="px-4 pt-3 text-right text-xs">{historyLink}</div> : null}
              </div>
            ) : mobileTab === "team" ? (
              <div className="py-3">
                <h3 className="eyebrow mb-2 px-4">Depth chart</h3>
                {depth.data && team ? (
                  <DepthTable chart={depth.data} focus={id} nameOf={nameOf} onOpen={onOpen} />
                ) : (
                  depthChart
                )}
              </div>
            ) : (
              <div className="space-y-6 py-3">
                <section>
                  <h3 className="eyebrow mb-1 px-4">Transaction history</h3>
                  {transactions}
                </section>
                <section>
                  <h3 className="eyebrow mb-2 px-4">Career</h3>
                  {careerTable}
                </section>
              </div>
            )}
          </div>

          {/* ------------------------------------------------ wide layout */}
          <div className="hidden lg:contents">
            <DesktopHeader
              id={id}
              bio={b}
              name={name}
              team={team}
              position={position}
              holder={holder}
              isDefense={isDefense}
              season={season}
              ranks={ranks}
              pct={pct}
              onClose={() => close()}
            />
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] grid-rows-[minmax(0,1fr)] bg-ink-850">
              <section className="flex min-h-0 min-w-0 flex-col">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-5 py-3">
                  <h3 className="eyebrow">Game logs</h3>
                  {seasonTabs}
                </div>
                {gameLog}
                {historyLink ? (
                  <div className="shrink-0 border-t border-ink-600 px-5 py-2 text-right text-xs">{historyLink}</div>
                ) : null}
              </section>

              <aside className="flex min-h-0 min-w-0 flex-col border-l border-ink-600">
                <section className="flex min-h-0 flex-[3] flex-col">
                  <h3 className="eyebrow shrink-0 border-b border-ink-600 px-5 py-3">News</h3>
                  <div className="min-h-0 flex-1 overflow-y-auto">{newsList}</div>
                </section>
                <section className="flex min-h-0 flex-[2] flex-col border-t border-ink-600">
                  <div role="tablist" aria-label="More" className="flex shrink-0 gap-4 border-b border-ink-600 px-5">
                    {(
                      [
                        ["depth", "Depth chart"],
                        ["moves", "Transactions"],
                        ["career", "Career"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={lowerTab === v}
                        onClick={() => setLowerTab(v)}
                        className={`eyebrow -mb-px border-b-2 py-3 transition-colors ${
                          lowerTab === v ? "border-chalk-300 text-chalk-200" : "border-transparent hover:text-chalk-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {lowerTab === "depth" ? depthChart : lowerTab === "moves" ? transactions : careerTable}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Sleeper's colour per position, as its app marks them. */
const POSITION_TONE: Record<string, string> = {
  QB: "text-[#ff4a8d]",
  RB: "text-[#20d1b2]",
  WR: "text-[#55a7ff]",
  TE: "text-[#ffae58]",
};

interface HeaderProps {
  id: string;
  bio: PlayerBio | null;
  name: string;
  team: string | null;
  position: string | null;
  holder: { label: string; slug: string } | null;
  isDefense: boolean;
  onClose: () => void;
}

function Headshot({ id, name, className }: { id: string; name: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={headshotUrl(id)}
      alt={name}
      className={className}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

function HolderLine({ holder }: { holder: { label: string; slug: string } | null }) {
  return holder ? (
    <>
      <span aria-hidden>→ </span>
      <span data-owner={holder.slug}>{holder.label}</span>
    </>
  ) : (
    <>Free agent in this league</>
  );
}

const bandStyle = (color: string | undefined) => ({
  background: `linear-gradient(120deg, ${color ?? "#2a2a33"} 0%, ${color ?? "#2a2a33"}cc 40%, #0e0e11 100%)`,
});

/** The phone header: headshot and team on the left, name and bio on the right. */
function MobileHeader({ id, bio: b, name, team, position, holder, isDefense, onClose }: HeaderProps) {
  const colors = team ? NFL_TEAMS[team] : null;
  const [first, ...rest] = name.split(" ");
  return (
    <div className="relative overflow-hidden" style={bandStyle(colors?.color)}>
      {team ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={teamLogoUrl(team)}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -left-10 top-4 h-40 w-40 opacity-25"
        />
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 rounded-full bg-black/30 px-2.5 py-1 text-sm text-white/90"
      >
        ✕
      </button>
      <div className="relative grid grid-cols-[40%_1fr] gap-3 px-3 pt-6">
        <div className="flex flex-col items-center">
          <Headshot id={id} name={name} className="h-32 w-auto object-contain drop-shadow-xl" />
          <div className="mt-1 w-full bg-ink-850/80 py-1.5 text-center">
            <div className="text-[13px] font-extrabold uppercase tracking-wide text-white">
              {team ? (colors?.name ?? team) : "Free agent"}
            </div>
            <div className="text-[12px] font-bold text-white/90">
              <span className={POSITION_TONE[position ?? ""] ?? ""}>{position ?? "—"}</span>
              {team ? ` • ${team}` : ""}
              {b?.number != null ? ` • #${b.number}` : ""}
            </div>
          </div>
        </div>
        <div className="min-w-0 pb-4 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          <div className="truncate pr-8 text-[12px] text-white/85">
            <HolderLine holder={holder} />
          </div>
          <h2 className="mt-1 font-extrabold uppercase leading-none tracking-tight">
            <span className="block text-lg">{first}</span>
            <span className="block truncate text-2xl">{rest.join(" ") || first}</span>
          </h2>
          {b?.injury_status ? (
            <div className="mt-1 inline-block rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold text-caution">
              {b.injury_status}
            </div>
          ) : null}
          {!isDefense ? (
            <dl className="mt-3 grid grid-cols-4 gap-1">
              <MiniBio label="Age" value={ageOf(b)} />
              <MiniBio label="Height" value={feetInches(b?.height)} />
              <MiniBio label="Weight" value={b?.weight ? `${b.weight}` : null} />
              <MiniBio label="Exp" value={b?.years_exp ?? null} />
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DesktopHeader({
  id,
  bio: b,
  name,
  team,
  position,
  holder,
  isDefense,
  season,
  ranks,
  pct,
  onClose,
}: HeaderProps & {
  season: number;
  ranks: Record<string, number> | undefined;
  pct: { owned?: number; started?: number } | undefined;
}) {
  const colors = team ? NFL_TEAMS[team] : null;
  return (
    <div className="relative shrink-0 overflow-hidden" style={bandStyle(colors?.color)}>
      {team ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={teamLogoUrl(team)}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -left-6 top-1/2 h-64 w-64 -translate-y-1/2 opacity-15"
        />
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 z-10 rounded-md border border-white/30 bg-black/20 px-2 py-1 text-xs text-white/90 transition-colors hover:bg-black/40"
      >
        Close
      </button>
      <div className="relative flex items-end gap-6 p-6">
        <div className="relative shrink-0">
          <Headshot id={id} name={name} className="h-44 w-auto object-contain drop-shadow-xl" />
          <div className="absolute -bottom-1 left-0 flex items-center overflow-hidden rounded-md text-sm font-bold text-white shadow">
            <span className="bg-black/50 px-2 py-1">{position ?? "—"}</span>
            {team ? (
              <span className="bg-black/30 px-2 py-1">
                {(colors?.name ?? team).toUpperCase()}
                {b?.number != null ? ` #${b.number}` : ""}
              </span>
            ) : (
              <span className="bg-black/30 px-2 py-1">FREE AGENT</span>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
          <div className="text-[12px] text-white/80">
            <HolderLine holder={holder} />
          </div>
          <h2 className="mt-0.5 text-4xl font-extrabold tracking-tight">{name}</h2>
          {b?.injury_status ? (
            <div className="mt-1 inline-block rounded bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-caution">
              {b.injury_status}
              {b.injury_body_part ? ` · ${b.injury_body_part}` : ""}
            </div>
          ) : null}
          {!isDefense ? (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <Bio label="Age" value={ageOf(b)} />
              <Bio label="Height" value={feetInches(b?.height)} />
              <Bio label="Weight" value={b?.weight ? `${b.weight} lbs` : null} />
              <Bio label="Exp" value={b?.years_exp ?? null} />
              <Bio label="College" value={b?.college ?? null} />
            </dl>
          ) : null}
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">{season} rankings</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <Rank value={ranks?.pos_rank_ppr ? `#${ranks.pos_rank_ppr}` : "—"} label={position ?? ""} />
              <Rank value={ranks?.rank_ppr ? `#${ranks.rank_ppr}` : "—"} label="overall" />
              <Rank value={pct?.owned != null ? `${Math.round(pct.owned)}%` : "—"} label="rostered" />
              <Rank value={pct?.started != null ? `${Math.round(pct.started)}%` : "—"} label="started" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ageOf = (b: PlayerBio | null) => playerAge(b?.birth_date) ?? b?.age ?? null;

function MiniBio({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-semibold uppercase tracking-wide text-white/70">{label}</dt>
      <dd className="truncate text-base font-bold leading-tight">{value ?? "—"}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryStat({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1.5 text-[10px]">{title}</div>
      <div className="flex gap-3">{children}</div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="tabular text-lg font-extrabold leading-tight text-chalk-100">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-chalk-500">{label}</div>
    </div>
  );
}

/**
 * One card per week — projected and final — scrolled so this week is in view.
 * The scroll happens once on mount; after that the reader owns it.
 */
function ProjectionStrip({
  stats,
  proj,
  points,
  currentWeek,
  maxWeek,
}: {
  stats: Record<number, StatEntry> | null;
  proj: Record<number, StatEntry> | null;
  points: (s: Record<string, number> | undefined) => number | null;
  currentWeek: number;
  maxWeek: number;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const ready = Boolean(proj);
  useEffect(() => {
    if (!ready) return;
    const el = strip.current?.querySelector<HTMLElement>(`[data-week="${currentWeek}"]`);
    if (el && strip.current) strip.current.scrollLeft = Math.max(0, el.offsetLeft - 16 - el.offsetWidth);
  }, [ready, currentWeek]);

  if (!proj) return <div className="skeleton mx-4 h-20 rounded" />;
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1).filter((w) => proj[w] || stats?.[w]);
  return (
    <div ref={strip} className="flex gap-3 overflow-x-auto px-4 pb-1">
      {weeks.map((w) => {
        const s = stats?.[w];
        const p = proj[w];
        const opp = s?.opponent ?? p?.opponent;
        const away = s?.is_away_team ?? p?.is_away_team;
        const played = Boolean(s && (s.stats.gp ?? 0) > 0);
        return (
          <div key={w} data-week={w} className="w-36 shrink-0">
            <div className="mb-1 text-center text-[12px] font-bold text-chalk-300">
              WK {w} <span className="font-normal text-chalk-500">{away ? "@" : "vs"} {opp ?? "—"}</span>
            </div>
            <div className={`overflow-hidden rounded-lg ${w === currentWeek ? "ring-1 ring-accent-dim" : ""}`}>
              <div className="flex items-baseline justify-between bg-ink-700 px-3 py-2">
                <span className="text-[10px] font-bold tracking-wide text-chalk-500">PROJ</span>
                <span className="tabular text-base font-bold text-chalk-200">{fmtNum(points(p?.stats), 2)}</span>
              </div>
              <div className="flex items-baseline justify-between bg-ink-800 px-3 py-2">
                <span className="text-[10px] font-bold tracking-wide text-chalk-500">FINAL</span>
                <span className="tabular text-base font-bold text-chalk-100">
                  {played ? fmtNum(points(s?.stats), 2) : "-"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// News list, career, depth table
// ---------------------------------------------------------------------------

function NewsList({
  items,
  more,
  loading,
  onMore,
}: {
  items: NewsItem[] | null;
  more: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  if (!items) {
    return (
      <div className="space-y-2 p-4 sm:p-5">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-20 w-full rounded" />
        ))}
      </div>
    );
  }
  if (!items.length) return <p className="px-4 py-6 text-center text-sm text-chalk-600 sm:px-5">No news.</p>;
  return (
    <>
      <ol className="divide-y divide-ink-600">
        {items.map((n) => (
          <NewsRow key={`${n.source}:${n.source_key}`} item={n} />
        ))}
      </ol>
      {more ? (
        <div className="border-t border-ink-600 px-4 py-2 text-center sm:px-5">
          <button
            type="button"
            disabled={loading}
            onClick={onMore}
            className="text-xs text-chalk-400 transition-colors hover:text-accent disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Season by season: games, fantasy points the league's way, position rank. */
function Career({
  rows,
  loading,
  points,
  position,
}: {
  rows: Array<{ season: number; line: StatEntry | null }> | null;
  loading: boolean;
  points: (s: Record<string, number> | undefined) => number | null;
  position: string | null;
}) {
  if (loading) return <div className="skeleton mx-4 my-3 h-24 rounded" />;
  const played = (rows ?? []).filter((r) => (r.line?.stats?.gp ?? 0) > 0);
  if (!played.length) return <p className="px-4 py-6 text-center text-sm text-chalk-600">No seasons played.</p>;
  const cell = "px-2 py-1.5 text-right tabular";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-[12px]">
        <thead>
          <tr className="border-b border-ink-600 text-[10px] uppercase tracking-wide text-chalk-600">
            <th className="px-4 py-1.5 text-left font-normal">Season</th>
            <th className="px-2 py-1.5 text-left font-normal">Team</th>
            <th className="px-2 py-1.5 text-right font-normal">GM</th>
            <th className="px-2 py-1.5 text-right font-normal">FPTS</th>
            <th className="px-2 py-1.5 text-right font-normal">FPTS/G</th>
            <th className="px-2 py-1.5 text-right font-normal">{position ?? "Pos"} rank</th>
            <th className="px-2 py-1.5 pr-4 text-right font-normal">Overall</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700">
          {played.map(({ season, line }) => {
            const s = line!.stats;
            const total = points(s) ?? 0;
            return (
              <tr key={season}>
                <td className="px-4 py-1.5 font-semibold text-chalk-200">{season}</td>
                <td className="px-2 py-1.5 text-chalk-400">{line!.team ?? "—"}</td>
                <td className={`${cell} text-chalk-300`}>{s.gp}</td>
                <td className={`${cell} font-semibold text-chalk-100`}>{total.toFixed(2)}</td>
                <td className={`${cell} text-chalk-300`}>{(total / s.gp).toFixed(2)}</td>
                <td className={`${cell} text-chalk-300`}>{s.pos_rank_ppr ?? "—"}</td>
                <td className={`${cell} pr-4 text-chalk-300`}>{s.rank_ppr ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The phone's depth chart: one row per group, starter / 2nd / 3rd across. */
function DepthTable({
  chart,
  focus,
  nameOf,
  onOpen,
}: {
  chart: Record<string, string[]>;
  focus: string;
  nameOf: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  const groups = ["QB", "RB", "WR1", "WR2", "WR3", "TE", "K"].filter((g) => chart[g]?.length);
  return (
    <div className="overflow-x-auto px-4">
      <table className="w-full min-w-max overflow-hidden rounded-lg text-[13px]">
        <thead>
          <tr className="bg-ink-700 text-[11px] font-semibold uppercase text-chalk-500">
            <th className="px-3 py-2 text-left">Off</th>
            <th className="px-3 py-2 text-left">Starter</th>
            <th className="px-3 py-2 text-left">2nd</th>
            <th className="px-3 py-2 text-left">3rd</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g} className={i % 2 ? "bg-ink-800" : "bg-ink-850"}>
              <td className="px-3 py-2 font-bold text-chalk-500">{g}</td>
              {[0, 1, 2].map((k) => {
                const pid = chart[g][k];
                if (!pid) return <td key={k} className="px-3 py-2" />;
                const [first, ...rest] = nameOf(pid).split(" ");
                return (
                  <td key={k} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(pid)}
                      className={`text-left leading-tight transition-colors hover:text-accent ${
                        pid === focus ? "text-chalk-100" : "text-chalk-300"
                      }`}
                    >
                      <span className="block text-[11px] text-chalk-500">{first}</span>
                      <span className="block font-semibold">{rest.join(" ") || first}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bio({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">{label}</dt>
      <dd className="text-lg font-bold leading-tight sm:text-2xl">{value ?? "—"}</dd>
    </div>
  );
}

function Rank({ value, label }: { value: string; label: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-xl font-extrabold sm:text-2xl">{value}</span>
      <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------

interface Column {
  label: string;
  value: (s: Record<string, number>) => number | null;
  digits?: number;
}

const stat = (key: string) => (s: Record<string, number>) => s[key] ?? null;
const ratio = (num: string, den: string) => (s: Record<string, number>) =>
  s[den] ? (s[num] ?? 0) / s[den] : null;

const PASS: Column[] = [
  { label: "ATT", value: stat("pass_att") },
  { label: "CMP", value: stat("pass_cmp") },
  { label: "YD", value: stat("pass_yd") },
  { label: "TD", value: stat("pass_td") },
  { label: "INT", value: stat("pass_int") },
];
const RUSH: Column[] = [
  { label: "ATT", value: stat("rush_att") },
  { label: "YD", value: stat("rush_yd") },
  { label: "YPC", value: ratio("rush_yd", "rush_att"), digits: 1 },
  { label: "TD", value: stat("rush_td") },
];
const REC: Column[] = [
  { label: "TGT", value: stat("rec_tgt") },
  { label: "REC", value: stat("rec") },
  { label: "YD", value: stat("rec_yd") },
  { label: "TD", value: stat("rec_td") },
];
const FUMBLE: Column[] = [
  { label: "FUM", value: stat("fum") },
  { label: "LOST", value: stat("fum_lost") },
];

/** Stat groups by position, in the order Sleeper's card lays them out. */
function groupsFor(position: string | null): Array<{ title: string; cols: Column[] }> {
  switch (position) {
    case "QB":
      return [
        { title: "Pass", cols: PASS },
        { title: "Rushing", cols: RUSH },
        {
          title: "Sacked",
          cols: [
            { label: "SK", value: stat("pass_sack") },
            { label: "YDS", value: stat("pass_sack_yds") },
          ],
        },
        { title: "Fumble", cols: FUMBLE },
      ];
    case "RB":
      return [
        { title: "Rushing", cols: RUSH },
        { title: "Receiving", cols: REC },
        { title: "Fumble", cols: FUMBLE },
      ];
    case "WR":
    case "TE":
      return [
        { title: "Receiving", cols: REC },
        { title: "Rushing", cols: RUSH.filter((c) => c.label !== "YPC") },
        { title: "Fumble", cols: FUMBLE },
      ];
    case "K":
      return [
        {
          title: "Field goals",
          cols: [
            { label: "FGM", value: stat("fgm") },
            { label: "FGA", value: stat("fga") },
            { label: "0-19", value: stat("fgm_0_19") },
            { label: "20-29", value: stat("fgm_20_29") },
            { label: "30-39", value: stat("fgm_30_39") },
            { label: "40-49", value: stat("fgm_40_49") },
            { label: "50+", value: stat("fgm_50p") },
          ],
        },
        {
          title: "Extra points",
          cols: [
            { label: "XPM", value: stat("xpm") },
            { label: "XPA", value: stat("xpa") },
          ],
        },
      ];
    case "DEF":
      return [
        {
          title: "Defense",
          cols: [
            { label: "SACK", value: stat("sack") },
            { label: "INT", value: stat("int") },
            { label: "FR", value: stat("fum_rec") },
            { label: "TD", value: stat("def_td") },
          ],
        },
        {
          title: "Allowed",
          cols: [
            { label: "PTS", value: stat("pts_allow") },
            { label: "YDS", value: stat("yds_allow") },
          ],
        },
      ];
    default:
      return [{ title: "Receiving", cols: REC }, { title: "Rushing", cols: RUSH }];
  }
}

function GameLog({
  position,
  stats,
  proj,
  loading,
  points,
  currentWeek,
  maxWeek,
}: {
  position: string | null;
  stats: Record<number, StatEntry> | null;
  proj: Record<number, StatEntry> | null;
  loading: boolean;
  points: (s: Record<string, number> | undefined) => number | null;
  currentWeek: number | null;
  maxWeek: number;
}) {
  const groups = groupsFor(position);
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const snapPct = (s: Record<string, number>) =>
    s.tm_off_snp && s.off_snp != null ? Math.round((s.off_snp / s.tm_off_snp) * 100) : null;
  const showSnaps = position !== "K" && position !== "DEF";
  const cell = "px-1.5 py-1.5 text-right tabular";

  if (loading) {
    return (
      <div className="space-y-1.5 p-4 sm:p-5 lg:flex-1">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-6 w-full rounded" />
        ))}
      </div>
    );
  }

  return (
    // Scrolls both ways inside its own column, headings pinned.
    <div className="overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <table className="w-full min-w-max text-[12px]">
        <thead className="sticky top-0 z-10 bg-ink-850">
          <tr className="text-[10px] uppercase tracking-wide text-chalk-500">
            <th colSpan={2} />
            <th colSpan={showSnaps ? 3 : 2} className="border-l border-ink-600 px-1.5 pt-2 text-center font-semibold">
              Fantasy
            </th>
            {groups.map((g) => (
              <th key={g.title} colSpan={g.cols.length} className="border-l border-ink-600 px-1.5 pt-2 text-center font-semibold">
                {g.title}
              </th>
            ))}
          </tr>
          <tr className="border-b border-ink-600 text-[10px] text-chalk-600">
            <th className="px-2 py-1.5 text-left font-normal">WK</th>
            <th className="px-1.5 py-1.5 text-left font-normal">OPP</th>
            <th className="border-l border-ink-600 px-1.5 py-1.5 text-right font-normal">PROJ</th>
            <th className="px-1.5 py-1.5 text-right font-normal">FPTS</th>
            {showSnaps ? <th className="px-1.5 py-1.5 text-right font-normal">SNP%</th> : null}
            {groups.map((g) =>
              g.cols.map((c, i) => (
                <th
                  key={`${g.title}-${c.label}`}
                  className={`px-1.5 py-1.5 text-right font-normal ${i === 0 ? "border-l border-ink-600" : ""}`}
                >
                  {c.label}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-700">
          {weeks.map((w) => {
            const s = stats?.[w];
            const p = proj?.[w];
            const opp = s?.opponent ?? p?.opponent ?? null;
            const away = s?.is_away_team ?? p?.is_away_team ?? false;
            const played = Boolean(s && (s.stats.gp ?? 0) > 0);
            const fpts = played ? points(s?.stats) : null;
            const projected = p ? points(p.stats) : null;
            return (
              <tr key={w} className={w === currentWeek ? "bg-accent/5" : undefined}>
                <td className="px-2 py-1.5 tabular text-chalk-500">{w}</td>
                <td className="px-1.5 py-1.5 font-semibold text-chalk-300">
                  {opp ? `${away ? "@" : ""}${opp}` : <span className="text-chalk-600">BYE</span>}
                </td>
                {opp ? (
                  <>
                    <td className={`${cell} border-l border-ink-600 text-chalk-500`}>{fmtNum(projected, 2)}</td>
                    <td className={`${cell} font-semibold text-chalk-100`}>{fmtNum(fpts, 2)}</td>
                    {showSnaps ? <td className={`${cell} text-chalk-400`}>{played ? fmtNum(snapPct(s!.stats)) : "-"}</td> : null}
                    {groups.map((g) =>
                      g.cols.map((c, i) => (
                        <td
                          key={`${g.title}-${c.label}`}
                          className={`${cell} text-chalk-300 ${i === 0 ? "border-l border-ink-600" : ""}`}
                        >
                          {played ? fmtNum(c.value(s!.stats), c.digits ?? 0) : "-"}
                        </td>
                      )),
                    )}
                  </>
                ) : (
                  <td colSpan={2 + (showSnaps ? 1 : 0) + groups.reduce((n, g) => n + g.cols.length, 0)} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// News and depth chart
// ---------------------------------------------------------------------------

const SOURCES: Record<string, string> = {
  fantasy_pros: "FantasyPros",
  rotowire: "RotoWire",
  rotoballer: "RotoBaller",
};

function NewsRow({ item }: { item: NewsItem }) {
  const m = item.metadata ?? {};
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="text-sm font-bold leading-snug text-chalk-100">{m.title ?? "Update"}</div>
      <div className="mt-0.5 text-[11px] text-chalk-600">
        {ago(item.published)} via {SOURCES[item.source] ?? item.source}
      </div>
      {m.description ? <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-300">{m.description}</p> : null}
      {m.analysis ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-300">
          <span className="font-semibold text-chalk-100">Analysis: </span>
          {m.analysis}
        </p>
      ) : null}
      {m.url ? (
        <a
          href={m.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-[11px] text-chalk-500 transition-colors hover:text-accent"
        >
          Read more ↗
        </a>
      ) : null}
    </li>
  );
}

/** The offensive groups, in the order a depth chart reads. */
const DEPTH_GROUPS: Array<{ key: string; label: string }> = [
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR1", label: "WR" },
  { key: "WR2", label: "WR" },
  { key: "WR3", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "K", label: "K" },
];

function DepthChart({
  chart,
  focus,
  position,
  nameOf,
  onOpen,
}: {
  chart: Record<string, string[]>;
  focus: string;
  position: string | null;
  nameOf: (id: string) => string;
  onOpen: (id: string) => void;
}) {
  // A kicker sees the kickers; everyone else the skill positions.
  const groups = DEPTH_GROUPS.filter((g) => (position === "K" ? g.key === "K" : g.key !== "K")).filter(
    (g) => chart[g.key]?.length,
  );
  return (
    <div className="space-y-3 px-4 py-3 sm:px-5">
      {groups.map((g) => (
        <div key={g.key} className="flex gap-3">
          <span className="w-8 shrink-0 pt-0.5 text-[11px] font-bold text-chalk-600">{g.label}</span>
          <ol className="min-w-0 flex-1 space-y-0.5">
            {chart[g.key].map((pid) => (
              <li key={pid}>
                <button
                  type="button"
                  onClick={() => onOpen(pid)}
                  className={`truncate text-left text-[13px] transition-colors hover:text-accent ${
                    pid === focus ? "font-semibold text-chalk-100" : "text-chalk-400"
                  }`}
                >
                  {nameOf(pid)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 74 -> 6'2". */
function feetInches(height: string | null | undefined): string | null {
  const inches = Number(height);
  if (!inches) return null;
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "-";
  if (n === 0) return digits ? "0" : "-";
  return digits ? n.toFixed(digits) : String(Math.round(n));
}

function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
