"use client";

import { useRef, useState } from "react";

import { Delta, PlayerName } from "@/components/trade-week-sheet";
import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import { normalise } from "@/lib/player-match";
import type { Lineup } from "@/lib/lineup";
import {
  accepts,
  screenTrades,
  withinLimits,
  type AcceptMode,
  type GainKey,
  type GainLimits,
  type Screened,
} from "@/lib/trade-finder";
import { applyTrade, FREE_AGENT_MARGIN, type TeamState } from "@/lib/trade-sim";
import type { LiveTeam } from "@/lib/types";

type Lineups = Map<number, Map<number, Lineup>>;

/**
 * Survivors of the screen that get the exact, week-by-week evaluation.
 *
 * 300, not 150: at 150 a broad mode ("Either") spent its exact checks on
 * high-gain trades that narrowly failed, and found 32 where the narrower
 * "Rest of season" found 104 that "Either" should also have shown. At 300 no
 * mode misses a trade that belongs in another mode's top 20 — checked on
 * Masterbatters. Deeper in a "Show all" list a few still can, since the exact
 * pass is capped; the header says how many were checked.
 */
const EXACT = 300;
/**
 * How far below the line each screening stage still lets a trade through, for
 * both sides — per game for the average stage, total points for the weekly one.
 * See `ScreenInput`.
 */
const SLACK_AVERAGE = 1;
const SLACK_WEEKLY = 2;
const SHOWN = 20;
/** Milliseconds of work per slice before handing the thread back. */
const SLICE = 30;

interface Found extends Screened {
  /** Rest-of-season points, exact: the sender's, then the partner's. */
  senderTotal: number;
  senderPlayoffs: number;
  partnerTotal: number;
  partnerPlayoffs: number;
  /** Which of the partner's tests it passed. */
  via: "both" | "season" | "playoffs";
}

type RunState =
  | { phase: "idle" }
  | { phase: "screen"; done: number; total: number }
  | { phase: "exact"; done: number; total: number }
  | { phase: "done"; found: Found[]; checked: number; key: string };

/**
 * Trade finder — the best trades one team could propose that the other side
 * has a reason to accept.
 *
 * BEST MEANS REST-OF-SEASON POINTS for the team sending it, every remaining
 * week including the playoffs, from the same lineups the analyzer draws.
 *
 * "WOULD ACCEPT" MEANS THE RECEIVING TEAM DOES NOT GET WORSE, by the same model,
 * on EITHER of two readings: its rest-of-season points hold up, or its
 * playoff-weeks points do. The second admits a contender giving up some regular
 * season for a stronger playoff lineup. A tolerance lets it lose a little.
 *
 * Runs on demand, not as filters change: a full search is a second or two, and
 * re-running it on every tick of a checkbox would make the controls feel broken.
 */
