"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { useIdentity } from "@/components/identity";
import { Delta, PlayerName, TradeWeekSheet, type WeekDetail } from "@/components/trade-week-sheet";
import { Col, EmptyState, ListHeader, Panel, PanelHeader, Skeleton, Stat, fmt } from "@/components/ui";
import { positionRank } from "@/lib/espn-maps";
import type { LeagueRef } from "@/lib/league-ref";
import { lineupPositions, startingSlots, type Lineup } from "@/lib/lineup";
import {
  useLiveProjections,
  useLiveSeason,
  usePlayerPool,
  useSeasonGames,
  useWeekProjections,
} from "@/lib/live";
import {
  applyTrade,
  claimOrder,
  pregameSd,
  simulate,
  weekLineups,
  winChance,
  type Odds,
  type ScoreDist,
  type TeamState,
} from "@/lib/trade-sim";
import type { LiveSeason, LiveTeam } from "@/lib/types";
import { distribution } from "@/lib/win-probability";

export interface OwnerLabel {
  name: string;
  first: string;
}

export interface BakedPlayer {
  name: string;
  position: string | null;
  team: string | null;
}

/** Simulated seasons per scenario. ~100ms for both on a laptop; the noise on a single percentage is about ±0.3. */
const SIMS = 20000;
/** Fixed, so the same trade reads the same on every reload. */
const SEED = 20261019;

type Lineups = Map<number, Map<number, Lineup>>;

