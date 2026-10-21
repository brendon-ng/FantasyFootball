"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useIdentity } from "@/components/identity";
import { BUTTON, Segmented, Select } from "@/components/form";
import { LockScreen, ShareButton } from "@/components/trade-lock";
import { PlayerCardProvider, usePlayerCard } from "@/components/player-card";
import { ProjectionOverridesPanel } from "@/components/projection-overrides";
import { TradeFinder } from "@/components/trade-finder";
import {
  Delta,
  LineupCompare,
  LineupLegend,
  PlayerName,
  TradeWeekSheet,
  type WeekDetail,
} from "@/components/trade-week-sheet";
import { Col, EmptyState, ListHeader, Panel, PanelHeader, Skeleton, Stat, fmt } from "@/components/ui";
import { positionRank } from "@/lib/espn-maps";
import { withBasePath } from "@/lib/base-path";
import type { LeagueRef } from "@/lib/league-ref";
import { lineupPositions, startingSlots, type Lineup } from "@/lib/lineup";
import { applyOverrides, useProjectionOverrides, type ProjectionOverrides } from "@/lib/projection-overrides";
import { useTradeLock, verifyTrade, type TradeLock } from "@/lib/trade-lock";
import {
  useByeTeams,
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
  FREE_AGENT_MARGIN,
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

type AnalyzerProps = {
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
};

/**
 * The gate. Nothing below it mounts — no rosters, no projections, no finder —
 * until the visitor has unlocked this browser or arrived on a validly signed
 * share link. See lib/trade-lock for what that does and does not protect.
 */
export function TradeAnalyzer(props: AnalyzerProps) {
  const lock = useTradeLock();
  const [a] = useUrlText("a");
  const [b] = useUrlText("b");
  const [giveRaw] = useUrlText("give");
  const [sig] = useUrlText("sig");
  const linkKey = `${a}|${b}|${giveRaw}|${sig}`;
  const [shared, setShared] = useState<{ key: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!sig || lock.status !== "locked") return;
    let cancelled = false;
    verifyTrade({ a, b, give: giveRaw ? giveRaw.split(",").filter(Boolean) : [] }, sig).then((ok) => {
      if (!cancelled) setShared({ key: linkKey, ok });
    });
    return () => {
      cancelled = true;
    };
    // `linkKey` stands in for the four params it is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, lock.status]);

  const sharedOk = sig && shared?.key === linkKey ? shared.ok : null;
  if (lock.status === "checking" || (lock.status === "locked" && sig && sharedOk == null)) {
    return (
      <Panel>
        <EmptyState>Checking…</EmptyState>
      </Panel>
    );
  }
  if (lock.status === "unlocked") return <AnalyzerBody {...props} mode="full" lock={lock} />;
  if (sharedOk) return <AnalyzerBody {...props} mode="shared" lock={lock} />;
  return <LockScreen status={lock.status} badLink={Boolean(sig)} onUnlock={lock.unlock} />;
}

function AnalyzerBody({
  mode,
  lock,
  refBySeason,
  initial,
  userIdToSlug,
  owners,
  format,
  rosterPositions,
  baked,
  linkable,
}: AnalyzerProps & {
  /**
   * "shared" is a signed link opened by someone who has not unlocked: the trade
   * is fixed, the finder and overrides are gone, and only view settings — the
   * free-agent setting, a week, a lineup, a player card — can change.
   */
  mode: "full" | "shared";
  lock: TradeLock;
}) {
  const shared = mode === "shared";
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
  const [viewParam, setViewParam] = useUrlText("view");
  const view = !shared && viewParam === "finder" ? "finder" : "analyzer";
  const [faParam, setFaParam] = useUrlText("fa");
  const faMode: FaMode = faParam === "none" || faParam === "traders" ? faParam : "all";
  // The default spells nothing, so an untouched page keeps a clean URL.
  const setFaMode = (m: FaMode) => setFaParam(m === "all" ? "" : m);

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
    shared ||
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
  const byeTeams = useByeTeams(season.season);
  const overridesApi = useProjectionOverrides();
  // A shared trade shows Sleeper's numbers, never the viewer's own overrides.
  const overrides = shared ? NO_OVERRIDES : overridesApi.overrides;
  /**
   * Every number below reads THESE, never `proj.byWeek` directly: an override is
   * the reader saying the projection is wrong, so it has to reach the lineups,
   * the win chances and the odds alike — and both scenarios, since it is a
   * belief about a player rather than part of the trade.
   */
  const projected = useMemo(
    () => applyOverrides(proj.byWeek, overrides),
    [proj.byWeek, overrides],
  );
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

  /**
   * WHO MAY PICK UP FREE AGENTS, the reader's choice. The default is EVERYONE,
   * opponents included — once a pickup has to clear `FREE_AGENT_MARGIN`, the
   * league streams only where it obviously pays, which is a fair thing to expect
   * of any manager. "Trading teams" isolates the two sides; "Rosters only" turns
   * the wire off entirely.
   */
  // A string key, so the memo below depends on one primitive.
  const streamKey =
    faMode === "all" ? "*" : faMode === "none" ? "" : `${teamA?.rosterId ?? ""},${teamB?.rosterId ?? ""}`;
  const streams = useMemo(
    () => (streamKey === "*" ? null : new Set(streamKey.split(",").filter(Boolean).map(Number))),
    [streamKey],
  );

  /**
   * Every team's best lineup for every week, for one set of rosters.
   *
   * `who` overrides which teams may stream — the finder weighs trades with
   * partners the analyzer has not selected, and under "Trading teams" the
   * streamers are whichever two are in the deal being weighed.
   */
  const lineupsFor = useCallback(
    (rosters: ReadonlyMap<number, readonly string[]>, who: ReadonlySet<number> | null = streams): Lineups => {
      const out: Lineups = new Map();
      for (const w of projWeeks) {
        const points = projected[w];
        if (!points) continue;
        out.set(w, weekLineups({ week: w, points }, rosters, order, slots, positionsOf, freeAgents, who));
      }
      return out;
    },
    [projWeeks, projected, order, slots, positionsOf, freeAgents, streams],
  );
  /** Who may stream when `a` trades with `b`, under the current setting. */
  const streamersFor = useCallback(
    (a: number, b: number): ReadonlySet<number> | null =>
      faMode === "all" ? null : new Set(faMode === "none" ? [] : [a, b]),
    [faMode],
  );

  const rostersBefore = useMemo(
    () => new Map<number, readonly string[]>(teamStates.map((t) => [t.rosterId, t.players])),
    [teamStates],
  );
  const tradeKey = `${teamA?.rosterId}:${teamB?.rosterId}:${fromA.join(",")}:${fromB.join(",")}`;
  const rostersAfter = useMemo(
    () =>
      hasTrade && teamA && teamB
        ? applyTrade(teamStates, { a: teamA.rosterId, b: teamB.rosterId, fromA, fromB })
        : rostersBefore,
    // `tradeKey` stands in for the four trade inputs, which are fresh arrays each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamStates, tradeKey, hasTrade, rostersBefore],
  );
  const before = useMemo(() => (ready ? lineupsFor(rostersBefore) : null), [ready, lineupsFor, rostersBefore]);
  const after = useMemo(() => {
    if (!ready || !before) return null;
    return rostersAfter === rostersBefore ? before : lineupsFor(rostersAfter);
  }, [ready, before, lineupsFor, rostersAfter, rostersBefore]);

  /**
   * Each player's projection PER GAME over the rest of the season, bye weeks
   * left out — a bye says nothing about how good he is, and counting it as a
   * zero would sink every player whose bye is still to come against one whose
   * bye has passed. A week with no projection that is NOT a bye (injured, out)
   * still counts as the zero it is.
   *
   * Byes come from the NFL schedule. Until it lands, a week with no projection
   * stands in for one, which is how Sleeper's feed represents a bye anyway.
   */
  const averages = useMemo(
    () => (ready ? averageOver(openWeeks, projected, nflTeamOf, byeTeams) : null),
    [ready, openWeeks, projected, nflTeamOf, byeTeams],
  );
  /** The same, over the playoff weeks alone — the finder's second acceptance test. */
  const playoffWeeks = useMemo(
    () => openWeeks.filter((w) => w >= format.playoffWeekStart),
    [openWeeks, format.playoffWeekStart],
  );
  const playoffAverages = useMemo(
    () => (ready && playoffWeeks.length ? averageOver(playoffWeeks, projected, nflTeamOf, byeTeams) : null),
    [ready, playoffWeeks, projected, nflTeamOf, byeTeams],
  );

  /** The best lineup each team could field from those averages — no particular week. */
  const averageLineups = useMemo(() => {
    if (!averages) return null;
    const of = (rosters: ReadonlyMap<number, readonly string[]>) =>
      weekLineups({ week: 0, points: averages }, rosters, order, slots, positionsOf, freeAgents, streams);
    const b = of(rostersBefore);
    return { before: b, after: rostersAfter === rostersBefore ? b : of(rostersAfter) };
  }, [averages, rostersBefore, rostersAfter, order, slots, positionsOf, freeAgents, streams]);

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

  // Players with an override in any week still to play, for the average view.
  const overriddenAny = new Set(
    Object.entries(overrides)
      .filter(([, w]) => openWeeks.some((wk) => typeof w[String(wk)] === "number"))
      .map(([id]) => id),
  );

  // Anyone the override search can find: every rostered player, plus the pool.
  const candidates = useMemo(
    () => [...new Set([...teams.flatMap((t) => t.players), ...Object.keys(pool.pool ?? {})])],
    [teams, pool.pool],
  );
  const holderOf = (id: string) => {
    const t = teams.find((x) => x.players.includes(id));
    return t ? teamLabel(t, owners) : null;
  };
  const sides = teamA && teamB ? [teamA, teamB] : [];

  const detailData: WeekDetail | null = (() => {
    if (!detail) return null;
    const team = teams.find((t) => t.rosterId === detail.rosterId);
    const b = before?.get(detail.week)?.get(detail.rosterId);
    const a = after?.get(detail.week)?.get(detail.rosterId);
    if (!team || !b || !a) return null;
    const playoff = detail.week > format.regularSeasonWeeks;
    const opp = playoff ? null : opponentOf(detail.week, detail.rosterId);
    const oppLineup = opp != null ? after?.get(detail.week)?.get(opp) ?? null : null;
    // The other side of the trade can be this week's opponent; its arrivals are marked too.
    const oppIncoming =
      opp === teamA?.rosterId ? fromB : opp === teamB?.rosterId && hasTrade ? fromA : [];
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
      outgoing: new Set(team.rosterId === teamA?.rosterId ? fromA : fromB),
      benchBefore: benchOf(rostersBefore.get(team.rosterId) ?? [], b, projected[detail.week]),
      benchAfter: benchOf(rostersAfter.get(team.rosterId) ?? [], a, projected[detail.week]),
      oppLineup:
        oppLineup && opp != null
          ? {
              lineup: oppLineup,
              bench: benchOf(rostersAfter.get(opp) ?? [], oppLineup, projected[detail.week]),
              incoming: new Set(oppIncoming),
            }
          : null,
      onBye: new Set(
        [
          ...(rostersBefore.get(team.rosterId) ?? []),
          ...(rostersAfter.get(team.rosterId) ?? []),
          ...(opp != null ? rostersAfter.get(opp) ?? [] : []),
        ].filter(
          (id) => {
            // A team defence's id IS its abbreviation.
            const nfl = nflTeamOf(id) ?? (/^[A-Z]{2,4}$/.test(id) ? id : null);
            return nfl != null && Boolean(byeTeams?.get(detail.week)?.has(nfl));
          },
        ),
      ),
      overridden: new Set(
        Object.entries(overrides)
          .filter(([, w]) => typeof w[String(detail.week)] === "number")
          .map(([id]) => id),
      ),
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
    <PlayerCardProvider
      leagueRef={ref}
      historyUrl={withBasePath("/trade-analyzer/history.json")}
      userIdToSlug={userIdToSlug}
      ownerNames={Object.fromEntries(Object.entries(owners).map(([slug, o]) => [slug, o.name]))}
      season={season.season}
      week={Math.max(1, season.week)}
      holderOf={(id) => {
        const t = teams.find((x) => x.players.includes(id));
        return t ? { label: label(t), slug: t.ownerSlug } : null;
      }}
      nameOf={nameOf}
      linkable={canLink}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        {shared ? (
          <span className="inline-flex h-9 items-center rounded-lg border border-trade/40 bg-trade/10 px-3 text-[13px] text-trade">
            Shared trade · read only
          </span>
        ) : (
          <Segmented
            kind="tab"
            label="View"
            value={view}
            onChange={(v) => setViewParam(v === "analyzer" ? "" : v)}
            options={[
              { value: "analyzer", label: "Analyzer" },
              { value: "finder", label: "Finder" },
            ]}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-[10px]">Free agents</span>
          <Segmented label="Who may pick up free agents" value={faMode} onChange={setFaMode} options={FA_MODES} />
          {!shared ? (
            <button type="button" onClick={lock.lock} className={BUTTON.secondary} title="Forget the passphrase on this device">
              Lock
            </button>
          ) : null}
        </div>
      </div>

      {!shared && overridesApi.activeCount ? (
        // AN OVERRIDDEN BOARD RENDERS EXACTLY LIKE A REAL ONE, and the overrides
        // live in this browser only — so a screenshot of these numbers has to
        // say they are not Sleeper's. Same reason `<MockBadge />` exists.
        <div className="rounded-lg border border-caution/40 bg-caution/10 px-4 py-2 text-[12px] text-caution">
          {overridesApi.activeCount === 1
            ? "1 player's projections are overridden"
            : `${overridesApi.activeCount} players' projections are overridden`}{" "}
          — every number below uses them.{" "}
          <a href="#overrides" className="underline underline-offset-2 hover:text-chalk-100">
            Review
          </a>
        </div>
      ) : null}

      {view === "finder" ? (
        <TradeFinder
          teams={teams}
          label={label}
          defaultSender={teamA}
          slots={slots}
          positionsOf={positionsOf}
          freeAgents={freeAgents}
          averages={averages}
          playoffAverages={playoffAverages}
          projected={projected}
          weeks={openWeeks}
          playoffWeeks={playoffWeeks}
          lineupsFor={lineupsFor}
          streamersFor={streamersFor}
          teamStates={teamStates}
          streamingOn={faMode !== "none"}
          nameOf={nameOf}
          positionOf={positionOf}
          canLink={canLink}
          ready={ready}
          onOpen={(sender, partner, giveIds, getIds) => {
            setA(sender);
            setB(partner);
            setGive([...giveIds, ...getIds]);
            setViewParam("");
            window.scrollTo({ top: 0 });
          }}
        />
      ) : (
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
                  <Select
                    className="mb-3"
                    value={team?.ownerSlug ?? ""}
                    disabled={shared}
                    onChange={(e) => set(e.target.value)}
                    aria-label={which === "a" ? "First team" : "Second team"}
                  >
                    {which === "b" && !team ? <option value="">Pick a trade partner…</option> : null}
                    {teams
                      .filter((t) => t.rosterId !== other?.rosterId)
                      .map((t) => (
                        <option key={t.rosterId} value={t.ownerSlug}>
                          {label(t)}
                        </option>
                      ))}
                  </Select>
                  {team ? (
                    <RosterPicker
                      team={team}
                      picked={picked}
                      onToggle={toggle}
                      nameOf={nameOf}
                      positionOf={positionOf}
                      nflTeamOf={nflTeamOf}
                      average={(id) => averageOf(id, openWeeks, projected)}
                      loading={!ready}
                      readOnly={shared}
                    />
                  ) : (
                    <EmptyState>Pick a team to trade with.</EmptyState>
                  )}
                </div>
              ))}
            </div>
            {!shared && give.length ? (
              <div className="flex flex-wrap justify-end gap-2 border-t border-ink-600 px-4 py-2 sm:px-5">
                {hasTrade && teamA && teamB && lock.sign ? (
                  <ShareButton
                    sign={lock.sign}
                    trade={{ a: teamA.ownerSlug, b: teamB.ownerSlug, give: [...fromA, ...fromB] }}
                    fa={faParam}
                  />
                ) : null}
                <button type="button" onClick={() => setGive([])} className={BUTTON.secondarySm}>
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

              {averageLineups && averages ? (
                <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
                  {sides.map((team) => {
                    const b = averageLineups.before.get(team.rosterId);
                    const a = averageLineups.after.get(team.rosterId);
                    if (!b || !a) return null;
                    const mine = team.rosterId === teamA.rosterId;
                    return (
                      <Panel key={team.rosterId}>
                        <PanelHeader
                          title={`${label(team)} · average lineup`}
                          meta={
                            <>
                              {b.total.toFixed(1)} → {a.total.toFixed(1)} <Delta n={a.total - b.total} />
                            </>
                          }
                          legend="Best lineup from each player's projection per game over the rest of the season, bye weeks left out."
                        />
                        <div className="pb-4">
                          <LineupCompare
                            before={b}
                            after={a}
                            benchBefore={benchOf(rostersBefore.get(team.rosterId) ?? [], b, averages)}
                            benchAfter={benchOf(rostersAfter.get(team.rosterId) ?? [], a, averages)}
                            incoming={new Set(mine ? fromB : fromA)}
                            outgoing={new Set(mine ? fromA : fromB)}
                            overridden={overriddenAny}
                            onBye={NO_BYES}
                            nameOf={nameOf}
                            positionOf={positionOf}
                            canLink={canLink}
                          />
                          <LineupLegend byes={false} />
                        </div>
                      </Panel>
                    );
                  })}
                </div>
              ) : null}

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
        </>
      )}

      {!shared ? (
        <div id="overrides" className="scroll-mt-20">
          <ProjectionOverridesPanel
            api={overridesApi}
            weeks={openWeeks}
            sleeper={proj.byWeek}
            candidates={candidates}
            nameOf={nameOf}
            positionOf={positionOf}
            nflTeamOf={nflTeamOf}
            holderOf={holderOf}
          />
        </div>
      ) : null}

      {view === "analyzer" ? (
        <p className="max-w-3xl text-[11px] leading-relaxed text-chalk-600">
          Every lineup is the best one each team could field that week, using Sleeper&rsquo;s weekly
          projections scored with this league&rsquo;s settings — never the lineup a team actually
          set. {FA_MODES.find((m) => m.value === faMode)!.note}{" "}
          {faMode !== "none"
            ? `A free agent only starts where he projects at least ${Math.round(FREE_AGENT_MARGIN * 100)}% more than the rostered player he would replace. `
            : null}
          Win chances treat a
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
      ) : null}

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
    </PlayerCardProvider>
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
  readOnly = false,
}: {
  team: LiveTeam;
  picked: string[];
  onToggle: (id: string) => void;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  nflTeamOf: (id: string) => string | null;
  average: (id: string) => number | null;
  loading: boolean;
  /** A shared trade: the ticks show the deal and cannot be changed. */
  readOnly?: boolean;
}) {
  const card = usePlayerCard();
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
              className={`flex items-baseline gap-2 rounded px-1.5 py-1 text-[13px] transition-colors ${
                readOnly ? "" : "cursor-pointer"
              } ${on ? "bg-trade/15 text-chalk-100" : readOnly ? "text-chalk-500" : "text-chalk-400 hover:bg-ink-700"}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={readOnly}
                onChange={() => onToggle(id)}
                className="translate-y-0.5 accent-[var(--color-trade)]"
              />
              <span className="w-8 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
                {positionOf(id) ?? "—"}
              </span>
              <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
              {card ? (
                <button
                  type="button"
                  aria-label={`${nameOf(id)} player card`}
                  title="Player card"
                  onClick={(e) => {
                    // Inside a <label>: without this the click also ticks the box.
                    e.preventDefault();
                    e.stopPropagation();
                    card.open(id);
                  }}
                  className="shrink-0 rounded px-1 text-[11px] text-chalk-600 transition-colors hover:text-accent"
                >
                  ⓘ
                </button>
              ) : null}
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

type FaMode = "none" | "traders" | "all";

const NO_OVERRIDES: ProjectionOverrides = {};

/** The average lineup has no week, so nobody in it is on a bye. */
const NO_BYES: Set<string> = new Set();

const FA_MODES: Array<{ value: FaMode; label: string; hint: string; note: string }> = [
  {
    value: "none",
    label: "Rosters only",
    hint: "Every lineup comes from the team's current roster",
    note: "Nobody picks up free agents: every lineup comes from the roster as it stands.",
  },
  {
    value: "traders",
    label: "Trading teams",
    hint: "The two teams in the trade may start free agents; everyone else uses their roster",
    note: "The two teams in the trade may start free agents, assuming a bench spot can be cleared; every other team fields its own roster.",
  },
  {
    value: "all",
    label: "Everyone",
    hint: "Every team may start free agents, worst record claiming first",
    note: "Every team may start free agents, assuming a bench spot can be cleared — where two want the same player, the worse record claims him first.",
  },
];

/** Per-game projection over `weeks`, byes left out. See `averages` in the component. */
function averageOver(
  weeks: readonly number[],
  projected: Record<number, Record<string, number>>,
  nflTeamOf: (id: string) => string | null,
  byeTeams: Map<number, Set<string>> | null,
): Record<string, number> | null {
  const known = weeks.filter((w) => projected[w]);
  if (!known.length) return null;
  const ids = new Set<string>();
  for (const w of known) for (const id of Object.keys(projected[w])) ids.add(id);
  const out: Record<string, number> = {};
  for (const id of ids) {
    // A team defence's id IS its abbreviation.
    const nfl = nflTeamOf(id) ?? (/^[A-Z]{2,4}$/.test(id) ? id : null);
    const games = known.filter((w) => (byeTeams && nfl ? !byeTeams.get(w)?.has(nfl) : projected[w][id] != null));
    if (!games.length) continue;
    out[id] = games.reduce((sum, w) => sum + (projected[w][id] ?? 0), 0) / games.length;
  }
  return out;
}

/** Everyone on the roster who is not starting, best projection first. */
function benchOf(
  roster: readonly string[],
  lineup: Lineup,
  points: Record<string, number> | undefined,
): Array<{ id: string; points: number }> {
  const starting = new Set(lineup.slots.map((s) => s.id));
  return roster
    .filter((id) => !starting.has(id))
    .map((id) => ({ id, points: points?.[id] ?? 0 }))
    .sort((x, y) => y.points - x.points);
}

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