export function TradeFinder({
  teams,
  label,
  defaultSender,
  slots,
  positionsOf,
  freeAgents,
  averages,
  playoffAverages,
  projected,
  weeks,
  playoffWeeks,
  lineupsFor,
  streamersFor,
  teamStates,
  streamingOn,
  nameOf,
  positionOf,
  canLink,
  ready,
  onOpen,
}: {
  teams: LiveTeam[];
  label: (t: LiveTeam | null | undefined) => string;
  defaultSender: LiveTeam;
  slots: readonly string[];
  positionsOf: (id: string) => readonly string[];
  freeAgents: readonly string[];
  averages: Record<string, number> | null;
  playoffAverages: Record<string, number> | null;
  /** Every week's projections, overrides applied — for the weekly screen. */
  projected: Record<number, Record<string, number>>;
  weeks: readonly number[];
  playoffWeeks: readonly number[];
  lineupsFor: (rosters: ReadonlyMap<number, readonly string[]>, who: ReadonlySet<number> | null) => Lineups;
  streamersFor: (a: number, b: number) => ReadonlySet<number> | null;
  teamStates: TeamState[];
  /** False under "Rosters only". */
  streamingOn: boolean;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
  ready: boolean;
  onOpen: (sender: string, partner: string, give: string[], get: string[]) => void;
}) {
  const [senderSlug, setSenderSlug] = useState(defaultSender.ownerSlug);
  const [partnerSlug, setPartnerSlug] = useState("");
  const [sell, setSell] = useState<string[]>([]);
  const [buy, setBuy] = useState<string[]>([]);
  const [tolerance, setTolerance] = useState(0);
  const [accept, setAccept] = useState<AcceptMode>("either");
  /**
   * Floors as typed — strings, so a field can be blank (no limit) or mid-edit.
   * Your rest-of-season gain defaults to at least 0, which is what "a trade
   * worth proposing" meant before this was configurable.
   */
  const [mins, setMins] = useState<Record<GainKey, string>>({
    senderSeason: "0",
    senderPlayoffs: "",
    partnerSeason: "",
    partnerPlayoffs: "",
  });
  const [rankBy, setRankBy] = useState<GainKey>("senderSeason");
  const [descending, setDescending] = useState(true);
  const limits: GainLimits = Object.fromEntries(
    (Object.keys(mins) as GainKey[]).map((k) => {
      const n = mins[k].trim() === "" ? null : Number(mins[k]);
      return [k, n != null && Number.isFinite(n) ? n : null];
    }),
  );
  const [giveRange, setGiveRange] = useState({ min: 1, max: 4 });
  const [getRange, setGetRange] = useState({ min: 1, max: 4 });
  const [query, setQuery] = useState("");
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const [showAll, setShowAll] = useState(false);
  const token = useRef(0);

  const sender = teams.find((t) => t.ownerSlug === senderSlug) ?? defaultSender;
  const partner = teams.find((t) => t.ownerSlug === partnerSlug && t.rosterId !== sender.rosterId) ?? null;
  const value = (id: string) => averages?.[id] ?? 0;
  const byValue = (ids: readonly string[]) => [...ids].sort((a, b) => value(b) - value(a));
  const holder = (id: string) => teams.find((t) => t.players.includes(id)) ?? null;

  // Only what still applies: a sell must be on the sender, a buy on the partner.
  const sellNow = sell.filter((id) => sender.players.includes(id));
  const buyNow = buy.filter((id) => {
    const h = holder(id);
    return h && h.rosterId !== sender.rosterId && (!partner || h.rosterId === partner.rosterId);
  });
  const settingsKey = JSON.stringify([
    sender.rosterId,
    partner?.rosterId ?? null,
    sellNow,
    buyNow,
    tolerance,
    accept,
    limits,
    rankBy,
    descending,
    streamingOn,
    weeks,
    giveRange,
    getRange,
  ]);

  const q = normalise(query);
  const buyResults =
    q.length < 2
      ? []
      : teams
          .filter((t) => t.rosterId !== sender.rosterId && (!partner || t.rosterId === partner.rosterId))
          .flatMap((t) => t.players.map((id) => ({ id, team: t })))
          .filter(({ id }) => !buy.includes(id) && normalise(nameOf(id)).includes(q))
          .sort((a, b) => value(b.id) - value(a.id))
          .slice(0, 8);

  const tooMany = sellNow.length > giveRange.max || buyNow.length > getRange.max;
  const buyTeams = new Set(buyNow.map((id) => holder(id)?.rosterId));
  const splitBuys = buyTeams.size > 1;

  const start = () => {
    if (!averages || tooMany || splitBuys) return;
    const mine = ++token.current;
    const partners = teamStates.filter((t) =>
      t.rosterId !== sender.rosterId && (!partner || t.rosterId === partner.rosterId),
    );
    const gen = screenTrades({
      sender: { rosterId: sender.rosterId, players: sender.players },
      partners,
      slots,
      value,
      playoffValue: playoffAverages ? (id) => playoffAverages[id] ?? 0 : null,
      positionsOf,
      freeAgents,
      streams: () => streamingOn,
      freeAgentMargin: FREE_AGENT_MARGIN,
      sell: sellNow,
      buy: buyNow,
      give: giveRange,
      get: getRange,
      poolSize: 8,
      weeks: weeks.map((w) => ({ value: (id: string) => projected[w]?.[id] ?? 0, playoff: playoffWeeks.includes(w) })),
      tolerance,
      accept,
      min: limits,
      rankBy,
      descending,
      slackAverage: SLACK_AVERAGE,
      slackWeekly: SLACK_WEEKLY,
      keep: EXACT,
    });
    const key = settingsKey;
    setShowAll(false);
    setRun({ phase: "screen", done: 0, total: 0 });

    const screen = () => {
      if (token.current !== mine) return;
      const t0 = performance.now();
      let r = gen.next();
      while (!r.done && performance.now() - t0 < SLICE) r = gen.next();
      if (!r.done) {
        setRun({ phase: "screen", ...r.value });
        setTimeout(screen, 0);
        return;
      }
      exact(r.value);
    };

    /**
     * THE EXACT PASS: the same week-by-week lineups the analyzer draws, so a
     * trade's number here is its number once opened there. Baselines are cached
     * per streaming set, since under "Trading teams" each partner changes who
     * streams in the before-picture too.
     */
    const exact = (survivors: Screened[]) => {
      const baselines = new Map<string, Lineups>();
      const baseline = (who: ReadonlySet<number> | null) => {
        const k = who ? [...who].sort().join(",") : "*";
        let b = baselines.get(k);
        if (!b) {
          b = lineupsFor(new Map(teamStates.map((t) => [t.rosterId, t.players])), who);
          baselines.set(k, b);
        }
        return b;
      };
      const sum = (L: Lineups, r: number, ws: readonly number[]) =>
        ws.reduce((s, w) => s + (L.get(w)?.get(r)?.total ?? 0), 0);

      const found: Found[] = [];
      let i = 0;
      const step = () => {
        if (token.current !== mine) return;
        const t0 = performance.now();
        while (i < survivors.length && performance.now() - t0 < SLICE) {
          const c = survivors[i++];
          const who = streamersFor(sender.rosterId, c.partner);
          const before = baseline(who);
          const after = lineupsFor(
            applyTrade(teamStates, { a: sender.rosterId, b: c.partner, fromA: c.give, fromB: c.get }),
            who,
          );
          const senderTotal = sum(after, sender.rosterId, weeks) - sum(before, sender.rosterId, weeks);
          const partnerTotal = sum(after, c.partner, weeks) - sum(before, c.partner, weeks);
          const partnerPlayoffs = sum(after, c.partner, playoffWeeks) - sum(before, c.partner, playoffWeeks);
          const season = partnerTotal >= -tolerance * weeks.length - 1e-9;
          const playoffs = playoffWeeks.length
            ? partnerPlayoffs >= -tolerance * playoffWeeks.length - 1e-9
            : null;
          if (!accepts(accept, season, playoffs)) continue;
          const f: Found = {
            ...c,
            senderTotal,
            senderPlayoffs: sum(after, sender.rosterId, playoffWeeks) - sum(before, sender.rosterId, playoffWeeks),
            partnerTotal,
            partnerPlayoffs,
            via: season && playoffs !== false ? "both" : season ? "season" : "playoffs",
          };
          if (!withinLimits(exactOf(f), limits)) continue;
          found.push(f);
        }
        if (i < survivors.length) {
          setRun({ phase: "exact", done: i, total: survivors.length });
          setTimeout(step, 0);
          return;
        }
        found.sort(rankFound(rankBy, descending));
        setRun({ phase: "done", found, checked: survivors.length, key });
      };
      setRun({ phase: "exact", done: 0, total: survivors.length });
      setTimeout(step, 0);
    };

    setTimeout(screen, 0);
  };

  const running = run.phase === "screen" || run.phase === "exact";
  /**
   * The list as the controls say NOW: re-filtered and re-sorted at once when a
   * floor or the sort changes, without another search. Only the controls the
   * search ran with chose which trades were checked, which is what the stale
   * note says.
   */
  const shown =
    run.phase === "done"
      ? run.found.filter((f) => withinLimits(exactOf(f), limits)).sort(rankFound(rankBy, descending))
      : [];
  const stale = run.phase === "done" && run.key !== settingsKey;

  const chip = (id: string, on: boolean, toggle: () => void, tone: "sell" | "buy") => (
    <button
      key={id}
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
        on
          ? tone === "sell"
            ? "border-loss/60 bg-loss/10 text-chalk-100"
            : "border-trade/60 bg-trade/10 text-chalk-100"
          : "border-ink-500 text-chalk-400 hover:border-ink-400 hover:text-chalk-200"
      }`}
    >
      <span className="mr-1 text-[10px] font-bold text-chalk-600">{positionOf(id) ?? "—"}</span>
      {nameOf(id)}
    </button>
  );

  return (
    <>
      <Panel>
        <PanelHeader
          title="Find trades"
          legend="The trades that add the most rest-of-season points for one team, where the other side's lineup holds up — over the rest of the season, the playoffs, or both, as chosen below."
        />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] text-chalk-500">
              <span className="eyebrow text-[10px]">Sending team</span>
              <select
                value={sender.ownerSlug}
                onChange={(e) => {
                  setSenderSlug(e.target.value);
                  setSell([]);
                }}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-800 px-3 py-2 text-base text-chalk-100 sm:text-sm"
              >
                {teams.map((t) => (
                  <option key={t.rosterId} value={t.ownerSlug}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-chalk-500">
              <span className="eyebrow text-[10px]">Trade partner</span>
              <select
                value={partner?.ownerSlug ?? ""}
                onChange={(e) => setPartnerSlug(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-800 px-3 py-2 text-base text-chalk-100 sm:text-sm"
              >
                <option value="">Any team</option>
                {teams
                  .filter((t) => t.rosterId !== sender.rosterId)
                  .map((t) => (
                    <option key={t.rosterId} value={t.ownerSlug}>
                      {label(t)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div>
            <div className="eyebrow mb-1.5 text-[10px]">Must sell</div>
            <div className="flex flex-wrap gap-1.5">
              {byValue(sender.players).map((id) =>
                chip(id, sell.includes(id), () =>
                  setSell(sell.includes(id) ? sell.filter((x) => x !== id) : [...sell, id]),
                "sell"),
              )}
            </div>
          </div>

          <div>
            <div className="eyebrow mb-1.5 text-[10px]">Must buy</div>
            {buyNow.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {buyNow.map((id) => chip(id, true, () => setBuy(buy.filter((x) => x !== id)), "buy"))}
              </div>
            ) : null}
            {partner ? (
              <div className="flex flex-wrap gap-1.5">
                {byValue(partner.players)
                  .filter((id) => !buyNow.includes(id))
                  .map((id) => chip(id, false, () => setBuy([...buy, id]), "buy"))}
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a player on another team…"
                  aria-label="Find a player to buy"
                  className="w-full rounded-lg border border-ink-500 bg-ink-850 px-3 py-2 text-base text-chalk-100 placeholder:text-chalk-600 sm:text-sm"
                />
                {buyResults.length ? (
                  <ul className="mt-2 divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-600">
                    {buyResults.map(({ id, team }) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => {
                            setBuy([...buy, id]);
                            // A buy can only come from one roster, which makes it the partner.
                            setPartnerSlug(team.ownerSlug);
                            setQuery("");
                          }}
                          className="flex w-full items-baseline gap-2 bg-ink-850 px-3 py-2 text-left text-[13px] text-chalk-300 transition-colors hover:bg-ink-700"
                        >
                          <span className="w-8 shrink-0 text-[10px] font-bold uppercase text-chalk-600">
                            {positionOf(id) ?? "—"}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                          <span className="shrink-0 text-[11px] text-chalk-600" data-owner={team.ownerSlug}>
                            {label(team)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <CountRange label="Players you give" value={giveRange} onChange={setGiveRange} />
            <CountRange label="Players you get" value={getRange} onChange={setGetRange} />
          </div>

          <div>
            <div className="eyebrow mb-1.5 text-[10px]">Only trades where, over the rest of the season…</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GAIN_FIELDS.map((g) => (
                <label key={g.key} className="block text-[11px] text-chalk-500">
                  {g.label} ≥
                  <input
                    type="number"
                    inputMode="decimal"
                    step={1}
                    value={mins[g.key]}
                    placeholder="any"
                    onChange={(e) => setMins({ ...mins, [g.key]: e.target.value })}
                    className="mt-1 w-full min-w-0 appearance-none rounded-md border border-ink-500 bg-ink-850 px-2 py-1 text-base tabular text-chalk-100 placeholder:text-chalk-600 sm:text-sm"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-[10px]">Sort by</span>
            <select
              value={rankBy}
              onChange={(e) => setRankBy(e.target.value as GainKey)}
              aria-label="Sort by"
              className="rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-base text-chalk-100 sm:text-sm"
            >
              {GAIN_FIELDS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDescending((d) => !d)}
              className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-300 transition-colors hover:border-accent-dim hover:text-accent"
            >
              {descending ? "Highest first ↓" : "Lowest first ↑"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow text-[10px]">They accept if their lineup holds up over</span>
            <div role="radiogroup" aria-label="Acceptance test" className="flex flex-wrap rounded-lg border border-ink-500 p-0.5">
              {ACCEPT_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={accept === m.value}
                  title={m.hint}
                  onClick={() => setAccept(m.value)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    accept === m.value ? "bg-ink-600 text-chalk-100" : "text-chalk-500 hover:text-chalk-300"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex items-center gap-2 text-[12px] text-chalk-400">
              Their lineup may drop by up to
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                value={tolerance}
                onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Tolerance, points per week"
                className="w-16 min-w-0 appearance-none rounded-md border border-ink-500 bg-ink-850 px-2 py-1 text-base tabular text-chalk-100 sm:text-sm"
              />
              pts/week
            </label>
            <button
              type="button"
              onClick={start}
              disabled={!ready || !averages || running || tooMany || splitBuys}
              className="rounded-lg border border-accent-dim bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Searching…" : run.phase === "done" ? "Search again" : "Find trades"}
            </button>
          </div>

          {tooMany ? (
            <p className="text-[12px] text-loss">
              More players are required than the {sellNow.length > giveRange.max ? "give" : "get"} limit allows.
            </p>
          ) : null}
          {splitBuys ? (
            <p className="text-[12px] text-loss">Players to buy have to come from the same team.</p>
          ) : null}

          {running ? (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{
                    width: `${run.total ? Math.round(((run.phase === "exact" ? 0.85 : 0) + (run.done / run.total) * (run.phase === "exact" ? 0.15 : 0.85)) * 100) : 2}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-chalk-600">
                {run.phase === "screen"
                  ? `Screening ${run.total ? run.total.toLocaleString() : "every"} combinations…`
                  : `Checking the best ${run.total} week by week…`}
              </p>
            </div>
          ) : null}

          <p className="text-[11px] text-chalk-600">
            Up to four players a side, in any combination within the limits above. Each team&rsquo;s players worth more than a waiver
            replacement are considered, plus anyone you require. Follows the free-agent setting and your
            projection overrides.
          </p>
        </div>
      </Panel>

      {run.phase === "done" ? (
        <Panel>
          <PanelHeader
            title="Best trades"
            meta={`${shown.length} of ${run.checked} checked`}
            legend={
              stale
                ? "Re-filtered and re-sorted with the settings above — search again for a complete list under them."
                : "Rest-of-season points for each side, every remaining week including the playoffs."
            }
          />
          {shown.length ? (
            <ul className="divide-y divide-ink-600">
              {shown.slice(0, showAll ? undefined : SHOWN).map((f, i) => {
                const other = teams.find((t) => t.rosterId === f.partner) ?? null;
                return (
                  <li key={i} className="px-4 py-3 sm:px-5">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="text-sm font-semibold text-chalk-200">
                        with <span data-owner={other?.ownerSlug}>{label(other)}</span>
                      </div>
                      {/* Both sides, both windows. Rest of season is every remaining week,
                          playoffs included — the figure the ranking uses; the playoff column
                          is those weeks on their own. */}
                      <table className="text-[12px] tabular">
                        <thead>
                          <tr className="text-[10px] text-chalk-600">
                            <th className="pr-3 text-left font-normal" />
                            <th className="px-2 text-right font-normal">Rest of season</th>
                            {playoffWeeks.length ? <th className="pl-2 text-right font-normal">Playoffs</th> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { who: "You", total: f.senderTotal, po: f.senderPlayoffs, slug: sender.ownerSlug },
                            { who: "They", total: f.partnerTotal, po: f.partnerPlayoffs, slug: other?.ownerSlug },
                          ].map((r) => (
                            <tr key={r.who}>
                              <td className="pr-3 text-chalk-500" data-owner={r.slug}>
                                {r.who}
                              </td>
                              <td className="px-2 text-right">
                                <Delta n={r.total} />
                                <span className="text-chalk-600"> ({perWeek(r.total, weeks.length)}/wk)</span>
                              </td>
                              {playoffWeeks.length ? (
                                <td className="pl-2 text-right">
                                  <Delta n={r.po} />
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                      <Side title="You give" ids={f.give} nameOf={nameOf} positionOf={positionOf} canLink={canLink} />
                      <Side title="You get" ids={f.get} nameOf={nameOf} positionOf={positionOf} canLink={canLink} />
                      <button
                        type="button"
                        onClick={() => other && onOpen(sender.ownerSlug, other.ownerSlug, f.give, f.get)}
                        className="mt-1 self-start rounded-md border border-ink-500 px-2.5 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent sm:mt-0"
                      >
                        Analyze →
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-chalk-600">
                      {f.via === "both"
                        ? "Their lineup holds up over the rest of the season and the playoffs."
                        : f.via === "season"
                          ? "Their rest-of-season lineup holds up, though their playoff lineup gets worse."
                          : "Their playoff lineup holds up, though their rest-of-season lineup gets worse."}
                    </p>
                  </li>
                );
              })}
              {shown.length > SHOWN ? (
                <li className="px-4 py-2 text-center sm:px-5">
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="text-xs text-chalk-400 transition-colors hover:text-accent"
                  >
                    {showAll ? `Show the top ${SHOWN}` : `Show all ${shown.length}`}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <EmptyState>
              No trade found that helps {label(sender)} without hurting the other side. Try another partner, fewer
              required players, or a little tolerance.
            </EmptyState>
          )}
        </Panel>
      ) : null}
    </>
  );
}

/**
 * A min–max pair of player counts, 1 to 4. Moving one past the other drags the
 * other with it rather than allowing an empty range.
 */
function CountRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { min: number; max: number };
  onChange: (v: { min: number; max: number }) => void;
}) {
  const options = [1, 2, 3, 4];
  const select = (which: "min" | "max") => (
    <select
      value={value[which]}
      aria-label={`${label}, ${which === "min" ? "at least" : "at most"}`}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(
          which === "min" ? { min: n, max: Math.max(n, value.max) } : { min: Math.min(n, value.min), max: n },
        );
      }}
      className="rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-base text-chalk-100 sm:text-sm"
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex items-center gap-2 text-[12px] text-chalk-400">
      <span className="eyebrow text-[10px]">{label}</span>
      {select("min")}
      <span className="text-chalk-600">to</span>
      {select("max")}
    </div>
  );
}

