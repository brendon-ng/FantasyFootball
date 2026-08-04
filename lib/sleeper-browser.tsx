"use client";

/**
 * Browser-side Sleeper access.
 *
 * Separate from `lib/sleeper.ts`, which is build-time only and pulls in Node
 * assumptions. This module must stay dependency-free so it can ship to the
 * client without dragging the data layer along.
 *
 * Fetching from the browser works because Sleeper sends
 * `access-control-allow-origin: *`. That is what makes a no-server site on
 * GitHub Pages able to show data fresher than its last deploy.
 */

import { useEffect, useState } from "react";

/** Same base as lib/sleeper.ts, repeated because this module must stay dependency-free. */
const BASE = "https://api.sleeper.app/v1";

import {
  mockCompletedDraftDate,
  mockDraftDate,
  mockDraftOrder,
  orderIsSet,
} from "@/lib/draft-slots";
import { applyPhaseMock, type Replay } from "@/lib/phase-mock";
import { withBasePath } from "@/lib/base-path";
import { draftMocks, mockPhase, mockWeek } from "@/lib/sticky-params";
import type { LiveMatchup, LiveSeason, LiveTeam, SeasonType } from "@/lib/types";

export interface LiveRoster {
  rosterId: number;
  ownerId: string | null;
  coOwners: string[];
  /** player_ids the team has currently locked in as keepers. Empty until they choose. */
  keepers: string[];
  players: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  waiverBudgetUsed: number;
}

export type LiveState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

interface RawRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  keepers: string[] | null;
  players: string[] | null;
  settings: {
    wins: number; losses: number; ties: number;
    fpts?: number; fpts_decimal?: number; waiver_budget_used?: number;
  };
}

/**
 * Live rosters for a league, fetched in the browser.
 *
 * Deliberately fails soft: a Sleeper outage leaves the page showing its baked
 * data rather than an error screen, because everything on the page is still
 * correct — just not annotated with what changed since the last build.
 */
