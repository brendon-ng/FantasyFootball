"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { Sheet } from "@/components/sheet";
import { playerAge } from "@/lib/adp-format";
import {
  fetchBio,
  fetchDepthChart,
  fetchNews,
  fetchResearch,
  fetchSeasonLine,
  fetchWeeks,
  headshotUrl,
  teamLogoUrl,
  type NewsItem,
  type StatEntry,
} from "@/lib/live/player-card";
import { leagueScoring, scoreLine } from "@/lib/live/sleeper";
import { NFL_TEAMS } from "@/lib/nfl-teams";

/**
 * A read-only copy of Sleeper's player card: who he is, how he has done week by
 * week, every news item ever written about him, and where he sits on his team's
 * depth chart.
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

export function PlayerCardProvider({
  children,
  leagueId,
  season,
  week,
  holderOf,
  nameOf,
  linkable,
}: {
  children: ReactNode;
  leagueId: string | null;
  season: number;
  /** The week the rostered / started percentages are read for. */
  week: number;
  /** Who rosters a player in this league, or null for a free agent. */
  holderOf: (id: string) => { label: string; slug: string } | null;
  /** Names for depth-chart rows, which the card's own feeds do not carry. */
  nameOf: (id: string) => string;
  /** Players with a page on this site. */
  linkable: Set<string>;
}) {
  const [id, setId] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ open: setId }}>
      {children}
      {id ? (
        <PlayerCard
          key={id}
          id={id}
          leagueId={leagueId}
          season={season}
          week={week}
          holderOf={holderOf}
          nameOf={nameOf}
          linkable={linkable}
          onOpen={setId}
          onClose={() => setId(null)}
        />
      ) : null}
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
 * fifty deep buries the depth chart under it — then 50, then 100 at a time.
 */
const NEWS_FIRST = 5;
const nextNewsLimit = (limit: number) => (limit < 50 ? 50 : limit + 100);