function Side({
  title,
  ids,
  nameOf,
  positionOf,
  canLink,
}: {
  title: string;
  ids: string[];
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
}) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-0.5 text-[10px]">{title}</div>
      <ul className="space-y-0.5">
        {ids.map((id) => (
          <li key={id} className="flex items-baseline gap-1.5 text-chalk-300">
            <span className="w-7 shrink-0 text-[10px] font-bold uppercase text-chalk-600">{positionOf(id) ?? "—"}</span>
            <PlayerName id={id} name={nameOf(id)} canLink={canLink} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The four measures, as the filters, the sort and the results name them. */
const GAIN_FIELDS: Array<{ key: GainKey; label: string }> = [
  { key: "senderSeason", label: "Your rest of season" },
  { key: "senderPlayoffs", label: "Your playoffs" },
  { key: "partnerSeason", label: "Their rest of season" },
  { key: "partnerPlayoffs", label: "Their playoffs" },
];

/** A result's exact figures under the names the shared filter reads. */
const exactOf = (f: Found) => ({
  senderGain: f.senderTotal,
  partnerGain: f.partnerTotal,
  senderPlayoffGain: f.senderPlayoffs,
  partnerPlayoffGain: f.partnerPlayoffs,
});

const exactValue = (f: Found, key: GainKey): number =>
  key === "senderSeason"
    ? f.senderTotal
    : key === "senderPlayoffs"
      ? f.senderPlayoffs
      : key === "partnerSeason"
        ? f.partnerTotal
        : f.partnerPlayoffs;

const rankFound = (key: GainKey, descending: boolean) => (a: Found, b: Found) =>
  (descending ? exactValue(b, key) - exactValue(a, key) : exactValue(a, key) - exactValue(b, key)) ||
  a.give.length + a.get.length - (b.give.length + b.get.length);

const ACCEPT_MODES: Array<{ value: AcceptMode; label: string; hint: string }> = [
  { value: "either", label: "Either", hint: "Rest of season OR playoffs" },
  { value: "both", label: "Both", hint: "Rest of season AND playoffs" },
  { value: "season", label: "Rest of season", hint: "Every remaining week, playoffs included" },
  { value: "playoffs", label: "Playoffs", hint: "The playoff weeks alone" },
];

const perWeek = (total: number, weeks: number) => {
  const v = weeks ? total / weeks : 0;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
};