export function TradeAnalyzer({
  refBySeason,
  initial,
  userIdToSlug,
  owners,
  format,
  rosterPositions,
  baked,
  linkable,
}: {
  refBySeason: Record<string, LeagueRef>;
  initial: LiveSeason;
  userIdToSlug: Record<string, string>;
  owners: Record<string, OwnerLabel>;
  format: {
    regularSeasonWeeks: number;
    playoffWeekStart: number;
    finalWeek: number;
    playoffTeams: number;
    playoffRounds: number;
  };
  rosterPositions: string[];
  baked: Record<string, BakedPlayer>;
  linkable: string[];
}) {
  const live = useLiveSeason(refBySeason, initial, userIdToSlug);
  const season = live ?? initial;
  const ref = refBySeason[String(season.season)] ?? null;
  const teams = season.teams;
  const canLink = useMemo(() => new Set(linkable), [linkable]);

  // ---------------------------------------------------------------- the trade
  const { identity } = useIdentity();
  const mySlug = identity.kind === "owner" ? identity.slug : null;
  const [aParam, setA] = useUrlText("a");
  const [bParam, setB] = useUrlText("b");
  const [give, setGive] = useUrlList("give");

  const creditOf = (t: LiveTeam) => (t.ownerSlugs.length ? t.ownerSlugs : [t.ownerSlug]);
  const teamA =
    teams.find((t) => t.ownerSlug === aParam) ??
    teams.find((t) => (mySlug ? creditOf(t).includes(mySlug) : false)) ??
    teams[0];
  const teamB = teams.find((t) => t.ownerSlug === bParam && t.rosterId !== teamA?.rosterId) ?? null;

  // Only ids still on one of the two rosters count — a stale link, or a side
  // that was switched, must not drag a third team's player into the deal.
  const fromA = give.filter((id) => teamA?.players.includes(id));
  const fromB = teamB ? give.filter((id) => teamB.players.includes(id)) : [];
  const hasTrade = Boolean(teamA && teamB && (fromA.length || fromB.length));

  const toggle = (id: string) =>
    setGive(give.includes(id) ? give.filter((x) => x !== id) : [...fromA, ...fromB, id]);

  // ---------------------------------------------------------------- the clock
  const scored = season.lastScoredLeg ?? 0;
  /**
   * A week with points on the board is LOCKED to the trade: its lineups are set
   * and half played. It still counts towards the playoff odds, with each team's
   * live distribution — but it is the same in both scenarios, and the trade's
   * effects start the week after.
   */
  const underway =
    season.week > scored && season.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
  const liveWeek = underway ? season.week : null;
  const firstOpen = Math.max(scored + 1, liveWeek ? liveWeek + 1 : 1);
  const openWeeks = useMemo(() => range(firstOpen, format.finalWeek), [firstOpen, format.finalWeek]);
  const projWeeks = useMemo(
    () => (liveWeek ? [liveWeek, ...openWeeks] : openWeeks),
    [liveWeek, openWeeks],
  );

  // ----------------------------------------------------------------- the data
  const games = useSeasonGames(ref, format.regularSeasonWeeks);
  const proj = useWeekProjections(ref, projWeeks);
  const pool = usePlayerPool(ref, Math.min(firstOpen, format.finalWeek));
  const liveTotals = useLiveProjections(live, ref);
  const gamesReady = Object.keys(games).length > 0;
  const ready = proj.ready && pool.ready;

  const nameOf = useCallback(
    (id: string) => pool.pool?.[id]?.name ?? baked[id]?.name ?? id,
    [pool.pool, baked],
  );
  const positionOf = useCallback(
    (id: string) => pool.pool?.[id]?.position ?? baked[id]?.position ?? null,
    [pool.pool, baked],
  );
  const nflTeamOf = useCallback(
    (id: string) => pool.pool?.[id]?.team ?? baked[id]?.team ?? null,
    [pool.pool, baked],
  );
  const positionsOf = useCallback(
    (id: string) => lineupPositions(positionOf(id), pool.pool?.[id]?.fantasyPositions),
    [positionOf, pool.pool],
  );

  const teamStates: TeamState[] = useMemo(
    () =>
      teams.map((t) => ({
        rosterId: t.rosterId,
        players: t.players,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
      })),
    [teams],
  );
  const slots = useMemo(() => startingSlots(rosterPositions), [rosterPositions]);
  const order = useMemo(() => claimOrder(teamStates), [teamStates]);
  const freeAgents = useMemo(() => {
    if (!pool.pool) return [];
    const rostered = new Set(teams.flatMap((t) => t.players));
    return Object.keys(pool.pool).filter((id) => !rostered.has(id));
  }, [pool.pool, teams]);

  const lineupsFor = useCallback(
    (rosters: ReadonlyMap<number, readonly string[]>): Lineups => {
      const out: Lineups = new Map();
      for (const w of projWeeks) {
        const points = proj.byWeek[w];
        if (!points) continue;
        out.set(w, weekLineups({ week: w, points }, rosters, order, slots, positionsOf, freeAgents));
      }
      return out;
    },
    [projWeeks, proj.byWeek, order, slots, positionsOf, freeAgents],
  );

  const before = useMemo(
    () => (ready ? lineupsFor(new Map(teamStates.map((t) => [t.rosterId, t.players]))) : null),
    [ready, lineupsFor, teamStates],
  );
  const tradeKey = `${teamA?.rosterId}:${teamB?.rosterId}:${fromA.join(",")}:${fromB.join(",")}`;
  const after = useMemo(() => {
    if (!ready || !before) return null;
    if (!hasTrade || !teamA || !teamB) return before;
    return lineupsFor(applyTrade(teamStates, { a: teamA.rosterId, b: teamB.rosterId, fromA, fromB }));
    // `tradeKey` stands in for the four trade inputs, which are fresh arrays each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, before, lineupsFor, teamStates, tradeKey, hasTrade]);

  // Regular-season fixtures, roster id pairs by week.
  const fixtures = useMemo(() => {
    const out = new Map<number, Array<readonly [number, number]>>();
    for (const [w, list] of Object.entries(games)) {
      out.set(
        Number(w),
        list
          .filter((g) => g.sides.length === 2)
          .map((g) => [g.sides[0].rosterId, g.sides[1].rosterId] as const),
      );
    }
    return out;
  }, [games]);
  const opponentOf = (week: number, rosterId: number): number | null => {
    for (const [x, y] of fixtures.get(week) ?? []) {
      if (x === rosterId) return y;
      if (y === rosterId) return x;
    }
    return null;
  };

  // ------------------------------------------------------------- the seasons
  const regularLeft = firstOpen <= format.regularSeasonWeeks || (liveWeek ?? 99) <= format.regularSeasonWeeks;
  const odds = useMemo((): Array<Map<number, Odds>> | null => {
    if (!before || !after || !gamesReady || !regularLeft) return null;
    const totals = (L: Lineups) =>
      new Map([...L].map(([w, m]) => [w, new Map([...m].map(([r, l]) => [r, l.total]))]));
    const means = hasTrade ? [totals(before), totals(after)] : [totals(before)];

    const slugToRoster = new Map(teams.map((t) => [t.ownerSlug, t.rosterId]));
    const regular: Array<{
      week: number;
      games: Array<readonly [number, number]>;
      fixed?: Map<number, ScoreDist>;
    }> = [];
    if (liveWeek && liveWeek <= format.regularSeasonWeeks) {
      const fixed = new Map<number, ScoreDist>();
      const pairs: Array<readonly [number, number]> = [];
      for (const m of season.matchups) {
        const ra = slugToRoster.get(m.a.ownerSlug);
        const rb = slugToRoster.get(m.b.ownerSlug);
        if (ra == null || rb == null) continue;
        pairs.push([ra, rb]);
        for (const [side, r] of [[m.a, ra], [m.b, rb]] as const) {
          const projected = liveTotals?.[side.ownerSlug]?.projected;
          if (projected != null) {
            const d = distribution(side.points, projected);
            fixed.set(r, { mean: d.mean, sd: Math.sqrt(d.variance) });
          } else {
            // No live projection: fall back to the pregame optimum, still the
            // same in both scenarios.
            const mean = before.get(liveWeek)?.get(r)?.total ?? 0;
            fixed.set(r, { mean, sd: pregameSd(mean) });
          }
        }
      }
      regular.push({ week: liveWeek, games: pairs, fixed });
    }
    for (const w of openWeeks) {
      if (w > format.regularSeasonWeeks) break;
      regular.push({ week: w, games: fixtures.get(w) ?? [] });
    }
    return simulate({
      teams: teamStates,
      regular,
      playoffWeeks: range(format.playoffWeekStart, format.finalWeek),
      means,
      playoffTeams: format.playoffTeams,
      playoffRounds: format.playoffRounds,
      sims: SIMS,
      seed: SEED,
    });
  }, [before, after, gamesReady, fixtures, liveTotals, liveWeek, openWeeks, hasTrade, teamStates, season.matchups, teams, format, regularLeft]);

  const byes = Math.max(0, 2 ** format.playoffRounds - format.playoffTeams);

  // ------------------------------------------------------------ week detail
  const [detail, setDetail] = useState<{ rosterId: number; week: number } | null>(null);

  const rowsFor = (team: LiveTeam) =>
    openWeeks.map((w) => {
      const b = before?.get(w)?.get(team.rosterId);
      const a = after?.get(w)?.get(team.rosterId);
      const playoff = w > format.regularSeasonWeeks;
      const opp = playoff ? null : opponentOf(w, team.rosterId);
      const ob = opp != null ? before?.get(w)?.get(opp) : undefined;
      const oa = opp != null ? after?.get(w)?.get(opp) : undefined;
      return {
        week: w,
        playoff,
        opp: opp != null ? teams.find((t) => t.rosterId === opp) ?? null : null,
        before: b?.total ?? null,
        after: a?.total ?? null,
        oppBefore: ob?.total ?? null,
        oppAfter: oa?.total ?? null,
      };
    });

  const label = (t: LiveTeam | null | undefined) => (t ? teamLabel(t, owners) : "—");
  const sides = teamA && teamB ? [teamA, teamB] : [];

  const detailData: WeekDetail | null = (() => {
    if (!detail) return null;
    const team = teams.find((t) => t.rosterId === detail.rosterId);
    const b = before?.get(detail.week)?.get(detail.rosterId);
    const a = after?.get(detail.week)?.get(detail.rosterId);
    if (!team || !b || !a) return null;
    const playoff = detail.week > format.regularSeasonWeeks;
    const opp = playoff ? null : opponentOf(detail.week, detail.rosterId);
    return {
      week: detail.week,
      playoff,
      team,
      opponent: opp != null ? teams.find((t) => t.rosterId === opp) ?? null : null,
      before: b,
      after: a,
      oppBefore: opp != null ? before?.get(detail.week)?.get(opp)?.total ?? null : null,
      oppAfter: opp != null ? after?.get(detail.week)?.get(opp)?.total ?? null : null,
      incoming: new Set(team.rosterId === teamA?.rosterId ? fromB : fromA),
    };
  })();

  // ------------------------------------------------------------------ render
  if (!teamA) {
    return (
      <Panel>
        <EmptyState>Trades open once the league has teams on it.</EmptyState>
      </Panel>
    );
  }
  if (firstOpen > format.finalWeek) {
    return (
      <Panel>
        <EmptyState>The season is over — there are no weeks left for a trade to change.</EmptyState>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelHeader
          title="The trade"
          meta={hasTrade ? `${fromA.length} for ${fromB.length}` : undefined}
          legend="Tick the players each side gives up. Average is each player's projection per remaining week."
        />
        <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
          {[
            { team: teamA, set: setA, other: teamB, picked: fromA, which: "a" as const },
            { team: teamB, set: setB, other: teamA, picked: fromB, which: "b" as const },
          ].map(({ team, set, other, picked, which }) => (
            <div key={which} className="min-w-0 bg-ink-850 p-3 sm:p-4">
              <select
                value={team?.ownerSlug ?? ""}
                onChange={(e) => set(e.target.value)}
                aria-label={which === "a" ? "First team" : "Second team"}
                className="mb-3 w-full rounded-lg border border-ink-500 bg-ink-800 px-3 py-2 text-base text-chalk-100 sm:text-sm"
              >
                {which === "b" && !team ? <option value="">Pick a trade partner…</option> : null}
                {teams
                  .filter((t) => t.rosterId !== other?.rosterId)
                  .map((t) => (
                    <option key={t.rosterId} value={t.ownerSlug}>
                      {label(t)}
                    </option>
                  ))}
              </select>
              {team ? (
                <RosterPicker
                  team={team}
                  picked={picked}
                  onToggle={toggle}
                  nameOf={nameOf}
                  positionOf={positionOf}
                  nflTeamOf={nflTeamOf}
                  average={(id) => averageOf(id, openWeeks, proj.byWeek)}
                  loading={!ready}
                />
              ) : (
                <EmptyState>Pick a team to trade with.</EmptyState>
              )}
            </div>
          ))}
        </div>
        {give.length ? (
          <div className="flex justify-end border-t border-ink-600 px-4 py-2 sm:px-5">
            <button
              type="button"
              onClick={() => setGive([])}
              className="rounded-md border border-ink-500 px-2.5 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Clear the trade
            </button>
          </div>
        ) : null}
      </Panel>

      {!hasTrade ? (
        <Panel>
          <EmptyState>
            {teamB
              ? "Tick at least one player to see what the trade does."
              : "Pick a trade partner, then tick the players each side gives up."}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            {sides.map((team) => {
              const rows = rowsFor(team);
              const sum = (list: typeof rows) =>
                list.reduce((s, r) => s + ((r.after ?? 0) - (r.before ?? 0)), 0);
              const reg = sum(rows.filter((r) => !r.playoff));
              const post = sum(rows.filter((r) => r.playoff));
              const b = odds?.[0]?.get(team.rosterId);
              const a = odds?.[1]?.get(team.rosterId);
              const gets = team.rosterId === teamA.rosterId ? fromB : fromA;
              const sends = team.rosterId === teamA.rosterId ? fromA : fromB;
              return (
                <Panel key={team.rosterId}>
                  <PanelHeader title={label(team)} meta={fmt.record(team.wins, team.losses, team.ties)} />
                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="grid grid-cols-2 gap-3 text-[13px]">
                      <TradeSide title="Gets" ids={gets} nameOf={nameOf} positionOf={positionOf} canLink={canLink} />
                      <TradeSide title="Gives" ids={sends} nameOf={nameOf} positionOf={positionOf} canLink={canLink} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      {ready ? (
                        <>
                          <Stat label="Regular season" value={<Delta n={reg} />} sub="projected pts" />
                          <Stat label="Playoffs" value={<Delta n={post} />} sub={`wks ${format.playoffWeekStart}–${format.finalWeek}`} />
                          <Stat label="Combined" value={<Delta n={reg + post} />} sub="projected pts" />
                        </>
                      ) : (
                        Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[74px] w-full rounded-lg" />)
                      )}
                    </div>
                    <OddsTable before={b} after={a} loading={!odds && regularLeft} available={regularLeft} />
                  </div>
                </Panel>
              );
            })}
          </div>

          {sides.map((team) => (
            <WeekTable
              key={team.rosterId}
              team={team}
              label={label}
              rows={rowsFor(team)}
              loading={!ready}
              onOpen={(week) => setDetail({ rosterId: team.rosterId, week })}
              regularSeasonWeeks={format.regularSeasonWeeks}
            />
          ))}
        </>
      )}

      <LeagueOdds
        teams={teams}
        label={label}
        odds={odds}
        hasTrade={hasTrade}
        involved={new Set(hasTrade ? [teamA.rosterId, teamB!.rosterId] : [])}
        available={regularLeft}
      />

      <p className="max-w-3xl text-[11px] leading-relaxed text-chalk-600">
        Every lineup is the best one each team could field that week from its roster and the free
        agent pool, using Sleeper&rsquo;s weekly projections scored with this league&rsquo;s
        settings — never the lineup a team actually set. Free agents are claimed worst team first,
        one team each per week, assuming a bench spot can always be cleared. Win chances treat a
        week&rsquo;s score as a normal curve around its projection, spread the way Sleeper&rsquo;s own
        win probability is; the playoff odds play out the rest of the season{" "}
        {SIMS.toLocaleString()} times on the same draws before and after the trade, so the
        difference is the trade and not luck. Seeding is record then points for,{" "}
        {byes > 0 ? `the top ${byes} take first-round byes, ` : ""}and a tied playoff game goes to the
        higher seed.
        {liveWeek
          ? ` Week ${liveWeek} is already under way, so it counts at its live odds and the trade starts from week ${firstOpen}.`
          : null}
        {ready && !pool.pool
          ? " Sleeper's player list could not be reached, so free agents are left out this time."
          : null}
      </p>

      {detailData ? (
        <TradeWeekSheet
          detail={detailData}
          label={label}
          nameOf={nameOf}
          positionOf={positionOf}
          canLink={canLink}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Full name when someone plays alone, first names when the team is shared. */
export function teamLabel(t: LiveTeam, owners: Record<string, OwnerLabel>): string {
  const slugs = t.ownerSlugs.length ? t.ownerSlugs : [t.ownerSlug];
  if (slugs.length === 1) return owners[slugs[0]]?.name ?? t.teamName ?? slugs[0];
  return slugs.map((s) => owners[s]?.first ?? s).join(" & ");
}

function RosterPicker({
  team,
  picked,
  onToggle,
  nameOf,
  positionOf,
  nflTeamOf,
  average,
  loading,
}: {
  team: LiveTeam;
  picked: string[];
  onToggle: (id: string) => void;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  nflTeamOf: (id: string) => string | null;
  average: (id: string) => number | null;
  loading: boolean;
}) {
  const sorted = [...team.players].sort(
    (x, y) =>
      positionRank(positionOf(x)) - positionRank(positionOf(y)) ||
      (average(y) ?? 0) - (average(x) ?? 0) ||
      nameOf(x).localeCompare(nameOf(y)),
  );
  return (
    <ul className="space-y-px">
      {sorted.map((id) => {
        const on = picked.includes(id);
        const avg = average(id);
        return (
          <li key={id}>
            <label
              className={`flex cursor-pointer items-baseline gap-2 rounded px-1.5 py-1 text-[13px] transition-colors ${
                on ? "bg-trade/15 text-chalk-100" : "text-chalk-400 hover:bg-ink-700"
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(id)}
                className="translate-y-0.5 accent-[var(--color-trade)]"
              />
              <span className="w-8 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
                {positionOf(id) ?? "—"}
              </span>
              <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
              <span className="w-8 shrink-0 text-[10px] text-chalk-600">{nflTeamOf(id) ?? ""}</span>
              <span className="w-10 shrink-0 text-right tabular text-[12px] text-chalk-500">
                {loading ? <Skeleton className="ml-auto h-3 w-7" /> : avg != null ? avg.toFixed(1) : "—"}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function TradeSide({
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
      <div className="eyebrow mb-1 text-[10px]">{title}</div>
      {ids.length ? (
        <ul className="space-y-0.5">
          {ids.map((id) => (
            <li key={id} className="flex items-baseline gap-1.5 text-chalk-300">
              <span className="w-7 shrink-0 text-[10px] font-bold uppercase text-chalk-600">{positionOf(id) ?? "—"}</span>
              <PlayerName id={id} name={nameOf(id)} canLink={canLink} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-chalk-600">Nobody</div>
      )}
    </div>
  );
}

/** A probability before and after, with the swing in percentage points. */
function Swing({ before, after, compact = false }: { before?: number; after?: number; compact?: boolean }) {
  if (before == null) return <span className="text-chalk-600">—</span>;
  const pp = after != null ? (after - before) * 100 : 0;
  return (
    <span className="tabular whitespace-nowrap">
      <span className="text-chalk-500">{pct(before)}</span>
      {after != null ? (
        <>
          <span className="px-1 text-chalk-600">→</span>
          <span className="text-chalk-100">{pct(after)}</span>
          {compact ? null : (
            <span className="ml-1.5 text-[11px]">
              (<Delta n={pp} />)
            </span>
          )}
        </>
      ) : null}
    </span>
  );
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

function OddsTable({
  before,
  after,
  loading,
  available,
}: {
  before?: Odds;
  after?: Odds;
  loading: boolean;
  available: boolean;
}) {
  if (!available) {
    return <p className="text-[12px] text-chalk-600">The regular season is over, so the odds are not modelled.</p>;
  }
  const rows: Array<{ label: string; hint: string; b?: number; a?: number }> = [
    { label: "Make the playoffs", hint: "Top seeds after the regular season", b: before?.playoffs, a: after?.playoffs },
    {
      label: "Win it, if they get in",
      hint: "Championship odds among the seasons they make the playoffs",
      b: before && before.playoffs > 0 ? before.champion / before.playoffs : undefined,
      a: after && after.playoffs > 0 ? after.champion / after.playoffs : undefined,
    },
    { label: "Win the championship", hint: "Straight up, from today", b: before?.champion, a: after?.champion },
  ];
  return (
    <div className="divide-y divide-ink-600 rounded-lg border border-ink-600">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
          <span className="text-chalk-400" title={r.hint}>
            {r.label}
          </span>
          {loading ? <Skeleton className="h-4 w-36" /> : <Swing before={r.b} after={r.a} />}
        </div>
      ))}
    </div>
  );
}

const WEEK_COL = {
  week: "w-9 shrink-0",
  opp: "min-w-0 flex-1",
  proj: "w-[7.5rem] shrink-0 text-right",
  delta: "w-12 shrink-0 text-right",
  win: "w-[6.5rem] shrink-0 text-right",
  margin: "hidden w-[7.5rem] shrink-0 text-right sm:block",
};

function WeekTable({
  team,
  label,
  rows,
  loading,
  onOpen,
  regularSeasonWeeks,
}: {
  team: LiveTeam;
  label: (t: LiveTeam | null | undefined) => string;
  rows: Array<{
    week: number;
    playoff: boolean;
    opp: LiveTeam | null;
    before: number | null;
    after: number | null;
    oppBefore: number | null;
    oppAfter: number | null;
  }>;
  loading: boolean;
  onOpen: (week: number) => void;
  regularSeasonWeeks: number;
}) {
  return (
    <Panel>
      <PanelHeader
        title={`${label(team)} · week by week`}
        legend="Best possible lineup before → after the trade. Tap a week to see the lineups."
      />
      <div className="overflow-x-auto">
        <div className="max-sm:min-w-max">
          <ListHeader className="gap-2 px-4 sm:px-5">
            <Col className={WEEK_COL.week}>Wk</Col>
            <Col className={WEEK_COL.opp}>Opponent</Col>
            <Col className={WEEK_COL.proj} hint="Projected total of the best lineup, before → after">
              Projected
            </Col>
            <Col className={WEEK_COL.delta}>Δ</Col>
            <Col className={WEEK_COL.win} hint="Chance of beating this week's opponent, before → after">
              Win %
            </Col>
            <Col className={WEEK_COL.margin} hint="Projected margin over the opponent's best lineup">
              Margin
            </Col>
          </ListHeader>
          <ul className="divide-y divide-ink-700">
            {rows.map((r) => {
              const firstPlayoff = r.playoff && r.week === regularSeasonWeeks + 1;
              const wb = r.before != null && r.oppBefore != null ? winChance(r.before, r.oppBefore) : undefined;
              const wa = r.after != null && r.oppAfter != null ? winChance(r.after, r.oppAfter) : undefined;
              return (
                <li key={r.week} className={firstPlayoff ? "border-t border-ink-500" : ""}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.week)}
                    disabled={loading || r.before == null}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors hover:bg-ink-700 disabled:cursor-default disabled:hover:bg-transparent sm:px-5"
                  >
                    <span className={`${WEEK_COL.week} tabular text-chalk-500`}>{r.week}</span>
                    <span className={`${WEEK_COL.opp} truncate text-chalk-300`}>
                      {r.playoff ? (
                        <span className="text-chalk-500">Playoffs</span>
                      ) : r.opp ? (
                        <span data-owner={r.opp.ownerSlug}>{label(r.opp)}</span>
                      ) : (
                        "—"
                      )}
                    </span>
                    {loading ? (
                      <Skeleton className="h-4 w-48" />
                    ) : (
                      <>
                        <span className={`${WEEK_COL.proj} tabular`}>
                          <span className="text-chalk-500">{r.before?.toFixed(1) ?? "—"}</span>
                          <span className="px-1 text-chalk-600">→</span>
                          <span className="text-chalk-100">{r.after?.toFixed(1) ?? "—"}</span>
                        </span>
                        <span className={`${WEEK_COL.delta} tabular`}>
                          {r.before != null && r.after != null ? <Delta n={r.after - r.before} /> : "—"}
                        </span>
                        <span className={`${WEEK_COL.win} tabular`}>
                          {wb != null ? <Swing before={wb} after={wa} compact /> : <span className="text-chalk-600">—</span>}
                        </span>
                        <span className={`${WEEK_COL.margin} tabular`}>
                          {r.before != null && r.oppBefore != null && r.after != null && r.oppAfter != null ? (
                            <>
                              <span className="text-chalk-500">{signed(r.before - r.oppBefore)}</span>
                              <span className="px-1 text-chalk-600">→</span>
                              <span className="text-chalk-100">{signed(r.after - r.oppAfter)}</span>
                            </>
                          ) : (
                            <span className="text-chalk-600">—</span>
                          )}
                        </span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function LeagueOdds({
  teams,
  label,
  odds,
  hasTrade,
  involved,
  available,
}: {
  teams: LiveTeam[];
  label: (t: LiveTeam | null | undefined) => string;
  odds: Array<Map<number, Odds>> | null;
  hasTrade: boolean;
  involved: Set<number>;
  available: boolean;
}) {
  if (!available) return null;
  const ordered = [...teams].sort(
    (x, y) =>
      (odds?.[0]?.get(y.rosterId)?.playoffs ?? 0) - (odds?.[0]?.get(x.rosterId)?.playoffs ?? 0) ||
      y.wins - x.wins ||
      y.pointsFor - x.pointsFor,
  );
  return (
    <Panel>
      <PanelHeader
        title="Whole league"
        legend={
          hasTrade
            ? "Everyone's odds move a little — a stronger rival is a harder schedule. Before → after."
            : "Where everyone stands today, before any trade."
        }
      />
      <div className="overflow-x-auto">
        <div className="max-sm:min-w-max">
          <ListHeader className="gap-2 px-4 sm:px-5">
            <Col className="min-w-0 flex-1">Team</Col>
            <Col className="w-12 shrink-0 text-right">Rec</Col>
            <Col className="w-[9.5rem] shrink-0 text-right">Playoffs</Col>
            <Col className="w-[9.5rem] shrink-0 text-right">Title</Col>
          </ListHeader>
          <ul className="divide-y divide-ink-700">
            {ordered.map((t) => {
              const b = odds?.[0]?.get(t.rosterId);
              const a = hasTrade ? odds?.[1]?.get(t.rosterId) : undefined;
              return (
                <li
                  key={t.rosterId}
                  className={`flex items-center gap-2 px-4 py-2 text-[13px] sm:px-5 ${involved.has(t.rosterId) ? "bg-trade/5" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-chalk-300" data-owner={t.ownerSlug}>
                    {label(t)}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular text-chalk-500">
                    {fmt.record(t.wins, t.losses, t.ties)}
                  </span>
                  <span className="w-[9.5rem] shrink-0 text-right">
                    {odds ? <Swing before={b?.playoffs} after={a?.playoffs} compact /> : <Skeleton className="ml-auto h-4 w-20" />}
                  </span>
                  <span className="w-[9.5rem] shrink-0 text-right">
                    {odds ? <Swing before={b?.champion} after={a?.champion} compact /> : <Skeleton className="ml-auto h-4 w-20" />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const range = (from: number, to: number): number[] =>
  from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

/** Projection per remaining week, byes counted as the zero they are. */
function averageOf(
  id: string,
  weeks: readonly number[],
  byWeek: Record<number, Record<string, number>>,
): number | null {
  const known = weeks.filter((w) => byWeek[w]);
  if (!known.length) return null;
  return known.reduce((s, w) => s + (byWeek[w][id] ?? 0), 0) / known.length;
}

/**
 * Free-form query-string state.
 *
 * `useUrlState` in lib/url-state takes an allow-list, which suits a toggle and
 * cannot hold a player id. The trade has to live in the URL all the same — it is
 * exactly the thing worth sending somebody — so this is the same idea without
 * the list: `replaceState`, the existing history state passed through, the param
 * removed when empty, and a trailing slash stripped off the last value.
 */
function useUrlText(key: string): [string, (next: string) => void] {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const value = new URLSearchParams(search).get(key)?.replace(/\/+$/, "") ?? "";
  const set = useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set(key, next);
      else url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
      emit();
    },
    [key],
  );
  return [value, set];
}

function useUrlList(key: string): [string[], (next: string[]) => void] {
  const [raw, setRaw] = useUrlText(key);
  const value = useMemo(() => (raw ? raw.split(",").filter(Boolean) : []), [raw]);
  const set = useCallback((next: string[]) => setRaw([...new Set(next)].join(",")), [setRaw]);
  return [value, set];
}

const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};
