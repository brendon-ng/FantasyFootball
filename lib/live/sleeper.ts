/**
 * Sleeper, behind the live provider interface.
 *
 * Lifted verbatim out of the old `lib/sleeper-browser.tsx`; the fetches and the
 * field-by-field mapping are unchanged, only the shape of the module moved.
 *
 * Separate from `lib/sleeper.ts`, which is build-time only and pulls in Node
 * assumptions. This module must stay dependency-free so it can ship to the
 * client without dragging the data layer along.
 *
 * Fetching from the browser works because Sleeper sends
 * `access-control-allow-origin: *`. That is what makes a no-server site on
 * GitHub Pages able to show data fresher than its last deploy.
 */

import { orderIsSet } from "../draft-slots.ts";

import { fetchRetry } from "./retry.ts";
import type { LiveMatchup, LiveSeason, LiveTeam, SeasonType } from "../types.ts";

import {
  round2,
  type LiveProvider,
  type LiveRoster,
  type LiveTradedPick,
  type ProviderState,
  type RawDraft,
  type SeasonContext,
} from "./types.ts";

const BASE = "https://api.sleeper.app/v1";

const json = async <T,>(url: string, fallback: T): Promise<T> => {
  const res = await fetchRetry(url);
  return res?.ok ? ((await res.json()) as T) : fallback;
};

interface RawRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  keepers: string[] | null;
  players: string[] | null;
  starters?: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
  };
}

interface RawUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string } | null;
}

interface RawMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number | null;
}

interface RawTxn {
  type: string;
  status: string;
  status_updated: number;
  created: number;
  leg: number;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
}

