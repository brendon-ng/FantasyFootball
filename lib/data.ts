/**
 * Build-time data access.
 *
 * Every function here runs during `next build` (Server Components only) and
 * reads the committed JSON in `data/`. Nothing in this module reaches the
 * browser, so reading from disk with `node:fs` is safe and avoids bundling the
 * whole dataset into the client payload.
 *
 * Live in-progress data is fetched in `getLiveSeason()`, also at build time —
 * the site is redeployed on a schedule, so "live" means "as of the last build".
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getRosters,
  getState,
  type SleeperState,
} from "./sleeper.ts";
import type {
  DraftPickRecord,
  KeeperContract,
  LeagueRecords,
  Matchup,
  Owner,
  OwnerRecord,
  PlayerMeta,
  PlayerTransaction,
  SeasonKeepers,
  SeasonSummary,
} from "./types.ts";

const DATA = join(process.cwd(), "data");
const CONFIG = join(process.cwd(), "config");

function load<T>(relPath: string, fallback: T): T {
  const p = join(DATA, relPath);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export const getOwners = (): Owner[] => load("derived/owners.json", []);
export const getSeasons = (): SeasonSummary[] => load("derived/seasons.json", []);
export const getMatchupHistory = (): Matchup[] => load("derived/matchups.json", []);
export const getOwnerRecords = (): OwnerRecord[] => load("derived/owner-records.json", []);
export const getPlayers = (): Record<string, PlayerMeta> => load("players.json", {});
export const getDrafts = (): DraftPickRecord[] => load("derived/drafts.json", []);
export const getPlayerHistory = (): Record<string, PlayerTransaction[]> =>
  load("derived/player-history.json", {});

export const getRecords = (): LeagueRecords =>
  load("derived/records.json", {
    weeklyHigh: [], weeklyLow: [], playerHigh: [], biggestBlowout: [], narrowestWin: [],
  });

export const getKeepers = (): { perSeason: SeasonKeepers[]; final: KeeperContract[] } =>
  load("derived/keepers.json", { perSeason: [], final: [] });

export interface LeagueConfig {
  leagueName: string;
  shortName: string;
  knownLeagueIds: Record<string, string>;
}
export const getConfig = (): LeagueConfig =>
  JSON.parse(readFileSync(join(CONFIG, "league.json"), "utf8"));

export function getOwnerMap(): Map<string, Owner> {
  return new Map(getOwners().map((o) => [o.slug, o]));
}

// ---------------------------------------------------------------------------
// Live (in-progress) season
// ---------------------------------------------------------------------------

export interface LiveTeam {
  ownerSlug: string;
  rosterId: number;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  waiverBudgetUsed: number;
  players: string[];
  starters: string[];
}

export interface LiveMatchup {
  matchupId: number;
  a: { ownerSlug: string; points: number };
  b: { ownerSlug: string; points: number };
}

export interface LiveSeason {
  season: number;
  week: number;
  displayWeek: number;
  seasonType: SleeperState["season_type"];
  status: string;
  teams: LiveTeam[];
  matchups: LiveMatchup[];
  /** True when the build could not reach Sleeper; the UI degrades gracefully. */
  unavailable: boolean;
}

/**
 * Fetches the in-progress season at build time.
 *
 * Never throws: a Sleeper outage during a scheduled rebuild should ship a site
 * with history intact and the live panel hidden, not fail the deploy.
 */
export async function getLiveSeason(): Promise<LiveSeason | null> {
  const empty = (season: number): LiveSeason => ({
    season, week: 0, displayWeek: 0, seasonType: "off",
    status: "unknown", teams: [], matchups: [], unavailable: true,
  });

  try {
    const cfg = getConfig();
    const state = await getState();
    if (!state) return null;

    const season = Number(state.season);
    const leagueId = cfg.knownLeagueIds[String(season)];
    if (!leagueId) return null;

    // If this season is already finalized in committed data, there is nothing live.
    if (getSeasons().some((s) => s.season === season && s.finalized)) return null;

    const [league, users, rosters] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
      getRosters(leagueId),
    ]);
    if (!league || !rosters) return empty(season);

    const ownerBySlug = new Map(
      getOwners().flatMap((o) => [[o.userId, o.slug] as const]),
    );
    // Co-owners resolve through config, which derive.ts already collapsed, so
    // fall back to matching on the roster's own owner_id.
    const teamNameByUser = new Map(
      (users ?? []).map((u) => [u.user_id, u.metadata?.team_name ?? u.display_name]),
    );

    const teams: LiveTeam[] = rosters.map((r) => ({
      ownerSlug: (r.owner_id && ownerBySlug.get(r.owner_id)) || `roster-${r.roster_id}`,
      rosterId: r.roster_id,
      teamName: r.owner_id ? (teamNameByUser.get(r.owner_id) ?? null) : null,
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
      pointsFor: Number(
        ((r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100).toFixed(2),
      ),
      pointsAgainst: Number(
        ((r.settings.fpts_against ?? 0) + (r.settings.fpts_against_decimal ?? 0) / 100).toFixed(2),
      ),
      waiverBudgetUsed: r.settings.waiver_budget_used ?? 0,
      players: r.players ?? [],
      starters: r.starters ?? [],
    }));

    // Pre-draft and pre-week-1 states have no meaningful matchups.
    const week = Math.max(1, state.display_week || state.week || 1);
    let matchups: LiveMatchup[] = [];
    if (state.season_type === "regular" || state.season_type === "post") {
      const raw = (await getMatchups(leagueId, week)) ?? [];
      const byId = new Map<number, typeof raw>();
      for (const m of raw) {
        if (m.matchup_id == null) continue;
        byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m]);
      }
      const slugOf = (rid: number) =>
        teams.find((t) => t.rosterId === rid)?.ownerSlug ?? `roster-${rid}`;
      matchups = [...byId.entries()]
        .filter(([, pair]) => pair.length === 2)
        .map(([matchupId, [x, y]]) => ({
          matchupId,
          a: { ownerSlug: slugOf(x.roster_id), points: Number((x.points ?? 0).toFixed(2)) },
          b: { ownerSlug: slugOf(y.roster_id), points: Number((y.points ?? 0).toFixed(2)) },
        }));
    }

    return {
      season,
      week,
      displayWeek: state.display_week,
      seasonType: state.season_type,
      status: league.status,
      teams,
      matchups,
      unavailable: false,
    };
  } catch {
    // Swallow deliberately — see docstring.
    return null;
  }
}
