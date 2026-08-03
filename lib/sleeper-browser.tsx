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
