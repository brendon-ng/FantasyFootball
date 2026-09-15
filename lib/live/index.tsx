"use client";

/**
 * The live layer, one provider deep.
 *
 * Every hook here takes a `LeagueRef` and picks a provider from it, so a
 * component never learns which service its league is on. The mock handling, the
 * fail-soft behaviour and the returned shapes are exactly what the Sleeper-only
 * version did — the provider swap happens under all of it.
 *
 * FAIL SOFT IS THE RULE. An outage leaves the page showing its baked data
 * rather than an error screen, because everything on the page is still correct
 * — just not annotated with what changed since the last build.
 */

import { useEffect, useMemo, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import {
  mockCompletedDraftDate,
  mockDraftDate,
  mockDraftOrder,
} from "@/lib/draft-slots";
import {
  PROVIDER_NAME,
  candidateProviders,
  refKey,
  type LeagueRef,
} from "@/lib/league-ref";
import { applyPhaseMock, type Replay } from "@/lib/phase-mock";
import { draftMocks, mockPhase, mockWeek } from "@/lib/sticky-params";
import type { LiveMatchup, LiveSeason } from "@/lib/types";
import {
  lastPlaceOdds,
  liveProjection,
  lockedIntoLast,
  winProbability,
  type WinProbability,
} from "@/lib/win-probability";

import { espnProvider } from "./espn.ts";
import { fetchNflClock } from "./nfl-clock.ts";
import { fetchNflWeek, teamsSettled, type NflWeekState } from "./nfl-schedule.ts";
import { sleeperProvider } from "./sleeper.ts";
import type {
  LeagueMove,
  LiveDraft,
  LiveDraftPick,
  LiveMove,
  LiveProvider,
  LiveRoster,
  LiveState,
  LiveTradedPick,
  LiveWeekGame,
  PlayerWeekState,
} from "./types.ts";

export type { WinProbability } from "@/lib/win-probability";
export type {
  LeagueMove,
  LiveDraft,
  LiveDraftPick,
  LiveMove,
  LiveRoster,
  LiveState,
  LiveTradedPick,
  PlayerWeekState,
} from "./types.ts";

/** One team's week, with whoever they played. */
export interface WeekScore {
  points: number;
  opponentSlug: string | null;
  opponentPoints: number | null;
}

/**
 * What an owner scored in one specific week, and against whom.
 *
 * LIVE, BECAUSE THE DERIVED ANSWER IS NOT THERE YET. `weekly-lows.json` only
 * knows a week once it has been archived, and a punishment is drawn in the days
 * before that happens — so the score the draw screen most wants is precisely the
 * one the build does not have.
 *
 * Two fetches, because the scoreboard is in roster ids and the caller asked
 * about a person: the roster list resolves owner to roster, and co-owners count,
 * since a co-owned team is one roster with two people on it.
 *
 * Fails soft to null. The draw works without a score; it is context, not a
 * prerequisite.
 */
export function useWeekScore(
  ref: LeagueRef | null,
  week: number | null,
  slug: string | null,
  userIdToSlug: Record<string, string>,
): WeekScore | null {
  const [score, setScore] = useState<WeekScore | null>(null);
  const key =
    ref && week != null && slug ? `${refKey(ref)}:${week}:${slug}` : null;

  useEffect(() => {
    const provider = providerFor(ref);
    if (!key || !ref || !provider || week == null || !slug) return;
    let cancelled = false;

    (async () => {
      try {
        const [rosters, games] = await Promise.all([
          provider.rosters(ref.id, ref.season),
          provider.weekGames(ref.id, ref.season, week),
        ]);
        const slugsOf = (r: (typeof rosters)[number]) =>
          [r.ownerId, ...r.coOwners]
            .map((u) => (u ? userIdToSlug[u] : null))
            .filter(Boolean);
        const mine = rosters.find((r) => slugsOf(r).includes(slug));
        if (!mine) return;

        const game = games.find((g) =>
          g.sides.some((x) => x.rosterId === mine.rosterId),
        );
        const side = game?.sides.find((x) => x.rosterId === mine.rosterId);
        if (!side) return;

        const other =
          game?.sides.find((x) => x.rosterId !== mine.rosterId) ?? null;
        const theirs = other
          ? (rosters.find((r) => r.rosterId === other.rosterId) ?? null)
          : null;

        if (!cancelled) {
          setScore({
            points: side.points,
            opponentSlug: theirs ? (slugsOf(theirs)[0] ?? null) : null,
            opponentPoints: other?.points ?? null,
          });
        }
      } catch {
        // Context only — the page is fine without it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, ref, week, slug, userIdToSlug]);

  return score;
}

const PROVIDERS: Record<LeagueRef["provider"], LiveProvider> = {
  sleeper: sleeperProvider,
  espn: espnProvider,
};

const providerFor = (ref: LeagueRef | null): LiveProvider | null =>
  ref ? PROVIDERS[ref.provider] : null;

/**
 * Shared plumbing for the one-shot hooks.
 *
 * All three did the same five things — guard on a null ref, cancel a stale
 * response, map, set, fail soft — with the only difference being the call in
 * the middle. `empty` is what a league with no ref resolves to, which is a
 * known result rather than a pending fetch: deriving it beats setting state
 * inside the effect, which triggers a cascading render.
 */
function useProviderData<T>(
  ref: LeagueRef | null,
  empty: T,
  load: (p: LiveProvider, ref: LeagueRef) => Promise<T>,
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  const key = refKey(ref);

  useEffect(() => {
    const provider = providerFor(ref);
    if (!ref || !provider) return;
    // Guards against a stale response landing after a newer request.
    let cancelled = false;

    (async () => {
      try {
        const data = await load(provider, ref);
        if (!cancelled) setState({ status: "ready", data, error: null });
      } catch (err) {
        if (!cancelled)
          setState({ status: "error", data: null, error: String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` stands in for `ref`, which is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!ref) return { status: "ready", data: empty, error: null };
  return state;
}

/**
 * Picks made in a draft, refreshed while it is running.
 *
 * THE ONLY POLLING HOOK HERE. Everything else on this site is fetched once,
 * because it changes on the scale of a deploy; a draft changes every thirty
 * seconds and the whole value of watching the board during one is that it keeps
 * up. Fifteen seconds is well inside Sleeper's limits — one small request per
 * viewer per interval, against a documented ceiling of about 1000 a minute.
 *
 * IT STOPS WHEN THE DRAFT DOES. `live` is false before a draft starts and once
 * it completes, and then this behaves like every other hook here: one fetch, no
 * timer. A finished draft's picks never change, and a poll left running would
 * be a request every fifteen seconds for the rest of the year.
 *
 * A FAILED POLL KEEPS THE LAST GOOD DATA rather than blanking the board. A
 * dropped request mid-draft is exactly when the page is being stared at, and
 * showing nothing would be worse than showing the state from fifteen seconds
 * ago — which is what the next poll will correct anyway.
 */
export function useLiveDraftPicks(
  ref: LeagueRef | null,
  draftId: string | null,
  live: boolean,
): LiveState<LiveDraftPick[]> {
  const [state, setState] = useState<LiveState<LiveDraftPick[]>>({
    status: "loading",
    data: null,
    error: null,
  });
  const key = refKey(ref);

  useEffect(() => {
    const provider = providerFor(ref);
    if (!ref || !provider || !draftId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const data = await provider.draftPicks(draftId);
        if (!cancelled) setState({ status: "ready", data, error: null });
      } catch {
        // Deliberately keeps whatever is already on screen; see above.
      }
    };

    void tick();
    if (!live) return () => { cancelled = true; };

    const timer = setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `key` stands in for `ref`, which is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draftId, live]);

  if (!ref || !draftId) return { status: "ready", data: [], error: null };
  return state;
}

/** Live rosters for a league. */
export function useLiveRosters(ref: LeagueRef | null): LiveState<LiveRoster[]> {
  return useProviderData<LiveRoster[]>(ref, [], (p, r) =>
    p.rosters(r.id, r.season),
  );
}

/** Picks that have changed hands, for the upcoming draft. */
export function useLiveTradedPicks(
  ref: LeagueRef | null,
): LiveState<LiveTradedPick[]> {
  return useProviderData<LiveTradedPick[]>(ref, [], (p, r) =>
    p.tradedPicks(r.id, r.season),
  );
}

/**
 * The upcoming draft.
 *
 * Live because none of this is settled until the draft runs: the order is drawn
 * after the keeper deadline, and picks are traded up to the last minute. It gets
 * committed to `data/<slug>/derived/drafts.json` once the draft completes.
 */
export function useLiveDraft(
  ref: LeagueRef | null,
): LiveState<LiveDraft | null> {
  return useProviderData<LiveDraft | null>(ref, null, async (p, r) => {
    const raw = await p.draft(r.id, r.season);
    if (!raw) return null;

    // Every mock below only ever fills in a MISSING value, so once the provider
    // has the real thing the flags quietly stop doing anything.
    const flags = draftMocks();
    let { status, orderSet, startTime, slotToRoster } = raw;
    const wantsOrder = !orderSet && flags.order;
    const wantsComplete = status !== "complete" && flags.complete;
    const wantsDate = !startTime && flags.date;

    if (wantsOrder) {
      slotToRoster = mockDraftOrder(slotToRoster, raw.draftId);
      orderSet = true;
    }
    if (wantsComplete) {
      status = "complete";
      // Backdated, so the keeper deadline reads as closed and picks frozen.
      startTime = mockCompletedDraftDate();
    } else if (wantsDate) {
      // Two weeks out, so the keeper deadline — three days before the draft —
      // still lands in the future and the countdown has something to count.
      startTime ??= mockDraftDate();
    }

    return {
      ...raw,
      status,
      orderSet,
      startTime,
      slotToRoster,
      mocked: wantsOrder || wantsComplete || wantsDate,
    };
  });
}

/**
 * The in-progress season, refreshed in the browser.
 *
 * Mirrors `getLiveSeason()` in lib/data.ts, which produces the same shape at
 * BUILD time. The build-time value is passed in as `initial` and rendered
 * immediately, so this never shows a loading state and never blanks the page
 * when the provider is down — it only ever replaces a good value with a fresher
 * one.
 *
 * Worth having despite the 15-minute game-window rebuilds: standings and rosters
 * tolerate being a quarter-hour stale, but a live score does not.
 *
 * Takes the whole season -> ref map rather than one ref, because the provider's
 * own clock decides which season is current. In September that flips to a
 * league the service only just created, and the map is what `sync` keeps
 * current.
 */
export function useLiveSeason(
  refBySeason: Record<string, LeagueRef>,
  initial: LiveSeason | null,
  /** Provider user id -> owner slug. Only co-owners need it; see `creditedSlugs`. */
  userIdToSlug: Record<string, string> = {},
  /**
   * Sleeper player id -> NFL team, from the baked index. Lets the Sleeper
   * provider report which teams a side started, which is what settles a matchup
   * on Sunday night rather than Tuesday. ESPN does not need it.
   */
  teamByPlayer?: Record<string, string>,
): LiveSeason | null {
  const [live, setLive] = useState<LiveSeason | null>(initial);
  const [replay, setReplay] = useState<Replay | null>(null);

  // Only when a mock is on: a real visitor never downloads the replay.
  useEffect(() => {
    if (!mockPhase()) return;
    let cancelled = false;
    fetch(
      withBasePath(`/mock/${process.env.NEXT_PUBLIC_LEAGUE ?? "den-ops"}.json`),
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!cancelled) setReplay(r as Replay | null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Which providers this league could be on, deduped.
   *
   * Nearly always one. A league mid-migration lists both, and the right answer
   * is whichever one's clock names a season this league actually has — asking
   * only Sleeper in a year the league has moved to ESPN finds nothing.
   */
  const seasonKeys = Object.keys(refBySeason).sort().join(",");
  const providers = useMemo(
    () => candidateProviders(refBySeason),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonKeys],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const slugByRoster = new Map(
          (initial?.teams ?? []).map((t) => [t.rosterId, t.ownerSlug] as const),
        );

        for (const name of providers) {
          if (cancelled) return;
          const provider = PROVIDERS[name];
          // PER PROVIDER, not around the loop. A rejected fetch — an ad
          // blocker, a DNS sinkhole, a captive portal — used to escape to the
          // outer catch and abandon the remaining providers, so an unreachable
          // ESPN left a Sleeper league with no live data at all.
          try {
            const st = await provider.state();
            if (!st) continue;
            const ref = refBySeason[String(st.season)];
            if (!ref || ref.provider !== name) continue;

            const next = await provider.season(ref.id, st, {
              slugByRoster,
              userIdToSlug,
              teamByPlayer,
            });
            if (cancelled) return;
            if (!next) continue;
            setLive(applyPhaseMock(next, mockPhase(), replay, mockWeek()));
            return;
          } catch {
            // Try the next one.
          }
        }
      } catch {
        // Fails soft: `initial` stays on screen. An outage should not blank the
        // page, it should just stop it getting fresher.
      }
    })();

    return () => {
      cancelled = true;
    };
  // `teamByPlayer` is a fresh object literal each render but its CONTENTS come
  // from the build, so it never actually changes; listing it would refetch the
  // whole live season on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, refBySeason, initial, replay, userIdToSlug]);

  return live;
}

/**
 * Moves involving one player since `fromWeek`, from whichever service holds it.
 *
 * A plain function, not a hook: the caller already owns the effect that decides
 * when to ask, and the two providers answer in shapes that only differ in how
 * they were fetched.
 */
export async function liveMoves(
  ref: LeagueRef | null,
  playerId: string,
  fromWeek: number,
  weeks: number,
): Promise<LiveMove[]> {
  const provider = providerFor(ref);
  if (!ref || !provider) return [];
  return provider.moves(ref.id, ref.season, playerId, fromWeek, weeks);
}

/** Every completed move in the league since `fromWeek`, from either service. */
export async function leagueMoves(
  ref: LeagueRef | null,
  fromWeek: number,
  weeks: number,
): Promise<LeagueMove[]> {
  const provider = providerFor(ref);
  if (!ref || !provider) return [];
  return provider.leagueMoves(ref.id, ref.season, fromWeek, weeks);
}

/**
 * What a player's week is DOING, beyond the number beside his name.
 *
 * A bare 0.00 is four different situations and the reader cannot tell them
 * apart: on a bye, kickoff not reached, his team played without him, or he
 * played and did nothing. Only the last is his fault, and only the third is
 * worth being annoyed about.
 */
export interface LineupStates {
  /** Null until the clock is known; callers render no annotation meanwhile. */
  stateOf: (slot: { id: string; team: string | null; played?: boolean }) => PlayerWeekState | null;
  /** True once the NFL clock has been consulted, so a legend can appear. */
  ready: boolean;
}

/**
 * Resolves a player's week state from the NFL clock plus the provider's stats.
 *
 * TWO CLOCKS, because neither is sufficient. Sleeper's season schedule says
 * whether a team's game is OVER and, by absence, whether it is a bye — one
 * request for the year, already fetched by `useMatchupSettled`. It cannot say
 * whether a game is on RIGHT NOW: a game in the third quarter still reads
 * `pre_game` there. ESPN's scoreboard has that, per game, for 16.5KB.
 *
 * THE SCHEDULE IS THE AUTHORITY ON "OVER", not the scoreboard, so a scoreboard
 * outage can only ever cost the live/upcoming distinction — never turn a
 * finished game back into a pending one.
 *
 * GATED LIKE `useMatchupSettled`: only inside a live, unscored week, and never
 * under a phase mock, where the real clock says a replayed season ended months
 * ago and would mark every player final.
 */
export function useLineupStates(
  live: LiveSeason | null,
  ref: LeagueRef | null,
): LineupStates {
  const inSeason = live?.seasonType === "regular" || live?.seasonType === "post";
  const week = live?.week ?? 0;
  const season = live?.season ?? 0;
  const scored = week > 0 && (live?.lastScoredLeg ?? 0) >= week;
  const ask = Boolean(inSeason && week > 0 && !scored && !mockPhase());
  const key = `${season}:${week}`;

  const [slate, setSlate] = useState<{ key: string; wk: NflWeekState } | null>(null);
  /**
   * Who has a real stat line, for the providers that do not say on the lineup.
   *
   * ESPN answers on the boxscore entry for free and returns null here; Sleeper
   * fetches a ~9KB weekly stat line. Asked ONCE per week from this hook rather
   * than by each panel, so a two-lineup page makes one request, not two.
   */
  const [playedSet, setPlayedSet] = useState<{ key: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (!ask) return;
    let cancelled = false;
    fetchNflWeek(season, week)
      .then((wk) => {
        if (!cancelled && wk) setSlate({ key, wk });
      })
      .catch(() => {});
    providerFor(ref)
      ?.playedThisWeek(season, week)
      .then((ids) => {
        if (!cancelled && ids) setPlayedSet({ key, ids });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `refKey` stands in for `ref`, a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key, season, week, refKey(ref)]);

  const wk = slate?.key === key ? slate.wk : null;

  return {
    ready: Boolean(wk || scored),
    stateOf: ({ id, team, played: onSlot }) => {
      if (!team) return null;
      // The provider's own answer wins; the fetched set is the fallback for the
      // one that does not give it. Undefined stays undefined — never false —
      // so an unknown reads as "played" rather than accusing somebody of a DNP.
      const ids = playedSet?.key === key ? playedSet.ids : null;
      const played = onSlot ?? (ids ? ids.has(id) : undefined);
      // The week is archived: everything in it is over, whatever the clocks say.
      if (scored) return played === false ? "dnp" : "final";
      if (!wk) return null;
      // ABSENT FROM THE SCHEDULE IS A BYE. Checked against the schedule and not
      // the scoreboard, because a team missing from the scoreboard could just be
      // a request that came back short.
      if (wk && !(team in wk.doneByTeam)) return "bye";

      // ONE FEED ANSWERS ALL OF IT. `in_game` is a real status, so the season
      // schedule already fetched for the record chips separates "not kicked
      // off" from "being played" — which is what a second request to ESPN's
      // scoreboard used to be for.
      const gs = wk.stateByTeam[team];
      if (gs === "post") return played === false ? "dnp" : "final";
      if (gs === "in") return "live";
      if (gs === "pre") return "upcoming";
      return null;
    },
  };
}

/**
 * Every team's current and live-projected total for the week.
 *
 * THE SHARED HALF of the two things built on it — a head-to-head win
 * probability and a league-wide last-place probability. Both need the same two
 * fetches (the clock, and Sleeper's weekly projections where the provider does
 * not put them on the lineup), both cached per season+week on the module, so a
 * page showing both makes one set of requests.
 *
 * GATED HARD: only inside a live, unscored week where somebody has actually
 * scored, and never under a phase mock. Everything fails soft to null.
 */
function useLiveTotals(
  live: LiveSeason | null,
  ref: LeagueRef | null,
): Map<string, { current: number; projected: number; done: boolean }> | null {
  const inSeason = live?.seasonType === "regular" || live?.seasonType === "post";
  const week = live?.week ?? 0;
  const season = live?.season ?? 0;
  const scored = week > 0 && (live?.lastScoredLeg ?? 0) >= week;
  /**
   * NOT GATED ON ANYONE HAVING SCORED, deliberately.
   *
   * It used to also require a matchup with points on the board, which meant a
   * projection only appeared once the week was already underway — and a
   * projected final is at its most useful BEFORE kickoff, when it is all there
   * is. Sleeper shows one from the moment the week flips, and both feeds this
   * needs are published then: the scores endpoint lists the week's games with
   * a null quarter, which `secondsRemaining` reads as a full 3600, and the
   * projections endpoint is up days early.
   *
   * With nothing played, `liveProjection` returns the pre-game projection
   * untouched — `o` is 1, so the weight on the live pace is zero. So the number
   * is the projection, which is exactly what it should say on a Wednesday.
   */
  const ask = Boolean(inSeason && week > 0 && !scored && !mockPhase());
  const key = `${season}:${week}`;

  const [clock, setClock] = useState<{ key: string; by: Record<string, number> } | null>(null);
  const [proj, setProj] = useState<{ key: string; by: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!ask) return;
    let cancelled = false;
    fetchNflClock(season, week)
      .then((by) => {
        if (!cancelled && by) setClock({ key, by });
      })
      .catch(() => {});
    if (ref) {
      providerFor(ref)
        ?.weekProjections(season, week, ref.id)
        .then((by) => {
          if (!cancelled && by) setProj({ key, by });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, key, season, week, refKey(ref)]);

  if (!ask || !live) return null;
  const by = clock?.key === key ? clock.by : null;
  if (!by) return null;
  const projById = proj?.key === key ? proj.by : null;

  /**
   * A side's projected final, summed over its STARTERS.
   *
   * Null if the lineup is missing or any starter has no projection from either
   * source — a total built from a partial lineup understates that team, which
   * would hand somebody else a probability they have not earned.
   */
  const totalOf = (side: LiveMatchup["a"]): { projected: number; done: boolean } | null => {
    const lineup = side.lineup?.filter((p) => p.started);
    if (!lineup?.length) return null;
    let total = 0;
    // Whether this team's score can still MOVE. Only used by the certainty
    // check in `lockedIntoLast`; the probability does not need it.
    let done = true;
    for (const p of lineup) {
      /**
       * AN UNPROJECTED PLAYER IS WORTH 0, not a reason to give up on the team.
       *
       * Sleeper publishes a line for essentially every player but a `pts_ppr`
       * for only the ones it has actually projected, so a starter it has no
       * opinion on — A.J. Brown in week 2, no injury flag, simply no
       * projection — used to void his whole team. One card in five then had a
       * score with nothing under it, which reads as broken rather than as
       * missing data. Sleeper counts him as zero in its own total.
       *
       * The bail is kept for the case it was written for: no feed at all.
       * Then nothing is known about anybody and a total would be fiction.
       */
      const pre = p.projected ?? (projById ? (projById[p.id] ?? 0) : undefined);
      if (pre == null) return null;
      // A player on a bye has no game, so nothing is left for him to add — he
      // is absent from the clock feed entirely, which is the same `undefined`
      // a missing team would give. Both are treated as nothing-left, exactly
      // as the projection below already does, so the two cannot disagree
      // about whether a team has finished.
      const left = p.team ? (by[p.team] ?? 0) : 0;
      if (left > 0) done = false;
      total += liveProjection(p.points, pre, left);
    }
    return { projected: total, done };
  };

  const out = new Map<string, { current: number; projected: number; done: boolean }>();
  for (const m of live.matchups) {
    for (const side of [m.a, m.b]) {
      const t = totalOf(side);
      if (t == null) continue;
      out.set(side.ownerSlug, { current: side.points, ...t });
    }
  }
  return out.size ? out : null;
}

/**
 * Each team's PROJECTED FINAL for the week, or null when there is none to give.
 *
 * Sleeper's own blend — see `liveProjection` — so the number beside a score
 * here is the number in the app people have open next to this page. It is also
 * exactly what the win probability and the last-place odds are built on, so a
 * card cannot show a projection that disagrees with its own percentages.
 *
 * NOT FETCHED OUTSIDE A LIVE WEEK. `useLiveTotals` asks for the clock and the
 * per-player projections only while a week is running and unscored, so a
 * reader on a Tuesday downloads neither and gets null here.
 *
 * `done` says the team's last game has ended, which is when the projection
 * stops being a projection: it equals the score, and repeating the score in
 * smaller type underneath it is noise.
 */
export function useLiveProjections(
  live: LiveSeason | null,
  ref: LeagueRef | null,
): Record<string, { projected: number; done: boolean }> | null {
  const totals = useLiveTotals(live, ref);
  if (!totals) return null;
  const out: Record<string, { projected: number; done: boolean }> = {};
  for (const [ownerSlug, t] of totals) out[ownerSlug] = { projected: t.projected, done: t.done };
  return Object.keys(out).length ? out : null;
}

/**
 * Live win probability for one matchup, or null when there is nothing to say.
 *
 * SLEEPER'S OWN MODEL — see `lib/win-probability`, transcribed from their
 * bundle so the number here agrees with the number in the app.
 */
export function useWinProbability(
  live: LiveSeason | null,
  ref: LeagueRef | null,
  matchup: LiveMatchup | null,
): WinProbability | null {
  const totals = useLiveTotals(live, ref);
  if (!totals || !matchup) return null;
  const a = totals.get(matchup.a.ownerSlug);
  const b = totals.get(matchup.b.ownerSlug);
  if (!a || !b) return null;
  return winProbability(a.current, a.projected, b.current, b.projected);
}

/**
 * Each team's chance of posting the LOWEST score in the league this week.
 *
 * The weekly punishment question, and a different one from who wins a matchup:
 * a team can be losing comfortably and still be nowhere near last. Uses the
 * same per-team distributions the win probability does, so the two numbers on
 * the site cannot disagree about how good a team's week is going.
 *
 * REGULAR SEASON ONLY, because the punishment is. A postseason week is not
 * every team playing, so "lowest of the week" would rank a six-team playoff
 * field against a twelve-team one — the same rule `buildWeeklyLows` follows in
 * derive.
 */
export function useLastPlaceOdds(
  live: LiveSeason | null,
  ref: LeagueRef | null,
  regularSeasonWeeks: number,
): Array<{
  ownerSlug: string;
  current: number;
  projected: number;
  odds: number;
  /** Mathematically settled, not merely likely. See `lockedIntoLast`. */
  locked: boolean;
}> | null {
  const totals = useLiveTotals(live, ref);
  if (!totals || !live) return null;
  if (live.week > regularSeasonWeeks) return null;
  // Every team must be accounted for, or the field is not the whole league and
  // "lowest of the league" is not what is being computed.
  if (totals.size !== live.teams.length) return null;

  const rows = [...totals.entries()].map(([ownerSlug, t]) => ({ ownerSlug, ...t }));
  const odds = lastPlaceOdds(rows);
  if (!odds) return null;
  const locked = lockedIntoLast(rows);
  return rows
    .map((r, i) => ({ ...r, odds: odds[i], locked: locked[i] }))
    .sort((x, y) => y.odds - x.odds);
}

/** Small badge describing where the live layer stands. */
export function LiveStatus({
  status,
  provider = "sleeper",
}: {
  status: LiveState<unknown>["status"];
  provider?: LeagueRef["provider"];
}) {
  const name = PROVIDER_NAME[provider];
  if (status === "loading") {
    return <span className="text-[11px] text-chalk-600">checking {name}…</span>;
  }
  if (status === "error") {
    return (
      <span
        className="text-[11px] text-chalk-600"
        title={`Could not reach ${name}. Contract values below are still accurate; only the live selections are missing.`}
      >
        {name} unreachable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-accent">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      live from {name}
    </span>
  );
}

/**
 * Is a given matchup settled enough to state facts about its score?
 *
 * FOUR TIERS, WHICHEVER LANDS FIRST. Each can only ever be late, never early, so
 * taking the earliest is safe and taking the latest is needlessly coy:
 *
 *   this matchup's starters have all finished playing   Sunday night
 *   every NFL game in the week is over                  Monday night
 *   the platform has called this matchup                Tuesday
 *   the platform has scored the whole week              Tuesday
 *
 * THE FIRST TIER IS THE POINT OF THIS. Most matchups have nobody in the Monday
 * night game, so their result is known on Sunday evening — a day and a half
 * before `last_scored_leg` moves. See `lib/live/nfl-schedule.ts`.
 *
 * AN INCOMPLETE STARTER LIST IS NEVER SETTLED. `startedTeams` is short whenever a
 * starter could not be resolved to an NFL team, and a short list is
 * indistinguishable from one whose missing player is mid-game — so tier one only
 * fires when BOTH sides reported teams, and otherwise falls through to the
 * slower tiers rather than guessing.
 *
 * Returns a PREDICATE rather than a flag, because the answer is per matchup even
 * though two of its inputs are not.
 */
export function useMatchupSettled(
  live: LiveSeason | null,
): (m: LiveMatchup) => boolean {
  const inSeason = live?.seasonType === "regular" || live?.seasonType === "post";
  const week = live?.week ?? 0;
  const season = live?.season ?? 0;
  // `week > 0` guards the no-data case, where both sides are 0 and a bare `>=`
  // would call an unknown week settled.
  const scored = week > 0 && (live?.lastScoredLeg ?? 0) >= week;

  /**
   * The week's games, STAMPED WITH THE WEEK THEY ARE ABOUT.
   *
   * Carrying last week's answer into this one would put chips on an unplayed
   * game — the exact failure this guards against — and clearing it in the effect
   * is a cascading render. Storing the key alongside makes a stale value
   * unreadable rather than relying on a reset arriving in time.
   */
  const [slate, setSlate] = useState<{ key: string; wk: NflWeekState } | null>(null);
  const key = `${season}:${week}`;

  /**
   * Only asked in the window where it can change the answer: before kickoff
   * there is nothing to settle, and once the platform has scored the week its
   * own marker is already sufficient. So a reader outside a live week never
   * downloads the schedule at all.
   *
   * NEVER UNDER A PHASE MOCK. The mocks replay a FINISHED season, so the real
   * NFL clock says every one of their weeks ended months ago — consulting it
   * would settle a mocked `weekLive` on the spot and make the one phase that
   * exists to show games in progress impossible to look at.
   */
  const ask = Boolean(inSeason && week > 0 && !scored && !mockPhase());

  useEffect(() => {
    if (!ask) return;
    let cancelled = false;
    fetchNflWeek(season, week)
      .then((wk) => {
        if (!cancelled && wk) setSlate({ key, wk });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ask, key, season, week]);

  const wk = slate?.key === key ? slate.wk : null;

  return (m: LiveMatchup) => {
    if (m.final === true || scored) return true;
    if (!wk) return false;
    if (wk.final) return true;
    // Both sides, or neither: a matchup is only over when nobody on it is still
    // playing, and one side's silence says nothing about the other's.
    const a = teamsSettled(wk, m.a.startedTeams);
    const b = teamsSettled(wk, m.b.startedTeams);
    return a === true && b === true;
  };
}

/**
 * Every week's scoreboard so far, keyed by week.
 *
 * For the season being PLAYED, where none of this is archived yet: derive only
 * builds finalized seasons, so a live season has no `matchups.json` behind it
 * and the week-by-week board can only come from the provider.
 *
 * Fails soft to `{}` — the panel above it renders its own empty state, which is
 * also the honest answer in the week before kickoff.
 */
export function useSeasonGames(
  ref: LeagueRef | null,
  throughWeek: number,
): Record<number, LiveWeekGame[]> {
  const [games, setGames] = useState<Record<number, LiveWeekGame[]>>({});
  const key = `${refKey(ref)}:${throughWeek}`;

  useEffect(() => {
    const provider = providerFor(ref);
    if (!ref || !provider || throughWeek < 1) return;
    let cancelled = false;
    provider
      .seasonGames(ref.id, ref.season, throughWeek)
      .then((g) => {
        if (!cancelled) setGames(g);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // `key` stands in for `ref`, a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return games;
}