function PlayerCard({
  id,
  leagueId,
  season,
  week,
  holderOf,
  nameOf,
  linkable,
  onOpen,
  onClose,
}: {
  id: string;
  leagueId: string | null;
  season: number;
  week: number;
  holderOf: (id: string) => { label: string; slug: string } | null;
  nameOf: (id: string) => string;
  linkable: Set<string>;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const isDefense = /^[A-Z]{2,4}$/.test(id);
  const [tab, setTab] = useState(season);
  // The previous limit is kept so its page, already cached, shows while the next loads.
  const [newsPage, setNewsPage] = useState({ limit: NEWS_FIRST, prev: 0 });
  const newsLimit = newsPage.limit;

  const bio = useFetched(`bio:${id}`, () => fetchBio(id));
  const line = useFetched(`line:${id}:${season}`, () => fetchSeasonLine(id, season));
  const research = useFetched(`research:${season}:${week}`, () => fetchResearch(season, week));
  const stats = useFetched(`stats:${id}:${tab}`, () => fetchWeeks(id, tab, "stats"));
  const proj = useFetched(`proj:${id}:${tab}`, () => fetchWeeks(id, tab, "projections"));
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

  const b = bio.data;
  const name = b ? `${b.first_name} ${b.last_name}` : nameOf(id);
  const position = b?.position ?? (isDefense ? "DEF" : null);
  const colors = team ? NFL_TEAMS[team] : null;
  const holder = holderOf(id);
  const ranks = line.data?.stats;
  const pct = research.data?.[id];

  const rookieYear = Number(b?.metadata?.rookie_year) || (b?.years_exp != null ? season - b.years_exp : season);
  const seasons = Array.from({ length: Math.max(1, season - Math.max(2012, rookieYear) + 1) }, (_, i) => season - i);

  const points = (s: Record<string, number> | undefined) =>
    s ? (scoring.data ? scoreLine(s, scoring.data) : (s.pts_ppr ?? 0)) : null;

  return (
    <Sheet
      label={`${name} player card`}
      onClose={onClose}
      // Above the week sheet it is usually opened from.
      zClassName="z-[60]"
      /**
       * ON A WIDE SCREEN THE CARD DOES NOT SCROLL — the game log, the news and
       * the depth chart each do, so the depth chart is never a long way down the
       * feed. A phone stacks the three, where fixed-height boxes would be
       * cramped, so there the card scrolls as one.
       */
      panelClassName="max-h-[92dvh] max-w-[72rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl lg:flex lg:h-[92dvh] lg:flex-col lg:overflow-hidden"
    >
      {({ close }) => (
        <>
          {/* Header band — the team's colour fading into the page. */}
          <div
            className="relative shrink-0 overflow-hidden"
            style={{
              background: `linear-gradient(120deg, ${colors?.color ?? "#2a2a33"} 0%, ${colors?.color ?? "#2a2a33"}cc 40%, #0e0e11 100%)`,
            }}
          >
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
              onClick={() => close()}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 rounded-md border border-white/30 bg-black/20 px-2 py-1 text-xs text-white/90 transition-colors hover:bg-black/40"
            >
              Close
            </button>
            <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:gap-6 sm:p-6">
              <div className="relative shrink-0 self-center sm:self-end">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headshotUrl(id)}
                  alt={name}
                  className="h-36 w-auto object-contain drop-shadow-xl sm:h-44"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
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
                  {holder ? (
                    <>
                      Rostered by <span data-owner={holder.slug}>{holder.label}</span>
                    </>
                  ) : (
                    "Free agent in this league"
                  )}
                </div>
                <h2 className="mt-0.5 text-2xl font-extrabold tracking-tight sm:text-4xl">{name}</h2>
                {b?.injury_status ? (
                  <div className="mt-1 inline-block rounded bg-black/40 px-2 py-0.5 text-[11px] font-semibold text-caution">
                    {b.injury_status}
                    {b.injury_body_part ? ` · ${b.injury_body_part}` : ""}
                  </div>
                ) : null}
                {!isDefense ? (
                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    <Bio label="Age" value={playerAge(b?.birth_date) ?? b?.age ?? null} />
                    <Bio label="Height" value={feetInches(b?.height)} />
                    <Bio label="Weight" value={b?.weight ? `${b.weight} lbs` : null} />
                    <Bio label="Exp" value={b?.years_exp ?? null} />
                    <Bio label="College" value={b?.college ?? null} />
                  </dl>
                ) : null}
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                    {season} rankings
                  </div>
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

          <div className="grid bg-ink-850 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
            {/* Game logs */}
            <section className="flex min-w-0 flex-col bg-ink-850 lg:min-h-0">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-4 py-3 sm:px-5">
                <h3 className="eyebrow">Game logs</h3>
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
              </div>
              <GameLog
                position={position}
                stats={stats.data}
                proj={proj.data}
                loading={!stats.ready || !proj.ready}
                points={points}
                currentWeek={tab === season ? week : null}
                maxWeek={tab >= 2021 ? 18 : 17}
              />
              {linkable.has(id) ? (
                <div className="shrink-0 border-t border-ink-600 px-4 py-2 text-right text-xs sm:px-5">
                  <Link href={`/players/${id}/`} className="text-chalk-400 transition-colors hover:text-accent">
                    His history in this league →
                  </Link>
                </div>
              ) : null}
            </section>

            {/* News and depth chart */}
            <aside className="flex min-w-0 flex-col border-t border-ink-600 bg-ink-850 lg:min-h-0 lg:border-l lg:border-t-0">
              <section className="flex flex-col lg:min-h-0 lg:flex-[3]">
                <h3 className="eyebrow shrink-0 border-b border-ink-600 px-4 py-3 sm:px-5">News</h3>
                {!shownNews ? (
                  <div className="space-y-2 p-4 sm:p-5">
                    {Array.from({ length: 3 }, (_, i) => (
                      <div key={i} className="skeleton h-20 w-full rounded" />
                    ))}
                  </div>
                ) : shownNews.length ? (
                  <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <ol className="divide-y divide-ink-600">
                      {shownNews.map((n) => (
                        <NewsRow key={`${n.source}:${n.source_key}`} item={n} />
                      ))}
                    </ol>
                    {shownNews.length >= newsLimit ? (
                      <div className="border-t border-ink-600 px-4 py-2 text-center sm:px-5">
                        <button
                          type="button"
                          disabled={!news.ready}
                          onClick={() => setNewsPage((p) => ({ limit: nextNewsLimit(p.limit), prev: p.limit }))}
                          className="text-xs text-chalk-400 transition-colors hover:text-accent disabled:opacity-50"
                        >
                          {news.ready ? "Show more" : "Loading…"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-center text-sm text-chalk-600 sm:px-5">No news.</p>
                )}
              </section>

              {depth.data && team ? (
                <section className="flex flex-col border-t border-ink-600 lg:min-h-0 lg:flex-[2]">
                  <h3 className="eyebrow shrink-0 border-b border-ink-600 px-4 py-3 sm:px-5">Depth chart</h3>
                  <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <DepthChart chart={depth.data} focus={id} position={position} nameOf={nameOf} onOpen={onOpen} />
                  </div>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </Sheet>
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
