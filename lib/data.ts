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

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { meetingId } from "./meeting.ts";
import { MARK_DEPTH, type RecordThresholds } from "./record-marks.ts";

import {
  getLeague,
  getLeagueUsers,
  getMatchups,
  getRosters,
  getState,
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
  PlayerUsage,
  SeasonKeepers,
  Trade,
  TradeReturn,
  TradeSeason,
  TradeSide,
  TradeStat,
  LiveMatchup,
  LiveSeason,
  LiveTeam,
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

/**
 * Reads a derived JSON file, ONCE per process.
 *
 * Without the cache every accessor re-read and re-parsed its file on every call,
 * and these are called per page across a static export of ~1200 pages. The data
 * cannot change mid-build — the whole point of committing it — so a plain module
 * map is safe. Each of Next's workers keeps its own copy, which is fine.
 */
const fileCache = new Map<string, unknown>();

function load<T>(relPath: string, fallback: T): T {
  if (fileCache.has(relPath)) return fileCache.get(relPath) as T;
  const p = join(DATA, relPath);
  const value = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  fileCache.set(relPath, value);
  return value;
}

/** Memoises a zero-argument accessor. Same reasoning as `load`. */
function once<T>(fn: () => T): () => T {
  let cached: { v: T } | null = null;
  return () => (cached ??= { v: fn() }).v;
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
/**
 * What team a player was on at a given point, most specific answer first.
 *
 * `players.json` holds the CURRENT team, which is what a keeper board or a
 * profile wants — they are about the player now. A matchup page is a record of a
 * game that happened, so it wants the team at the time: Carson Wentz was PHI in
 * 2019, not MIN.
 *
 * THREE LAYERS, narrowing:
 *
 * `weekly` is exact, and only `sync` can write it — Sleeper reports a player's
 * current team and nothing else, so team-at-the-time exists only if it is
 * captured as the week finalizes. It holds the differences alone, so it is empty
 * in a week nobody was traded, which is most weeks.
 *
 * `seasons` is the baseline recovered from ESPN by `import:player-teams`, one
 * team per player per year. It cannot see a midseason trade.
 *
 * Then the player's current team, which is what every page showed before any of
 * this existed and is still right for a recent game.
 *
 * Shared across leagues, like `players.json` — which team someone played for is
 * a fact about the NFL.
 */
interface PlayerTeamFile {
  seasons: Record<string, Record<string, string>>;
  weekly: Record<string, Record<string, Record<string, string>>>;
  /** `season -> team -> bye week`. */
  byes: Record<string, Record<string, number>>;
}

const playerTeamFile = once((): PlayerTeamFile => {
  const p = join(SHARED_DATA, "player-teams.json");
  return existsSync(p)
    ? (JSON.parse(readFileSync(p, "utf8")) as PlayerTeamFile)
    : { seasons: {}, weekly: {}, byes: {} };
});

/** Team by player for one week, ready to hand to a lineup. */
export function getPlayerTeamsAt(season: number, week: number): Record<string, string> {
  const f = playerTeamFile();
  return {
    ...(f.seasons[String(season)] ?? {}),
    ...(f.weekly[String(season)]?.[String(week)] ?? {}),
  };
}

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
/**
 * Which seasons have week-by-week scores, as a phrase for UI copy.
 *
 * Derived, never hardcoded. Coverage used to be "2024 onward"; recovering the
 * 2019 ESPN scoreboards made that wrong everywhere it was written down. Anything
 * that describes coverage should read it from here so the next recovered season
 * updates the copy for free.
 */
export const weeklyCoverage = once((): {
  seasons: number[];
  /** e.g. "2019 and 2024-2025", or "no seasons". */
  label: string;
  /** Seasons on record with postseason scores only. */
  missing: number[];
  missingLabel: string;
} => {
  const withWeekly = new Set(getMatchupHistory().map((m) => m.season));
  const all = getSeasons().map((s) => s.season);
  const seasons = all.filter((y) => withWeekly.has(y)).sort((a, b) => a - b);
  const missing = all.filter((y) => !withWeekly.has(y)).sort((a, b) => a - b);
  return { seasons, label: rangeLabel(seasons), missing, missingLabel: rangeLabel(missing) };
});

/** [2019,2024,2025] -> "2019 and 2024-2025". Collapses runs so copy stays short. */
function rangeLabel(years: number[]): string {
  if (!years.length) return "no seasons";
  const runs: string[] = [];
  let start = years[0];
  let prev = years[0];
  for (const y of years.slice(1)) {
    if (y === prev + 1) {
      prev = y;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = y;
  }
  runs.push(start === prev ? `${start}` : `${start}-${prev}`);
  return runs.length === 1
    ? runs[0]
    : `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`;
}

export const getWeeklyLows = (): WeeklyLow[] => load("derived/weekly-lows.json", []);

/**
 * Lookup for "was this team the low scorer that week", keyed `season:week:slug`.
 *
 * Returns an EMPTY set unless the league attaches a punishment to it, so callers
 * do not each have to remember the flag — a league without the rule simply has no
 * low scorers to mark.
 */
export const getWeeklyLowKeys = once((): Set<string> => {
  if (!features().weeklyLowPunishment) return new Set();
  return new Set(getWeeklyLows().map((w) => `${w.season}:${w.week}:${w.ownerSlug}`));
});

export const getDrafts = (): DraftPickRecord[] => load("derived/drafts.json", []);

/**
 * Per player, what each owner got out of them each season.
 *
 * ONE PASS FOR THE WHOLE BUILD. A player page that scanned every matchup itself
 * would be O(pages x matchups) — 650 pages against 800 games — which is exactly
 * the shape that made the build four minutes before the accessors were memoised.
 *
 * Summed rather than derived at import: `playerPoints` already carries the whole
 * roster and `starters` the subset that counted, for both providers, so there is
 * nothing to reconcile and no new file to keep in step.
 */
/**
 * True when this player's NFL team was idle that week.
 *
 * Shared by every per-game figure on the site, so a bye is discounted the same
 * way wherever it appears.
 */
const byeFilter = once(() => {
  const teams = playerTeamFile();
  /**
   * A BYE IS NOT A GAME HE PLAYED BADLY. His NFL team was idle, so a zero there
   * says nothing about the player or about the owner who started him, and
   * counting it drags every average down by the schedule. Left out of the counts
   * entirely rather than shown as a zero.
   *
   * Needs both his team that season and that team's bye, so the 2% of players
   * with no team on file still count their bye — better than dropping a real
   * week for someone we cannot place.
   */
  return (season: number, week: number, playerId: string, points: number): boolean => {
    // A BYE SCORES ZERO, ALWAYS. So a non-zero week is proof this is not one, and
    // the team on file must be wrong for that week — which happens, because the
    // team is recorded per SEASON and players are traded mid-season. Hockenson
    // went DET to MIN in 2022; without this guard his real week 7 for Detroit was
    // discarded as Minnesota's bye, quietly deleting 8.8 points he scored.
    if (points !== 0) return false;
    // Weekly first: from 2026 `sync` records the exact team as each week
    // finalizes, which is the only way a midseason trade gets the right bye.
    const team =
      teams.weekly[String(season)]?.[String(week)]?.[playerId] ??
      teams.seasons[String(season)]?.[playerId];
    return team ? teams.byes[String(season)]?.[team] === week : false;
  };
});

/**
 * Whether a player's NFL team was idle that week, for callers outside this file.
 *
 * Exported so the trade tree discounts a bye the same way every other per-game
 * figure does. Duplicating the rule would be the only alternative, and two copies
 * of "a bye is not a game he played badly" is exactly how they drift.
 */
export const onBye = (season: number, week: number, playerId: string, points: number): boolean =>
  byeFilter()(season, week, playerId, points);

export const getPlayerUsage = once((): Record<string, PlayerUsage[]> => {
  const onBye = byeFilter();
  const acc = new Map<string, PlayerUsage>();
  for (const m of getMatchupHistory()) {
    for (const side of [m.home, m.away]) {
      const started = new Set(side.starters);
      for (const [playerId, points] of Object.entries(side.playerPoints)) {
        if (onBye(m.season, m.week, playerId, points)) continue;
        const key = `${playerId}|${m.season}|${side.ownerSlug}`;
        const row =
          acc.get(key) ??
          {
            season: m.season,
            ownerSlug: side.ownerSlug,
            rostered: 0,
            started: 0,
            startPoints: 0,
            benchPoints: 0,
            lastWeek: 0,
          };
        row.rostered += 1;
        row.lastWeek = Math.max(row.lastWeek, m.week);
        if (started.has(playerId)) {
          row.started += 1;
          row.startPoints += points;
        } else {
          row.benchPoints += points;
        }
        acc.set(key, row);
      }
    }
  }

  const out: Record<string, PlayerUsage[]> = {};
  for (const [key, row] of acc) {
    const playerId = key.slice(0, key.indexOf("|"));
    row.startPoints = Number(row.startPoints.toFixed(2));
    row.benchPoints = Number(row.benchPoints.toFixed(2));
    (out[playerId] ??= []).push(row);
  }
  // Newest first, matching the transaction timeline beside it — and WITHIN a
  // season by who had him last, so the order tracks the moves that produced it
  // rather than the alphabet.
  for (const rows of Object.values(out)) {
    rows.sort((a, b) => b.season - a.season || b.lastWeek - a.lastWeek);
  }
  return out;
});
/**
 * What each side of a trade got out of it, for the rest of that season.
 *
 * The nearest thing to "who won", and deliberately not a verdict: it counts what
 * the players actually returned, and says nothing about picks, which pay off in a
 * different season, or about a team that needed a position rather than points.
 *
 * BROKEN OUT PER PLAYER as well as totalled: a two-for-two where one player
 * carried the whole return is a different deal from one where both contributed,
 * and a total alone hides that.
 *
 * COUNTED WHILE GENUINELY ROSTERED, from the trade week on. Matching on the owner
 * rather than just the week handles both awkward cases for free: a player flipped
 * on again stops counting for the middle team, and a trade processed before that
 * week's games still picks the week up.
 *
 * Vetoed trades are included — they are in the lists, and their return is
 * correctly nothing, since nobody ever rostered anyone.
 */
export const getTradeReturns = once((): Record<string, TradeReturn> => {
  const onBye = byeFilter();
  const byWeek = new Map<string, Map<string, Matchup["home"]>>();
  for (const m of getMatchupHistory()) {
    const key = `${m.season}|${m.week}`;
    const at = byWeek.get(key) ?? new Map<string, Matchup["home"]>();
    for (const side of [m.home, m.away]) at.set(side.ownerSlug, side);
    byWeek.set(key, at);
  }

  // Keeper picks by season and owner, so the chain below is a lookup rather than
  // a scan of 1,300 draft picks per trade.
  const keptBy = new Map<string, Map<string, number>>();
  for (const p of getDrafts()) {
    if (!p.isKeeper || !p.ownerSlug) continue;
    const key = `${p.season}|${p.ownerSlug}`;
    const m = keptBy.get(key) ?? new Map<string, number>();
    m.set(p.playerId, p.round);
    keptBy.set(key, m);
  }

  const history = getPlayerHistory();
  const blank = (): TradeStat => ({ games: 0, started: 0, startPoints: 0, benchPoints: 0 });

  const sum = (a: TradeStat, b: TradeStat): TradeStat => ({
    games: a.games + b.games,
    started: a.started + b.started,
    startPoints: Number((a.startPoints + b.startPoints).toFixed(2)),
    benchPoints: Number((a.benchPoints + b.benchPoints).toFixed(2)),
  });

  /** One owner's totals for a set of players over one season, from `fromWeek`. */
  const tally = (
    season: number,
    owner: string,
    ids: string[],
    fromWeek: number,
  ): { byPlayer: Record<string, TradeStat>; total: TradeStat } => {
    const byPlayer: Record<string, TradeStat> = Object.fromEntries(ids.map((id) => [id, blank()]));
    for (let week = fromWeek; week <= 25; week++) {
      const side = byWeek.get(`${season}|${week}`)?.get(owner);
      if (!side) continue;
      const started = new Set(side.starters);
      for (const playerId of ids) {
        const points = side.playerPoints[playerId];
        if (points === undefined) continue;
        if (onBye(season, week, playerId, points)) continue;
        const one = byPlayer[playerId];
        one.games += 1;
        if (started.has(playerId)) {
          one.started += 1;
          one.startPoints += points;
        } else {
          one.benchPoints += points;
        }
      }
    }

    // Given up again before the season was out. The transaction log is the only
    // thing that separates "dropped" from "the season ended".
    for (const playerId of ids) {
      for (const e of history[playerId] ?? []) {
        if (e.season !== season || e.week < fromWeek) continue;
        if (e.action === "drop" && e.ownerSlug === owner) {
          byPlayer[playerId].exit = { kind: "dropped", week: e.week };
          break;
        }
        if (e.action === "trade" && e.fromSlug === owner) {
          byPlayer[playerId].exit = { kind: "traded", week: e.week, tradeId: e.tradeId };
          break;
        }
      }
      const round = keptBy.get(`${season + 1}|${owner}`)?.get(playerId);
      if (round) byPlayer[playerId].kept = { season: season + 1, round };
    }

    const total = blank();
    for (const one of Object.values(byPlayer)) {
      one.startPoints = Number(one.startPoints.toFixed(2));
      one.benchPoints = Number(one.benchPoints.toFixed(2));
      total.games += one.games;
      total.started += one.started;
      total.startPoints += one.startPoints;
      total.benchPoints += one.benchPoints;
    }
    total.startPoints = Number(total.startPoints.toFixed(2));
    total.benchPoints = Number(total.benchPoints.toFixed(2));
    return { byPlayer, total };
  };

  // Which player a traded pick actually became, and for whom. Keyed by the pick
  // as the league names it: whose pick it originally was.
  const pickBecame = new Map<string, DraftPickRecord>();
  for (const p of getDrafts()) {
    if (p.slotOwnerSlug) pickBecame.set(`${p.season}|${p.round}|${p.slotOwnerSlug}`, p);
  }

  const out: Record<string, TradeReturn> = {};
  for (const trade of getTrades()) {
    const seasons: TradeSeason[] = [];

    // A pick only pays the team that USED it. One traded on again returned
    // nothing to the side that briefly held it, however good the player was.
    const pickArrivals = new Map<string, string[]>();
    if (!trade.vetoed) {
      for (const leg of trade.legs) {
        if (leg.kind !== "pick" || !leg.toSlug || !leg.pick) continue;
        const made = pickBecame.get(
          `${leg.pick.season}|${leg.pick.round}|${leg.pick.originalSlug}`,
        );
        if (!made || made.ownerSlug !== leg.toSlug) continue;
        const key = `${made.season}|${leg.toSlug}`;
        pickArrivals.set(key, [...(pickArrivals.get(key) ?? []), made.playerId]);
      }
    }

    // Who each owner is still holding, narrowing year by year.
    let holding = new Map<string, string[]>(
      trade.ownerSlugs.map((owner) => [
        owner,
        trade.vetoed
          ? []
          : trade.legs
              .filter((l) => l.kind === "player" && l.toSlug === owner && l.playerId)
              .map((l) => l.playerId as string),
      ]),
    );

    let viaPick = new Map<string, string[]>(trade.ownerSlugs.map((o) => [o, []]));
    const lastArrival = Math.max(
      trade.season,
      ...[...pickArrivals.keys()].map((k) => Number(k.split("|")[0])),
    );

    let season = trade.season;
    let fromWeek = trade.week;
    while (
      [...holding.values()].some((ids) => ids.length) ||
      [...viaPick.values()].some((ids) => ids.length) ||
      season <= lastArrival
    ) {
      // A drafted player joins in the season of HIS draft, and from week 1 — the
      // trade week only bounds the players who changed hands that day.
      for (const owner of trade.ownerSlugs) {
        const arriving = pickArrivals.get(`${season}|${owner}`) ?? [];
        if (arriving.length) {
          viaPick.set(owner, [...new Set([...(viaPick.get(owner) ?? []), ...arriving])]);
        }
      }

      const byOwner: Record<string, TradeSide> = {};
      for (const owner of trade.ownerSlugs) {
        const ids = holding.get(owner) ?? [];
        const picked = viaPick.get(owner) ?? [];
        if (!ids.length && !picked.length) continue;
        const players = tally(season, owner, ids, fromWeek);
        const drafted = tally(season, owner, picked, 1);
        byOwner[owner] = {
          byPlayer: players.byPlayer,
          fromPicks: drafted.byPlayer,
          total: players.total,
          totalWithPicks: sum(players.total, drafted.total),
        };
      }
      if (Object.keys(byOwner).length) {
        seasons.push({ season, partial: season === trade.season, byOwner });
      }

      // THE CHAIN CONTINUES ONLY THROUGH A KEEP. Anyone not retained by the same
      // owner for the next season drops out; when nobody is left the trade has
      // finished paying and there is no further section.
      const survives = (owner: string, ids: string[]) =>
        ids.filter((id) => keptBy.get(`${season + 1}|${owner}`)?.has(id));
      holding = new Map([...holding].map(([o, ids]) => [o, survives(o, ids)]));
      // A player drafted with a traded pick carries on exactly like one received
      // in the trade: keep him and the deal is still paying.
      viaPick = new Map([...viaPick].map(([o, ids]) => [o, survives(o, ids)]));
      season += 1;
      fromWeek = 1;
      // A guard, not a limit anyone will reach: a contract cannot outlive the
      // seasons on file.
      if (season > trade.season + 20) break;
    }

    out[trade.id] = { order: trade.ownerSlugs, seasons };
  }
  return out;
});

/**
 * Which trade moved a pick on again, keyed `season|round|originalOwner|from`.
 *
 * A pick can change hands more than once, and the interesting question on a trade
 * page is "who did they send it to" — answerable only by finding the LATER trade
 * where the same pick left the same owner.
 */
export const getPickHandoffs = once((): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const trade of getTrades()) {
    for (const leg of trade.legs) {
      if (leg.kind !== "pick" || !leg.pick || !leg.fromSlug) continue;
      const key = `${leg.pick.season}|${leg.pick.round}|${leg.pick.originalSlug}|${leg.fromSlug}`;
      // Trades are oldest first, so the FIRST match is the handoff that followed
      // the trade being looked at. A later one would be a different owner's.
      out[key] ??= trade.id;
    }
  }
  return out;
});

/** Every completed trade, oldest first. Vetoed and withdrawn ones never reach here. */
export const getTrades = (): Trade[] => load("derived/trades.json", []);

/**
 * Everyone credited with each trade, GROUPED BY SIDE and aligned to
 * `Trade.ownerSlugs`.
 *
 * `Trade.ownerSlugs` IS THE LIST OF PARTIES, and a party is a TEAM — it drives
 * the card's columns, so a co-owned team must appear there once or a two-team
 * deal grows a third column and gets badged "3-team". But co-owners are
 * first-class everywhere else here, and matching on the parties alone meant
 * Katie's and Maddy's pages reported no trades while their teams had made eight
 * and three. The two jobs are different, so they get different lists.
 *
 * GROUPED, NOT FLATTENED, and that is the whole point of the shape. A flat list
 * of credited people cannot tell "both were in this deal" from "both are on the
 * same side of it", so the Jaymie-vs-Katie head-to-head claimed eight trades
 * between two people who co-own one team and have never traded with anybody but
 * together.
 *
 * Expanded through the SEASON'S standings row, not a current roster: who co-owned
 * a team is a fact about that year, and a partnership that has since ended still
 * made the trade.
 */
export const getTradeParties = once((): Record<string, string[][]> => {
  const team = new Map<string, string[]>();
  for (const s of getSeasons()) {
    for (const row of s.standings) team.set(`${s.season}:${row.ownerSlug}`, row.ownerSlugs);
  }
  return Object.fromEntries(
    getTrades().map((t) => [
      t.id,
      t.ownerSlugs.map((party) => team.get(`${t.season}:${party}`) ?? [party]),
    ]),
  );
});

/**
 * What a traded draft pick turned into, keyed `season:round:originalOwner`.
 *
 * ONLY FOR DRAFTS THAT HAVE HAPPENED. A pick traded for a future year has no
 * outcome yet, and the key is simply absent — callers render the pick alone
 * rather than inventing one.
 *
 * Keyed on the ORIGINAL owner because that is how a pick is identified once it
 * moves: "Reagan's 2026 4th" is the same pick whoever is holding it, and
 * `slotOwnerSlug` on a draft pick is that same original owner.
 */
export const getPickOutcomes = once(
  (): Record<string, DraftPickRecord> =>
    Object.fromEntries(
      getDrafts()
        .filter((p) => p.slotOwnerSlug)
        .map((p) => [`${p.season}:${p.round}:${p.slotOwnerSlug}`, p]),
    ),
);
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
 * The rules the current keeper cycle runs under.
 *
 * INHERITS FORWARD, exactly as `rulesFor()` in derive does — a season with no
 * file of its own carries the last one forward, so a new year is not a manual
 * chore that breaks the build when forgotten. Kept to the two fields the site
 * needs; derive owns the full shape and validates it.
 */
export const getRules = once((): { draftRounds: number; teams: number } => {
  const dir = join(CONFIG, "rules");
  const want = keeperCycleSeason();
  const years = (existsSync(dir) ? readdirSync(dir) : [])
    .map((f) => Number(f.replace(".json", "")))
    .filter((y) => Number.isFinite(y) && y <= want)
    .sort((a, b) => b - a);
  for (const y of years) {
    const file = join(dir, `${y}.json`);
    if (existsSync(file)) {
      const r = JSON.parse(readFileSync(file, "utf8")) as { draftRounds?: number; teams?: number };
      return { draftRounds: r.draftRounds ?? 17, teams: r.teams ?? 10 };
    }
  }
  return { draftRounds: 17, teams: 10 };
});

/**
 * Feature flags for the league this build serves.
 *
 * Gates whole subsystems rather than scattering `if (slug === ...)` — a redraft
 * league should not show a Keepers tab at all, and asking "does this league keep
 * players" reads better than asking which league it is.
 */
/**
 * Site-relative path to this league's avatar, or null if it has none.
 *
 * Downloaded by `npm run sync` into `public/avatars/<slug>.<ext>` rather than
 * hotlinked from Sleeper's CDN — this is the favicon, and a Sleeper outage should
 * not blank the tab icon of a site that otherwise needs no server.
 *
 * The extension varies by league because Sleeper stores whatever was uploaded, so
 * it is probed rather than assumed.
 */
export function leagueAvatar(): string | null {
  for (const ext of ["png", "jpg", "gif"]) {
    if (existsSync(join(process.cwd(), "public", "avatars", `${LEAGUE}.${ext}`))) {
      return `/avatars/${LEAGUE}.${ext}`;
    }
  }
  return null;
}

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

export const getOwnerMap = once(
  (): Map<string, Owner> => new Map(getOwners().map((o) => [o.slug, o])),
);

// ---------------------------------------------------------------------------
// Live (in-progress) season
// ---------------------------------------------------------------------------

export type { LiveMatchup, LiveSeason, LiveTeam } from "./types.ts";

/**
 * Fetches the in-progress season at build time.
 *
 * Never throws: a Sleeper outage during a scheduled rebuild should ship a site
 * with history intact and the live panel hidden, not fail the deploy.
 */
export async function getLiveSeason(): Promise<LiveSeason | null> {
  const empty = (season: number): LiveSeason => ({
    season, week: 0, displayWeek: 0, seasonType: "off",
    status: "unknown", teams: [], matchups: [], unavailable: true, lastScoredLeg: null,
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

    const slugsOf = (r: { owner_id: string | null; co_owners: string[] | null }): string[] => {
      const out: string[] = [];
      for (const id of [r.owner_id, ...(r.co_owners ?? [])]) {
        const slug = id ? ownerBySlug.get(id) : undefined;
        if (slug && !out.includes(slug)) out.push(slug);
      }
      return out;
    };

    const teams: LiveTeam[] = rosters.map((r) => ({
      ownerSlug: (r.owner_id && ownerBySlug.get(r.owner_id)) || `roster-${r.roster_id}`,
      ownerSlugs: slugsOf(r),
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
      lastScoredLeg: league.settings?.last_scored_leg ?? null,
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
/**
 * The season the keeper cycle is currently pricing.
 *
 * A DRAFT ADVANCES IT, NOT A FINISHED SEASON. `resolveKeepers` rolls every
 * contract onto the next year the moment a draft completes, so from the day the
 * 2026 draft is archived the board is quoting what it costs to keep in 2027 —
 * five months before the 2026 season ends. Deriving this from finished seasons
 * alone left it a year behind for that whole stretch.
 */
export const keeperCycleSeason = (): number =>
  Math.max(0, ...getSeasons().map((s) => s.season), ...getDrafts().map((d) => d.season)) + 1;

/**
 * The market, and whether it is still moving.
 *
 * LIVE BY DEFAULT, FROZEN ONLY INSIDE THE LOCK WINDOW. Bylaws 1.7.2.2.1 fix ADP
 * a week before the keeper deadline, and it must stay fixed until that draft has
 * run — a market that kept moving would change keeper costs after the deadline
 * they were decided against.
 *
 * NO DATES ARE COMPARED HERE, and that is the point. The frozen file simply does
 * not exist until the lock is taken, and `keeperCycleSeason()` steps forward the
 * moment the draft is archived — so the same two lines give live ADP before the
 * lock, the frozen snapshot through the window, and live ADP again for the next
 * cycle, with nothing to schedule or expire.
 *
 * DISPLAY ONLY. `derive` never reads ADP, so refreshing it daily cannot move a
 * committed keeper contract; the only thing that changes is the market column
 * beside it.
 */
export function getAdp(): {
  byPlayer: Map<string, AdpEntry>;
  frozen: boolean;
  capturedAt: string | null;
  season: number | null;
} {
  const season = keeperCycleSeason();
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

export { meetingId } from "./meeting.ts";

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
const meetingsCache = new Map<string, Meeting[]>();

export function getMeetings(slugA: string, slugB: string): Meeting[] {
  const key = `${slugA}|${slugB}`;
  const hit = meetingsCache.get(key);
  if (hit) return hit;
  const computed = computeMeetings(slugA, slugB);
  meetingsCache.set(key, computed);
  return computed;
}

/**
 * The uncached body. Scans every matchup plus the brackets of seasons without
 * weekly data, so it is far too expensive to repeat — `getAllMeetings()` alone
 * asks for every owner PAIR, which is 120 calls in Den Ops.
 */
function computeMeetings(slugA: string, slugB: string): Meeting[] {
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

  // Imported seasons whose weekly scoreboards are still lost: their brackets are
  // the only record of those games. A season that HAS weekly matchups already
  // emitted them above, and scraping its brackets too produces two Meetings with
  // the same id — which React surfaces as a duplicate-key warning on the
  // head-to-head series. Mirrors `seasonsWithWeeklyData()` in derive.
  const weeklySeasons = new Set(getMatchupHistory().map((m) => m.season));
  for (const s of seasons) {
    if (!s.imported || weeklySeasons.has(s.season)) continue;
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

  return uniqueById(out).sort((x, y) => y.season - x.season || (y.week ?? 0) - (x.week ?? 0));
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
/** Deduped by id — two sources can describe the same game, and callers key on it. */
function uniqueById(list: Meeting[]): Meeting[] {
  const seen = new Map<string, Meeting>();
  for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()];
}

export const getAllMeetings = once((): Meeting[] => {
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
});

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
  /**
   * Short chip text, e.g. "#3 highest score".
   *
   * Says "score", never "weekly high/low" — `features.weeklyLowPunishment` uses
   * "weekly low" for the ONE team that scored lowest in a given week, which is a
   * different idea from an all-time ranking. Sharing the wording made a record
   * badge look like a punishment marker.
   */
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
        short: `#${i + 1} highest score`,
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
        short: `#${i + 1} lowest score`,
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
 * Cut-offs a finished game has to beat to enter each record book.
 *
 * Shipped to the client so a card can mark a record the moment a week is scored,
 * without refetching history — the record arrays are build-time data.
 *
 * Capped at `MARK_DEPTH`, not the record book's twenty: a card marks a top-five
 * result only. That also keeps the shipped arrays tiny.
 */
export function getRecordThresholds(): RecordThresholds {
  const r = getRecords();
  const cap = <T,>(xs: T[]) => xs.slice(0, MARK_DEPTH);
  return {
    high: cap(r.weeklyHigh).map((s) => s.points),
    low: cap(r.weeklyLow).map((s) => s.points),
    blowout: cap(r.biggestBlowout).map((s) => s.margin),
    narrow: cap(r.narrowestWin).map((s) => s.margin),
    combinedHigh: cap(r.highestCombined).map((s) => s.total),
    combinedLow: cap(r.lowestCombined).map((s) => s.total),
  };
}