export const sleeperProvider: LiveProvider = {
  name: "Sleeper",

  async state() {
    const st = await json<{
      season: string;
      season_type: SeasonType;
      week: number;
      display_week: number;
    } | null>(`${BASE}/state/nfl`, null);
    if (!st) return null;
    return {
      season: Number(st.season),
      week: Math.max(1, st.display_week || st.week || 1),
      displayWeek: st.display_week,
      seasonType: st.season_type,
    };
  },

  async rosters(id) {
    const res = await fetchRetry(`${BASE}/league/${id}/rosters`);
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? "unreachable"}`);
    const raw = ((await res.json()) as RawRoster[] | null) ?? [];
    return raw.map((r) => ({
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      coOwners: r.co_owners ?? [],
      keepers: r.keepers ?? [],
      players: r.players ?? [],
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
      pointsFor: round2((r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100),
      waiverBudgetUsed: r.settings.waiver_budget_used ?? 0,
    })) satisfies LiveRoster[];
  },

  /**
   * Sleeper only returns picks that have MOVED. Every other pick still sits with
   * the roster that originally owned it, so the full picture is a baseline of
   * rounds 1..N per roster with these applied on top.
   */
  async tradedPicks(id) {
    const res = await fetchRetry(`${BASE}/league/${id}/traded_picks`);
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? "unreachable"}`);
    const raw =
      ((await res.json()) as Array<{
        season: string;
        round: number;
        roster_id: number;
        owner_id: number;
      }> | null) ?? [];
    // Every season, not just the next one — Sleeper returns future years here
    // too, and that is the only signal that a future draft's picks have started
    // moving.
    return raw.map((p) => ({
      season: p.season,
      round: p.round,
      rosterId: p.roster_id,
      currentOwnerRosterId: p.owner_id,
    })) satisfies LiveTradedPick[];
  },

  /**
   * Two requests: the league, then its `draft_id`. Deliberately NOT
   * `/league/:id/drafts`, which returns abandoned drafts alongside the real one
   * — the 2024 league carries two — and omits `slot_to_roster_id` entirely.
   */
  async draft(id) {
    const leagueRes = await fetchRetry(`${BASE}/league/${id}`);
    if (!leagueRes?.ok) throw new Error(`HTTP ${leagueRes?.status ?? "unreachable"}`);
    const league = (await leagueRes.json()) as { draft_id?: string | null } | null;
    const draftId = league?.draft_id;
    if (!draftId) return null;

    const res = await fetchRetry(`${BASE}/draft/${draftId}`);
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? "unreachable"}`);
    const raw = (await res.json()) as {
      draft_id: string;
      status: string;
      type: string;
      start_time: number | null;
      draft_order: Record<string, number> | null;
      slot_to_roster_id: Record<string, number> | null;
      settings?: { rounds?: number; teams?: number; reversal_round?: number };
    } | null;
    if (!raw) return null;

    const slotToRoster: Record<number, number> = {};
    for (const [slot, roster] of Object.entries(raw.slot_to_roster_id ?? {})) {
      slotToRoster[Number(slot)] = roster;
    }
    return {
      draftId: raw.draft_id,
      status: raw.status,
      type: raw.type,
      rounds: raw.settings?.rounds ?? 0,
      teams: raw.settings?.teams ?? Object.keys(slotToRoster).length,
      reversalRound: raw.settings?.reversal_round ?? 0,
      slotToRoster,
      orderSet: orderIsSet(raw.draft_order, slotToRoster),
      startTime: raw.start_time ?? null,
    } satisfies RawDraft;
  },

  /**
   * Moves involving one player, from `fromWeek` onward.
   *
   * Sleeper pages transactions BY WEEK with no player filter, so this asks for
   * the next few weeks and discards everything not about this player. Failed
   * claims are dropped: a lost waiver is an attempt, not an event.
   */
  async weekGames(id, _season, week) {
    const raw = await json<RawMatchup[]>(`${BASE}/league/${id}/matchups/${week}`, []);
    const byId = new Map<number, Array<{ rosterId: number; points: number }>>();
    for (const m of raw ?? []) {
      if (m.matchup_id == null) continue;
      byId.set(m.matchup_id, [
        ...(byId.get(m.matchup_id) ?? []),
        { rosterId: m.roster_id, points: round2(m.points ?? 0) },
      ]);
    }
    return [...byId.entries()].map(([matchupId, sides]) => ({ matchupId, sides }));
  },

  async moves(id, _season, playerId, fromWeek, weeks) {
    const pages = await Promise.all(
      Array.from({ length: weeks }, (_, i) => fromWeek + i).map((w) =>
        json<RawTxn[]>(`${BASE}/league/${id}/transactions/${w}`, []).catch(() => [] as RawTxn[]),
      ),
    );
    return pages
      .flat()
      .filter(
        (t) =>
          t?.status === "complete" &&
          (t.adds?.[playerId] != null || t.drops?.[playerId] != null),
      )
      .map((t) => ({
        type: t.type ?? "free_agent",
        week: t.leg,
        ts: t.status_updated || t.created,
        toRosterId: t.adds?.[playerId] ?? null,
        fromRosterId: t.drops?.[playerId] ?? null,
      }));
  },

  /** Every completed move in the probed weeks, whole rather than per-player. */
  async leagueMoves(id, _season, fromWeek, weeks) {
    const pages = await Promise.all(
      Array.from({ length: weeks }, (_, i) => fromWeek + i).map((w) =>
        json<RawTxn[]>(`${BASE}/league/${id}/transactions/${w}`, []).catch(() => [] as RawTxn[]),
      ),
    );
    return pages
      .flat()
      .filter((t) => t?.status === "complete")
      .map((t) => ({
        type: t.type,
        week: t.leg,
        ts: t.status_updated || t.created,
        adds: t.adds ?? {},
        drops: t.drops ?? {},
      }));
  },

  async season(id, st: ProviderState, ctx: SeasonContext): Promise<LiveSeason | null> {
    const [league, users, rosters] = await Promise.all([
      json<{ status?: string; settings?: { last_scored_leg?: number } } | null>(
        `${BASE}/league/${id}`,
        null,
      ),
      json<RawUser[]>(`${BASE}/league/${id}/users`, []),
      json<RawRoster[]>(`${BASE}/league/${id}/rosters`, []),
    ]);
    if (!league || !rosters?.length) return null;

    const teamNameByUser = new Map(
      (users ?? []).map((u) => [u.user_id, u.metadata?.team_name ?? u.display_name]),
    );

    /**
     * The primary owner comes from the BAKED season, keyed by roster id, so a
     * roster whose user is not in config still gets its name. Co-owners have
     * only user ids on the roster payload, so they go through the map.
     *
     * FALLS BACK TO THE USER MAP because this runs in two places. In the
     * browser `slugByRoster` is lifted from the server-rendered page and is
     * complete; at BUILD time there is no baked page yet, so the only route
     * from a roster to a person is its owner id.
     */
    const primaryOf = (r: RawRoster): string | undefined =>
      ctx.slugByRoster.get(r.roster_id) ??
      (r.owner_id ? ctx.userIdToSlug[r.owner_id] : undefined);

    const creditedSlugs = (r: RawRoster): string[] => {
      const out: string[] = [];
      const primary = primaryOf(r);
      if (primary) out.push(primary);
      for (const uid of r.co_owners ?? []) {
        const slug = ctx.userIdToSlug[uid];
        if (slug && !out.includes(slug)) out.push(slug);
      }
      return out;
    };

    const teams: LiveTeam[] = rosters.map((r) => ({
      ownerSlug: primaryOf(r) ?? `roster-${r.roster_id}`,
      ownerSlugs: creditedSlugs(r),
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

    let matchups: LiveMatchup[] = [];
    if (st.seasonType === "regular" || st.seasonType === "post") {
      const raw = await json<RawMatchup[]>(`${BASE}/league/${id}/matchups/${st.week}`, []);
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

    return {
      season: st.season,
      week: st.week,
      displayWeek: st.displayWeek,
      seasonType: st.seasonType,
      status: league.status ?? "unknown",
      teams,
      matchups,
      unavailable: false,
      lastScoredLeg: league.settings?.last_scored_leg ?? null,
    };
  },
};