export function useLiveRosters(leagueId: string | null): LiveState<LiveRoster[]> {
  const [state, setState] = useState<LiveState<LiveRoster[]>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!leagueId) return;
    // Guards against a stale response landing after a newer request.
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as RawRoster[] | null;
        if (cancelled) return;

        setState({
          status: "ready",
          error: null,
          data: (raw ?? []).map((r) => ({
            rosterId: r.roster_id,
            ownerId: r.owner_id,
            coOwners: r.co_owners ?? [],
            keepers: r.keepers ?? [],
            players: r.players ?? [],
            wins: r.settings.wins,
            losses: r.settings.losses,
            ties: r.settings.ties,
            pointsFor: Number(
              ((r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100).toFixed(2),
            ),
            waiverBudgetUsed: r.settings.waiver_budget_used ?? 0,
          })),
        });
      } catch (err) {
        if (!cancelled) {
          setState({ status: "error", data: null, error: String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // "No league configured" is a known-empty result, not a pending fetch. Deriving
  // it beats setting state inside the effect, which triggers a cascading render.
  if (!leagueId) return { status: "ready", data: [], error: null };

  return state;
}

export interface LiveTradedPick {
  season: string;
  round: number;
  /** Roster the pick originally belonged to. */
  rosterId: number;
  currentOwnerRosterId: number;
}

/**
 * Traded picks for a season, fetched in the browser.
 *
 * Sleeper only returns picks that have MOVED. Every other pick still sits with
 * the roster that originally owned it, so the full picture is a baseline of
 * rounds 1..N per roster with these applied on top.
 */
export function useLiveTradedPicks(leagueId: string | null): LiveState<LiveTradedPick[]> {
  const [state, setState] = useState<LiveState<LiveTradedPick[]>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as Array<{
          season: string;
          round: number;
          roster_id: number;
          owner_id: number;
        }> | null;
        if (cancelled) return;
        setState({
          status: "ready",
          error: null,
          // Every season, not just the next one — Sleeper returns future years
          // here too, and that is the only signal that a future draft's picks
          // have started moving.
          data: (raw ?? []).map((p) => ({
              season: p.season,
              round: p.round,
              rosterId: p.roster_id,
              currentOwnerRosterId: p.owner_id,
            })),
        });
      } catch (err) {
        if (!cancelled) setState({ status: "error", data: null, error: String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (!leagueId) return { status: "ready", data: [], error: null };
  return state;
}

/** Small badge describing where the live layer stands. */
export function LiveStatus({ status }: { status: LiveState<unknown>["status"] }) {
  if (status === "loading") {
    return <span className="text-[11px] text-chalk-600">checking Sleeper…</span>;
  }
  if (status === "error") {
    return (
      <span
        className="text-[11px] text-chalk-600"
        title="Could not reach Sleeper. Contract values below are still accurate; only the live selections are missing."
      >
        Sleeper unreachable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-accent">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      live from Sleeper
    </span>
  );
}

export interface LiveDraft {
  draftId: string;
  status: string;
  type: string;
  rounds: number;
  teams: number;
  reversalRound: number;
  /** Slot -> roster. Meaningless until `orderSet`; see lib/draft-slots.ts. */
  slotToRoster: Record<number, number>;
  /** True once the order has actually been drawn — or stood in for. */
  orderSet: boolean;
  /** True when `?mockDraftOrder=true` supplied the order. Surface it. */
  mocked: boolean;
  startTime: number | null;
}

/**
 * The upcoming draft, fetched in the browser.
 *
 * Two requests: the league, then its `draft_id`. Deliberately NOT
 * `/league/:id/drafts`, which returns abandoned drafts alongside the real one —
 * the 2024 league carries two — and omits `slot_to_roster_id` entirely.
 *
 * Live because none of this is settled until the draft runs: the order is drawn
 * after the keeper deadline, and picks are traded up to the last minute. It gets
 * committed to `data/<slug>/derived/drafts.json` once the draft completes.
 */
export function useLiveDraft(leagueId: string | null): LiveState<LiveDraft | null> {
  const [state, setState] = useState<LiveState<LiveDraft | null>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    (async () => {
      try {
        const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
        if (!leagueRes.ok) throw new Error(`HTTP ${leagueRes.status}`);
        const league = (await leagueRes.json()) as { draft_id?: string | null } | null;
        const draftId = league?.draft_id;
        if (!draftId) {
          if (!cancelled) setState({ status: "ready", data: null, error: null });
          return;
        }

        const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as {
          draft_id: string;
          status: string;
          type: string;
          start_time: number | null;
          draft_order: Record<string, number> | null;
          slot_to_roster_id: Record<string, number> | null;
          settings?: { rounds?: number; teams?: number; reversal_round?: number };
        } | null;
        if (cancelled || !raw) {
          if (!cancelled) setState({ status: "ready", data: null, error: null });
          return;
        }

        let slotToRoster: Record<number, number> = {};
        for (const [slot, roster] of Object.entries(raw.slot_to_roster_id ?? {})) {
          slotToRoster[Number(slot)] = roster;
        }
        // Every mock below only ever fills in a MISSING value, so once Sleeper
        // has the real thing the flags quietly stop doing anything.
        const flags = draftMocks();
        let status = raw.status;
        let orderSet = orderIsSet(raw.draft_order, slotToRoster);
        let startTime = raw.start_time ?? null;
        const wantsOrder = !orderSet && flags.order;
        const wantsComplete = status !== "complete" && flags.complete;
        const mocked = wantsOrder || wantsComplete;

        if (wantsOrder) {
          slotToRoster = mockDraftOrder(slotToRoster, raw.draft_id);
          orderSet = true;
        }
        if (wantsComplete) {
          status = "complete";
          // Backdated, so the keeper deadline reads as closed and picks frozen.
          startTime = mockCompletedDraftDate();
        } else if (wantsOrder) {
          // A date as well as an order: the two are set together in practice, and
          // the home page needs both to say anything. Two weeks out, so the keeper
          // deadline still lands in the future.
          startTime ??= mockDraftDate();
        }
        setState({
          status: "ready",
          error: null,
          data: {
            draftId: raw.draft_id,
            status,
            type: raw.type,
            rounds: raw.settings?.rounds ?? 0,
            teams: raw.settings?.teams ?? Object.keys(slotToRoster).length,
            reversalRound: raw.settings?.reversal_round ?? 0,
            slotToRoster,
            orderSet,
            mocked,
            startTime,
          },
        });
      } catch (e) {
        // Fails soft, like the other hooks: the page keeps its baked content.
        if (!cancelled) {
          setState({ status: "error", data: null, error: (e as Error).message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (!leagueId) return { status: "ready", data: null, error: null };
  return state;
}

/**
 * The in-progress season, refreshed in the browser.
 *
 * Mirrors `getLiveSeason()` in lib/data.ts, which produces the same shape at
 * BUILD time. The build-time value is passed in as `initial` and rendered
 * immediately, so this never shows a loading state and never blanks the page
 * when Sleeper is down — it only ever replaces a good value with a fresher one.
 *
 * Worth having despite the 15-minute game-window rebuilds: standings and rosters
 * tolerate being a quarter-hour stale, but a live score does not.
 *
 * Takes the whole season -> leagueId map rather than one id, because the NFL
 * state decides which season is current. In September that flips to a league
 * Sleeper only just created, and the map is what `sync` keeps current.
 */
export function useLiveSeason(
  leagueIdBySeason: Record<string, string>,
  initial: LiveSeason | null,
): LiveSeason | null {
  const [live, setLive] = useState<LiveSeason | null>(initial);
  const [replay, setReplay] = useState<Replay | null>(null);

  // Only when a mock is on: a real visitor never downloads the replay.
  useEffect(() => {
    if (!mockPhase()) return;
    let cancelled = false;
    fetch(withBasePath(`/mock/${process.env.NEXT_PUBLIC_LEAGUE ?? "den-ops"}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!cancelled) setReplay(r as Replay | null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const state = (await (await fetch(`${BASE}/state/nfl`)).json()) as {
          season: string;
          season_type: SeasonType;
          week: number;
          display_week: number;
        } | null;
        if (!state) return;
        const leagueId = leagueIdBySeason[state.season];
        if (!leagueId) return;

        const [league, users, rosters] = await Promise.all([
          fetch(`${BASE}/league/${leagueId}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${BASE}/league/${leagueId}/users`).then((r) => (r.ok ? r.json() : [])),
          fetch(`${BASE}/league/${leagueId}/rosters`).then((r) => (r.ok ? r.json() : [])),
        ]);
        if (!league || !rosters?.length) return;

        const slugByRoster = initialSlugMap(initial);
        const teamNameByUser = new Map<string, string>(
          (users ?? []).map((u: RawUser) => [
            u.user_id,
            u.metadata?.team_name ?? u.display_name,
          ]),
        );

        const teams: LiveTeam[] = (rosters as RawRosterFull[]).map((r) => ({
          ownerSlug: slugByRoster.get(r.roster_id) ?? `roster-${r.roster_id}`,
          rosterId: r.roster_id,
          teamName: r.owner_id ? (teamNameByUser.get(r.owner_id) ?? null) : null,
          wins: r.settings.wins,
          losses: r.settings.losses,
          ties: r.settings.ties,
          pointsFor: round2((r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100),
          pointsAgainst: round2(
            (r.settings.fpts_against ?? 0) + (r.settings.fpts_against_decimal ?? 0) / 100,
          ),
          waiverBudgetUsed: r.settings.waiver_budget_used ?? 0,
          players: r.players ?? [],
          starters: r.starters ?? [],
        }));

        const week = Math.max(1, state.display_week || state.week || 1);
        let matchups: LiveMatchup[] = [];
        if (state.season_type === "regular" || state.season_type === "post") {
          const raw = (await fetch(`${BASE}/league/${leagueId}/matchups/${week}`).then((r) =>
            r.ok ? r.json() : [],
          )) as RawMatchup[];
          const byId = new Map<number, RawMatchup[]>();
          for (const m of raw ?? []) {
            if (m.matchup_id == null) continue;
            byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m]);
          }
          const slugOf = (rid: number) =>
            teams.find((t) => t.rosterId === rid)?.ownerSlug ?? `roster-${rid}`;
          matchups = [...byId.entries()]
            .filter(([, pair]) => pair.length === 2)
            .map(([matchupId, [x, y]]) => ({
              matchupId,
              a: { ownerSlug: slugOf(x.roster_id), points: round2(x.points ?? 0) },
              b: { ownerSlug: slugOf(y.roster_id), points: round2(y.points ?? 0) },
            }));
        }

        if (cancelled) return;
        setLive(applyPhaseMock({
          season: Number(state.season),
          week,
          displayWeek: state.display_week,
          seasonType: state.season_type,
          status: league.status,
          teams,
          matchups,
          unavailable: false,
          lastScoredLeg: league.settings?.last_scored_leg ?? null,
        }, mockPhase(), replay, mockWeek()));
      } catch {
        // Fails soft: `initial` stays on screen. A Sleeper outage should not
        // blank the page, it should just stop it getting fresher.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueIdBySeason, initial, replay]);

  return live;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * roster_id -> owner slug, recovered from the baked value.
 *
 * The browser has no access to `config/leagues/*`, and the build already did this
 * resolution — including co-owners — so the mapping is lifted from `initial`
 * rather than duplicated.
 *
 * KEYED ON ROSTER, not user. Keying it on roster id and then looking it up by
 * `owner_id` silently missed every time, and the whole page rendered "roster-1",
 * "roster-2" in place of names — in a real season, not just under a mock.
 */
function initialSlugMap(initial: LiveSeason | null): Map<number, string> {
  return new Map((initial?.teams ?? []).map((t) => [t.rosterId, t.ownerSlug]));
}

interface RawUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
}

interface RawRosterFull {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  settings: {
    wins: number; losses: number; ties: number;
    fpts?: number; fpts_decimal?: number;
    fpts_against?: number; fpts_against_decimal?: number;
    waiver_budget_used?: number;
  };
}

interface RawMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number | null;
}
