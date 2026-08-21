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
import type { LiveSeason } from "@/lib/types";

import { espnProvider } from "./espn.ts";
import { sleeperProvider } from "./sleeper.ts";
import type {
  LeagueMove,
  LiveDraft,
  LiveMove,
  LiveProvider,
  LiveRoster,
  LiveState,
  LiveTradedPick,
} from "./types.ts";

export type {
  LeagueMove,
  LiveDraft,
  LiveMove,
  LiveRoster,
  LiveState,
  LiveTradedPick,
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
