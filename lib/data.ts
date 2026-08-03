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
  BracketMatch,
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

// ---------------------------------------------------------------------------
// ADP
// ---------------------------------------------------------------------------

export interface AdpEntry {
  rank: number;
  name: string;
  team: string | null;
  consensus: number | null;
  /** Sleeper ADP as an overall pick number, e.g. 15.4. */
  sleeper: number | null;
  playerId: string | null;
  position: string | null;
  /** `sleeper` converted to a round for this league's size. */
  round: number | null;
}

export interface AdpSnapshot {
  season: number;
  source: string;
  frozen: boolean;
  capturedAt: string;
  leagueTeams: number;
  entries: AdpEntry[];
}

/**
 * ADP for the upcoming season, keyed by Sleeper player_id.
 *
 * Two files with different authority: `<season>.json` is the frozen snapshot
 * that actually revalues expired contracts (bylaws 1.7.2.2.1), and `live.json`
 * is refreshed on every build purely so the UI can show current market value
 * before the deadline locks anything in.
 *
 * Baked at build time rather than fetched in the browser — beatadp sends no
 * CORS headers, so a client-side fetch is blocked outright, and the page is
 * 826KB of HTML that no one should download to read one column.
 */
export function getAdp(): {
  byPlayer: Map<string, AdpEntry>;
  frozen: boolean;
  capturedAt: string | null;
  season: number | null;
} {
  const season = Math.max(0, ...getSeasons().map((s) => s.season)) + 1;
  const frozen = load<AdpSnapshot | null>(`adp/${season}.json`, null);
  const snapshot = frozen ?? load<AdpSnapshot | null>("adp/live.json", null);

  const byPlayer = new Map<string, AdpEntry>();
  for (const e of snapshot?.entries ?? []) {
    if (e.playerId) byPlayer.set(e.playerId, e);
  }
  return {
    byPlayer,
    frozen: Boolean(frozen),
    capturedAt: snapshot?.capturedAt ?? null,
    season: snapshot?.season ?? null,
  };
}

/** One meeting between two owners, from either data era. */
export interface Meeting {
  season: number;
  week: number | null;
  kind: "regular" | "playoff" | "consolation";
  /** Bracket/game label where one exists, e.g. "Championship" or "GmC7". */
  label: string | null;
  a: MeetingSide;
  b: MeetingSide;
  /** Sleeper matchups carry lineups; imported ESPN games carry only scores. */
  hasLineups: boolean;
}

export interface MeetingSide {
  ownerSlug: string;
  points: number;
  starters: string[];
  playerPoints: Record<string, number>;
}

/**
 * Every recorded meeting between two owners, newest first.
 *
 * Pulls from BOTH eras. Sleeper weeks come from `matchups.json` with full
 * lineups; imported ESPN seasons have no weekly matchups at all, but their
 * playoff and ladder games were recovered with scores, so those meetings still
 * count. Reading only `matchups.json` under-reports the series — which is how
 * a page could show "2 meetings" beside a 1-3 record.
 *
 * Co-owned teams resolve through each season's owner set, so a game counts for
 * every owner on either side.
 */
export function getMeetings(slugA: string, slugB: string): Meeting[] {
  const seasons = getSeasons();
  const out: Meeting[] = [];

  // season:primarySlug -> everyone credited on that team
  const teamOwners = new Map<string, string[]>();
  for (const s of seasons) {
    for (const row of s.standings) teamOwners.set(`${s.season}:${row.ownerSlug}`, row.ownerSlugs);
  }
  const owns = (season: number, primary: string, who: string) =>
    (teamOwners.get(`${season}:${primary}`) ?? [primary]).includes(who);

  for (const m of getMatchupHistory()) {
    for (const [x, y] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      if (!owns(m.season, x.ownerSlug, slugA) || !owns(m.season, y.ownerSlug, slugB)) continue;
      out.push({
        season: m.season,
        week: m.week,
        kind: m.kind,
        label: null,
        a: { ownerSlug: x.ownerSlug, points: x.points, starters: x.starters, playerPoints: x.playerPoints },
        b: { ownerSlug: y.ownerSlug, points: y.points, starters: y.starters, playerPoints: y.playerPoints },
        hasLineups: true,
      });
      break;
    }
  }

  for (const s of seasons) {
    if (!s.imported) continue;
    const brackets: Array<[BracketMatch[], Meeting["kind"]]> = [
      [s.winnersBracket, "playoff"],
      [s.losersBracket, "consolation"],
      ...s.extraBrackets.map((b) => [b.matches, "consolation"] as [BracketMatch[], Meeting["kind"]]),
    ];
    for (const [matches, kind] of brackets) {
      for (const bm of matches) {
        if (!bm.team1 || !bm.team2) continue;
        for (const [t1, t2] of [
          [bm.team1, bm.team2],
          [bm.team2, bm.team1],
        ] as const) {
          if (!owns(s.season, t1, slugA) || !owns(s.season, t2, slugB)) continue;
          const p1 = bm.points[t1];
          const p2 = bm.points[t2];
          if (p1 == null || p2 == null) continue;
          out.push({
            season: s.season,
            week: bm.week,
            kind,
            label: bm.label ?? (bm.placesFor ? `${bm.placesFor[0]}th place` : null),
            a: { ownerSlug: t1, points: p1, starters: [], playerPoints: {} },
            b: { ownerSlug: t2, points: p2, starters: [], playerPoints: {} },
            hasLineups: false,
          });
          break;
        }
      }
    }
  }

  return out.sort((x, y) => y.season - x.season || (y.week ?? 0) - (x.week ?? 0));
}

/** One instance of a player being retained, taken from that season's draft. */
export interface KeepEvent {
  season: number;
  ownerSlug: string | null;
  round: number;
  pickNo: number;
  playerId: string;
}

/**
 * Every keeper ever declared, from the draft record.
 *
 * Sourced from `isKeeper` on draft picks rather than from contract state,
 * because a pick is a fact about what happened while a contract is a derived
 * assertion about what a player is worth. Only seasons with a Sleeper draft can
 * contribute — the imported ESPN seasons kept no draft data at all — so this
 * currently begins at 2025, the league's first keeper year.
 */
export function getKeepHistory(): KeepEvent[] {
  return getDrafts()
    .filter((p) => p.isKeeper)
    .map((p) => ({
      season: p.season,
      ownerSlug: p.ownerSlug,
      round: p.round,
      pickNo: p.pickNo,
      playerId: p.playerId,
    }))
    .sort((a, b) => b.season - a.season || a.round - b.round || a.pickNo - b.pickNo);
}

/** Keep events for one player, oldest first. */
export function getPlayerKeepHistory(playerId: string): KeepEvent[] {
  return getKeepHistory()
    .filter((k) => k.playerId === playerId)
    .sort((a, b) => a.season - b.season);
}
