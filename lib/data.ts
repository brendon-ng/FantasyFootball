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
  WeeklyLow,
} from "./types.ts";

/**
 * The league this build serves.
 *
 * One build per league (see next.config.ts), so a single slug is correct for the
 * whole process — there is no request-scoped league to thread through. Adding a
 * league adds a build, not a code path.
 */
export const LEAGUE = process.env.LEAGUE ?? "den-ops";
const DATA = join(process.cwd(), "data", LEAGUE);
const SHARED_DATA = join(process.cwd(), "data");
const CONFIG = join(process.cwd(), "config", "leagues", LEAGUE);

function load<T>(relPath: string, fallback: T): T {
  const p = join(DATA, relPath);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export const getOwners = (): Owner[] => load("derived/owners.json", []);
export const getSeasons = (): SeasonSummary[] => load("derived/seasons.json", []);
export const getMatchupHistory = (): Matchup[] => load("derived/matchups.json", []);
export const getOwnerRecords = (): OwnerRecord[] => load("derived/owner-records.json", []);
/**
 * Slim player index, minus anyone the overrides ignore.
 *
 * Placeholder players drafted as keeper stand-ins are filtered here rather than
 * at sync time: `data/raw` stays a faithful record of what Sleeper actually
 * returned, and the correction lives in one declarative place.
 */
export const getPlayers = (): Record<string, PlayerMeta> => {
  const all = JSON.parse(readFileSync(join(SHARED_DATA, "players.json"), "utf8")) as Record<
    string,
    PlayerMeta
  >;
  // `data/players.json` is the union across leagues, so it must be narrowed to
  // the players THIS league references — otherwise every league would generate a
  // player page for the others' players, with no data on it.
  const mine = load<string[] | null>("raw/player-ids.json", null);
  const scoped = mine ? Object.fromEntries(mine.filter((id) => all[id]).map((id) => [id, all[id]])) : all;
  // Optional: only a keeper league needs corrections, and a league with nothing
  // to correct should not have to carry an empty file.
  const overridesPath = join(CONFIG, "keeper-overrides.json");
  const ignored = new Set(
    existsSync(overridesPath)
      ? ((JSON.parse(readFileSync(overridesPath, "utf8")) as { ignorePlayerIds?: string[] })
          .ignorePlayerIds ?? [])
      : [],
  );
  if (!ignored.size) return scoped;
  return Object.fromEntries(Object.entries(scoped).filter(([id]) => !ignored.has(id)));
};
export const getWeeklyLows = (): WeeklyLow[] => load("derived/weekly-lows.json", []);

/**
 * Lookup for "was this team the low scorer that week", keyed `season:week:slug`.
 *
 * Returns an EMPTY set unless the league attaches a punishment to it, so callers
 * do not each have to remember the flag — a league without the rule simply has no
 * low scorers to mark.
 */
export function getWeeklyLowKeys(): Set<string> {
  if (!features().weeklyLowPunishment) return new Set();
  return new Set(getWeeklyLows().map((w) => `${w.season}:${w.week}:${w.ownerSlug}`));
}

export const getDrafts = (): DraftPickRecord[] => load("derived/drafts.json", []);
export const getPlayerHistory = (): Record<string, PlayerTransaction[]> =>
  load("derived/player-history.json", {});

export const getRecords = (): LeagueRecords =>
  load("derived/records.json", {
    weeklyHigh: [], weeklyLow: [], playerHigh: [],
    biggestBlowout: [], narrowestWin: [],
    highestCombined: [], lowestCombined: [],
  });

export const getKeepers = (): { perSeason: SeasonKeepers[]; final: KeeperContract[] } =>
  load("derived/keepers.json", { perSeason: [], final: [] });

export interface LeagueFeatures {
  /** Keeper contracts, the keeper tracker, keeper history. */
  keepers: boolean;
  /** ADP capture, and the surplus-value column that depends on it. */
  adp: boolean;
  /** Pre-Sleeper seasons imported from archived ESPN pages. */
  espnImport: boolean;
  /**
   * The lowest-scoring team of each regular-season week does a punishment, so
   * the site marks who it was. Presentational only — the low scorer is a fact
   * either way, and derive records it for every league.
   */
  weeklyLowPunishment: boolean;
}
export interface LeagueConfig {
  slug: string;
  name: string;
  shortName: string;
  features: LeagueFeatures;
  knownLeagueIds: Record<string, string>;
}
export const getConfig = (): LeagueConfig =>
  JSON.parse(readFileSync(join(CONFIG, "league.json"), "utf8"));

/**
 * Feature flags for the league this build serves.
 *
 * Gates whole subsystems rather than scattering `if (slug === ...)` — a redraft
 * league should not show a Keepers tab at all, and asking "does this league keep
 * players" reads better than asking which league it is.
 */
export const features = (): LeagueFeatures => getConfig().features;

/** `"Records"` -> `"Records · Den Ops"`, so no page hardcodes a league name. */
export const pageTitle = (name: string): string => `${name} · ${getConfig().shortName}`;

/**
 * Everyone credited with a team-season, for a placement tile or headline.
 *
 * `SeasonSummary.champion` (and runnerUp/thirdPlace/lastPlace) is the PRIMARY
 * owner only, because a placement is a property of a team and a team has one
 * franchise key. But a co-owned team has two people who share the title equally,
 * and naming one of them is simply wrong.
 *
 * Co-owned teams render as first names ("Robbie & Thomas") because these tiles
 * are narrow; a solo owner keeps their full name, which fits.
 */
/**
 * The team-season this owner was part of, co-owned or not.
 *
 * `StandingsRow.ownerSlug` is only the PRIMARY owner, so matching on it alone
 * hides a co-owner's own seasons from their profile — Lauren co-owned 2021-23
 * with Olivia and those years vanished from her season-by-season table while
 * still appearing in her finish chart, which reads the credit list.
 */
export function teamSeasonFor<T extends { ownerSlug: string; ownerSlugs: string[] }>(
  standings: T[],
  slug: string,
): T | undefined {
  return standings.find((r) => (r.ownerSlugs?.length ? r.ownerSlugs : [r.ownerSlug]).includes(slug));
}

export function creditedNames(
  standings: Array<{ ownerSlug: string; ownerSlugs: string[] }>,
  primarySlug: string | null | undefined,
  fallback = "—",
): string {
  if (!primarySlug) return fallback;
  const owners = getOwnerMap();
  const row = standings.find((r) => r.ownerSlug === primarySlug);
  const slugs = row?.ownerSlugs?.length ? row.ownerSlugs : [primarySlug];
  if (slugs.length === 1) return owners.get(slugs[0])?.name ?? fallback;
  return slugs.map((sl) => owners.get(sl)?.firstName ?? sl).join(" & ");
}

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

/** One matchup between two owners, from either data era. */
export interface Meeting {
  /** Stable URL key: "<season>-<week>-<slugA>-vs-<slugB>", slugs sorted. */
  id: string;
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
 * Stable, readable key for one game.
 *
 * Owner slugs rather than Sleeper's matchup_id, which is only unique within a
 * week and would silently collide across seasons. Sorted so both directions
 * resolve to the same page.
 */
/**
 * Names the game a placement decides.
 *
 * "1th place" was a hardcoded "th"; place 1 is also not a placement game at all
 * but the championship, and the bottom place is the last-place game rather than
 * "12th place".
 */
function placementLabel(place: number, teams: number): string {
  if (place === 1) return "Championship";
  // THE toilet bowl is the single game that decides last place. Every other
  // postseason game among non-playoff teams is a consolation game.
  if (place >= teams) return "Toilet bowl";
  const s = ["th", "st", "nd", "rd"];
  const v = place % 100;
  return `${place}${s[(v - 20) % 10] || s[v] || s[0]} place`;
}

/**
 * What a postseason matchup decided, taken from that season's bracket.
 *
 * Sleeper's weekly matchups carry no placement, so a playoff week is otherwise
 * indistinguishable from any other. Matched on both teams and the week, since a
 * pairing can recur and a season runs several brackets at once.
 */
function bracketLabel(
  season: number,
  week: number,
  a: string,
  b: string,
): string | null {
  const s = getSeasons().find((x) => x.season === season);
  if (!s) return null;
  for (const matches of [s.winnersBracket, s.losersBracket, ...s.extraBrackets.map((x) => x.matches)]) {
    for (const m of matches) {
      if (m.week !== week || !m.team1 || !m.team2) continue;
      if (![m.team1, m.team2].every((t) => [a, b].includes(t))) continue;
      return m.placesFor ? placementLabel(m.placesFor[0], s.teams) : null;
    }
  }
  return null;
}

export function meetingId(
  season: number,
  week: number | null,
  a: string,
  b: string,
): string {
  return `${season}-${week ?? 0}-${[a, b].sort().join("-vs-")}`;
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
        id: meetingId(m.season, m.week, x.ownerSlug, y.ownerSlug),
        season: m.season,
        week: m.week,
        kind: m.kind,
        label: bracketLabel(m.season, m.week, x.ownerSlug, y.ownerSlug),
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
            id: meetingId(s.season, bm.week, t1, t2),
            season: s.season,
            week: bm.week,
            kind,
            label: bm.label ?? (bm.placesFor ? placementLabel(bm.placesFor[0], s.teams) : null),
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

/**
 * Every meeting in league history, for static generation.
 *
 * Deduped by id: `getMeetings` is written from one owner's perspective, so
 * calling it for both sides of a pair would yield the same game twice.
 */
export function getAllMeetings(): Meeting[] {
  const seen = new Map<string, Meeting>();
  const slugs = getOwners().map((o) => o.slug);
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      for (const m of getMeetings(slugs[i], slugs[j])) {
        if (!seen.has(m.id)) seen.set(m.id, m);
      }
    }
  }
  return [...seen.values()];
}

export interface AtTheTimeFlag {
  kind:
    | "weekly-high"
    | "weekly-low"
    | "blowout"
    | "narrowest"
    | "player-week"
    | "combined-high"
    | "combined-low";
  label: string;
  value: number;
  ownerSlug: string;
  /** Set for whole-game marks, where one name is only half the fact. */
  opponentSlug?: string;
  playerId?: string;
  /** Whether the mark still stands today. */
  stillStands: boolean;
}

/**
 * Records a game set the moment it was played, keyed by meeting id.
 *
 * Only #1 marks — the best or worst the league had seen at that point.
 */
export const getAtTheTime = (): Record<string, AtTheTimeFlag[]> =>
  load("derived/at-the-time.json", {});

// ---------------------------------------------------------------------------
// Record-book flags
// ---------------------------------------------------------------------------

export interface RecordFlag {
  /** Short chip text, e.g. "#3 weekly high". */
  short: string;
  /** Full sentence for a tooltip. */
  full: string;
  rank: number;
  tone: "good" | "bad";
  ownerSlug: string | null;
  /** Set for whole-game records, where naming one side is only half the fact. */
  opponentSlug?: string | null;
  playerId?: string;
}

const ordinalOf = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * Which record-book lists a given matchup appears in.
 *
 * Ranks come from the same arrays the record book renders, so a chip here and a
 * row there can never disagree — recomputing thresholds separately would let
 * them drift the moment the list length or tie-breaking changed.
 */
/**
 * How deep the record book goes on screen.
 *
 * The derived lists hold more than this (headroom for a future deeper view), so
 * this is the number that must gate badges: a "#22 lowest scoring matchup" badge
 * points at a rank the records page will not show, which reads as a bug because
 * it is one. Keep the records page and the badges reading this same constant so
 * they cannot drift apart.
 */
export const RECORD_BOOK_DEPTH = 20;

export function getRecordFlags(
  season: number,
  week: number | null,
  slugs: string[],
): RecordFlag[] {
  if (week == null) return [];
  const r = getRecords();
  const out: RecordFlag[] = [];
  const hit = (s: { season: number; week: number; ownerSlug: string }) =>
    s.season === season && s.week === week && slugs.includes(s.ownerSlug);

  r.weeklyHigh.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} weekly high`,
        full: `${ordinalOf(i + 1)}-highest single-week score in league history`,
        rank: i + 1,
        tone: "good",
        ownerSlug: s.ownerSlug,
      });
    }
  });
  r.weeklyLow.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} weekly low`,
        full: `${ordinalOf(i + 1)}-lowest single-week score in league history`,
        rank: i + 1,
        tone: "bad",
        ownerSlug: s.ownerSlug,
      });
    }
  });
  r.biggestBlowout.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} blowout`,
        full: `${ordinalOf(i + 1)}-biggest margin of victory in league history`,
        rank: i + 1,
        tone: "good",
        ownerSlug: s.ownerSlug,
        opponentSlug: s.opponentSlug,
      });
    }
  });
  r.narrowestWin.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} closest win`,
        full: `${ordinalOf(i + 1)}-narrowest margin of victory in league history`,
        rank: i + 1,
        tone: "good",
        ownerSlug: s.ownerSlug,
      });
    }
  });
  // Combined lists rank the GAME, so a hit on either participant is a hit.
  r.highestCombined.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} highest scoring matchup`,
        full: `${ordinalOf(i + 1)}-highest combined score of any matchup in league history`,
        rank: i + 1,
        tone: "good",
        ownerSlug: s.ownerSlug,
        opponentSlug: s.opponentSlug,
      });
    }
  });
  r.lowestCombined.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} lowest scoring matchup`,
        full: `${ordinalOf(i + 1)}-lowest combined score of any matchup in league history`,
        rank: i + 1,
        tone: "bad",
        ownerSlug: s.ownerSlug,
        opponentSlug: s.opponentSlug,
      });
    }
  });

  r.playerHigh.forEach((s, i) => {
    if (hit(s)) {
      out.push({
        short: `#${i + 1} player week`,
        full: `${ordinalOf(i + 1)}-best single week by a started player in league history`,
        rank: i + 1,
        tone: "good",
        ownerSlug: s.ownerSlug,
        playerId: s.playerId,
      });
    }
  });

  // Only ranks the record book actually shows.
  return out.filter((f) => f.rank <= RECORD_BOOK_DEPTH).sort((a, b) => a.rank - b.rank);
}

/**
 * Thresholds a live score would have to beat to enter the record book.
 *
 * Shipped to the client so an in-progress game can say "on pace for #4" without
 * refetching history — the record arrays are build-time data.
 */
export function getRecordThresholds(): { high: number[]; low: number[] } {
  const r = getRecords();
  // Capped the same way as the badges, so a live game cannot be "on pace for
  // #22" when the record book stops at 20.
  return {
    high: r.weeklyHigh.slice(0, RECORD_BOOK_DEPTH).map((s) => s.points),
    low: r.weeklyLow.slice(0, RECORD_BOOK_DEPTH).map((s) => s.points),
  };
}
