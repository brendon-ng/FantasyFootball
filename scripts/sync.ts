/**
 * Pulls finalized league data from Sleeper into `data/<league>/raw/`, then
 * rebuilds the shared player index. Run with `npm run sync`.
 *
 * Operates on EVERY configured league by default; `--league=<slug>` scopes it.
 *
 * Two invariants govern this script:
 *
 * 1. IT ONLY WRITES FINALIZED DATA. A week is finalized once Sleeper has scored
 *    it (`settings.last_scored_leg`); a season is finalized once the league's
 *    status is "complete". In-progress data is deliberately never persisted —
 *    the site fetches that at build time instead. This is what makes the
 *    committed JSON trustworthy as a historical record.
 *
 * 2. IT IS IDEMPOTENT. Existing files are left alone unless their content would
 *    actually change. Re-running on an unchanged league produces an empty git
 *    diff, so any diff you *do* see is real new history.
 *
 * Flags:
 *   --force            rewrite finalized files even if they already exist
 *   --season=2025      restrict to one season
 *   --skip-players     don't refresh the player index (fast iteration)
 *   --league=den-ops   only this league
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  getAllPlayers,
  getDraft,
  getDraftPicks,
  getLeague,
  getLeagueTradedPicks,
  getLeagueUsers,
  getLosersBracket,
  getMatchups,
  getRosters,
  getState,
  getTransactions,
  getUserLeagues,
  getWinnersBracket,
  type SleeperLeague,
  type SleeperPlayer,
} from "../lib/sleeper.ts";
import { CACHE_DIR, ROOT, SHARED_DATA_DIR, fileAgeMs, log, readJson, wk, writeJson } from "./lib/io.ts";
import { allLeagues, configDir, dataDir, resolveLeagues, type ScriptLeague } from "./lib/league.ts";

interface SeasonRecord {
  season: string;
  leagueId: string;
  previousLeagueId: string | null;
  draftId: string;
  status: string;
  /** True once the season can never change again. */
  finalized: boolean;
  /** Highest week with finalized scoring. */
  finalizedThroughWeek: number;
}

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const SKIP_PLAYERS = args.has("--skip-players");
const ONLY_SEASON = [...args].find((a) => a.startsWith("--season="))?.split("=")[1];

// Set per league by syncLeague(); every helper below reads these. Definite
// assignment because the helpers only ever run inside a league pass.
let config!: ScriptLeague;
let RAW_DIR = "";
let LEAGUE_CONFIG_DIR = "";

/**
 * Writes only if the serialized content differs, preserving idempotency.
 * Returns true if the file changed.
 */
function writeIfChanged(path: string, value: unknown, label: string): boolean {
  if (existsSync(path) && !FORCE) {
    const existing = readJson<unknown>(path);
    if (JSON.stringify(existing) === JSON.stringify(sortForCompare(value))) {
      log.skip(label);
      return false;
    }
  }
  writeJson(path, value);
  log.write(label);
  return true;
}

// writeJson sorts keys on the way out, so comparison must sort the same way.
function sortForCompare(value: unknown): unknown {
  return JSON.parse(JSON.stringify(sortKeysDeep(value)));
}
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/**
 * Resolves every season of the league.
 *
 * Sleeper links seasons *backward* through `previous_league_id` but offers no
 * forward pointer, so a brand-new season is invisible from the known IDs alone.
 * We find it by listing the anchor user's leagues for that season and matching
 * on `previous_league_id` — which also filters out their unrelated leagues.
 */
async function discoverSeasons(currentSeason: number): Promise<SleeperLeague[]> {
  log.step("Discovering season chain");

  const byId = new Map<string, SleeperLeague>();

  // Seed from configured IDs, then walk backward to pick up anything older.
  const queue = Object.values(config.knownLeagueIds);
  while (queue.length) {
    const id = queue.pop()!;
    if (byId.has(id)) continue;
    const league = await getLeague(id);
    if (!league) {
      log.warn(`league ${id} not found — skipping`);
      continue;
    }
    byId.set(id, league);
    if (league.previous_league_id) queue.push(league.previous_league_id);
  }

  // Walk forward from the newest known season to catch seasons created since
  // the config was last edited. Probing one year past the current NFL season
  // covers the offseason window where next year's league already exists.
  for (let season = currentSeason - 1; season <= currentSeason + 1; season++) {
    if ([...byId.values()].some((l) => l.season === String(season))) continue;

    const candidates = await getUserLeagues(config.anchorUserId, season, config.sport);
    const match = candidates?.find(
      (l) => l.previous_league_id && byId.has(l.previous_league_id),
    );
    if (match) {
      byId.set(match.league_id, match);
      log.write(`discovered ${match.season} → ${match.league_id} (${match.name})`);
    }
  }

  const leagues = [...byId.values()].sort((a, b) => Number(a.season) - Number(b.season));
  log.info(
    `${leagues.length} season(s): ${leagues.map((l) => `${l.season}=${l.status}`).join(", ")}`,
  );
  return leagues;
}

/**
 * How far into a season the data can be trusted as permanent.
 *
 * `last_scored_leg` is Sleeper's own marker for the last fully scored week, so
 * it is a safer finalization signal than comparing against the current NFL week
 * (which advances before stat corrections settle).
 */
function finalizedThrough(league: SleeperLeague, finalWeek: number): number {
  if (league.status === "complete") return finalWeek;
  const scored = league.settings.last_scored_leg ?? 0;
  return Math.max(0, Math.min(scored, finalWeek));
}

async function syncSeason(league: SleeperLeague): Promise<SeasonRecord> {
  const { season, league_id: leagueId } = league;
  const dir = join(RAW_DIR, season);
  const complete = league.status === "complete";

  const rules = readJson<{ finalWeek?: number }>(join(LEAGUE_CONFIG_DIR, "rules", `${season}.json`));
  const finalWeek = rules?.finalWeek ?? 17;
  const through = finalizedThrough(league, finalWeek);

  log.step(`${season} — ${league.name} (${league.status}, finalized through week ${through})`);

  if (!complete) {
    log.info("season in progress — league/roster snapshots are fetched at build time, not stored");
  }

  // League settings, users, and the final roster snapshot are only permanent
  // once the season is over. Storing them mid-season would bake in a moving
  // target (records, FAAB, rosters all still change).
  if (complete) {
    writeIfChanged(join(dir, "league.json"), league, `${season}/league.json`);

    const users = await getLeagueUsers(leagueId);
    if (users) writeIfChanged(join(dir, "users.json"), users, `${season}/users.json`);

    const rosters = await getRosters(leagueId);
    if (rosters) writeIfChanged(join(dir, "rosters.json"), rosters, `${season}/rosters.json`);

    const winners = await getWinnersBracket(leagueId);
    if (winners) writeIfChanged(join(dir, "winners-bracket.json"), winners, `${season}/winners-bracket.json`);

    const losers = await getLosersBracket(leagueId);
    if (losers) writeIfChanged(join(dir, "losers-bracket.json"), losers, `${season}/losers-bracket.json`);
  }

  // Per-week matchups and transactions finalize independently of the season, so
  // an in-progress season still contributes permanent history week by week.
  for (let week = 1; week <= through; week++) {
    const mPath = join(dir, "matchups", `${wk(week)}.json`);
    if (!existsSync(mPath) || FORCE) {
      const matchups = await getMatchups(leagueId, week);
      if (matchups?.length) {
        writeIfChanged(mPath, matchups, `${season}/matchups/${wk(week)}.json`);
        await snapshotTeams(Number(season), week, matchups);
      }
    } else {
      log.skip(`${season}/matchups/${wk(week)}.json`);
    }

    const tPath = join(dir, "transactions", `${wk(week)}.json`);
    if (!existsSync(tPath) || FORCE) {
      const txns = await getTransactions(leagueId, week);
      // An empty week is still a fact worth recording — it prevents refetching.
      writeIfChanged(tPath, txns ?? [], `${season}/transactions/${wk(week)}.json`);
    } else {
      log.skip(`${season}/transactions/${wk(week)}.json`);
    }
  }

  // The draft is permanent the moment it completes, independent of the season.
  //
  // Always resolve via `league.draft_id`. `/league/:id/drafts` is unsafe here:
  // the 2024 league carries two abandoned drafts (a never-run "Dynasty" draft
  // and an empty 20-round 2QB draft from league creation) alongside the real one.
  const draft = await getDraft(league.draft_id);
  if (draft && draft.status === "complete") {
    writeIfChanged(join(dir, "draft.json"), draft, `${season}/draft.json`);
    const picks = await getDraftPicks(league.draft_id);
    if (picks?.length) {
      writeIfChanged(join(dir, "draft-picks.json"), picks, `${season}/draft-picks.json`);
    }
  } else {
    log.info(`draft ${league.draft_id} is ${draft?.status ?? "missing"} — not finalized`);
  }

  // Traded picks keep mutating until that season's draft happens, so they are
  // only permanent once the draft is done.
  if (draft?.status === "complete") {
    const traded = await getLeagueTradedPicks(leagueId);
    if (traded) writeIfChanged(join(dir, "traded-picks.json"), traded, `${season}/traded-picks.json`);
  }

  return {
    season,
    leagueId,
    previousLeagueId: league.previous_league_id,
    draftId: league.draft_id,
    status: league.status,
    finalized: complete,
    finalizedThroughWeek: through,
  };
}

/**
 * Which NFL team each player was on THE WEEK THIS WAS SCORED.
 *
 * Sleeper only ever reports a player's CURRENT team, so team-at-the-time can only
 * be captured as it happens — which is why 2019-25 had to be recovered from ESPN
 * one athlete at a time, and can only be had at season granularity. From here on
 * a week is stamped as it finalizes and the record is exact.
 *
 * ONLY THE DIFFERENCES ARE STORED. A player's team is stable within a season, so
 * writing all ~300 every week would be almost entirely repetition; an entry
 * appears only where the week disagrees with the season baseline that
 * `import:player-teams` established. In a normal week that is nothing at all.
 *
 * A FEW DAYS OF SKEW, unavoidably. A week is committed once Sleeper has scored
 * it, on the Tuesday, so a player traded that Tuesday is recorded under his new
 * team for the week just played. Rarer and far smaller than the error it removes.
 */
async function snapshotTeams(
  season: number,
  week: number,
  matchups: Array<{ players?: string[] | null; starters?: string[] | null }>,
): Promise<void> {
  const all = await cachedPlayerMap();
  if (!all) return;

  const path = join(SHARED_DATA_DIR, "player-teams.json");
  const file = readJson<PlayerTeams>(path) ?? { seasons: {}, weekly: {}, byes: {} };
  const baseline = file.seasons[String(season)] ?? {};
  // A season with no baseline yet — the first week of a new year — would make
  // EVERY player a difference and put three hundred entries in the weekly bucket
  // seventeen times over. Seed it instead, and diff from there.
  const seeding = !Object.keys(baseline).length;

  const ids = new Set<string>();
  for (const m of matchups) {
    for (const id of [...(m.players ?? []), ...(m.starters ?? [])]) if (id) ids.add(id);
  }

  const diffs: Record<string, string> = {};
  for (const id of ids) {
    // A defence IS its team, and cannot be traded.
    if (/^[A-Z]{2,4}$/.test(id)) continue;
    const team = all[id]?.team;
    if (!team) continue;
    if (seeding) baseline[id] = team;
    else if (team !== baseline[id]) diffs[id] = team;
  }
  if (seeding) file.seasons[String(season)] = baseline;

  const bySeason = (file.weekly[String(season)] ??= {});
  if (Object.keys(diffs).length) {
    bySeason[String(week)] = diffs;
  } else {
    delete bySeason[String(week)];
  }
  writeIfChanged(path, file, `player-teams.json (${season} wk${week}: ${Object.keys(diffs).length} differ)`);
}

interface PlayerTeams {
  /** Season baseline, seeded here for a new season and filled by `import:player-teams`. */
  seasons: Record<string, Record<string, string>>;
  /** `season -> team -> bye week`, written by `import:player-teams`. */
  byes?: Record<string, Record<string, number>>;
  /** `season -> week -> playerId -> team`, only where a week disagrees. */
  weekly: Record<string, Record<string, Record<string, string>>>;
}

/**
 * The 5MB Sleeper player map, fetched at most once a day.
 *
 * Shared with `syncPlayers`, which needs the same file — two downloads of the
 * same 5MB in one run would be silly.
 */
let playerMapPromise: Promise<Record<string, SleeperPlayer> | null> | null = null;
function cachedPlayerMap(): Promise<Record<string, SleeperPlayer> | null> {
  playerMapPromise ??= (async () => {
    const cachePath = join(CACHE_DIR, "players-nfl.json");
    let all = readJson<Record<string, SleeperPlayer>>(cachePath);
    if (!all || fileAgeMs(cachePath) > 24 * 60 * 60 * 1000) {
      log.info("fetching full player map (~5MB, max once/day)");
      all = await getAllPlayers("nfl");
      if (all) writeJson(cachePath, all);
    }
    return all;
  })();
  return playerMapPromise;
}

/** The shape `import:espn:lineups` writes. Only the parts sync needs. */
interface ManualLineups {
  weeks: Record<string, Record<string, { playerPoints: Record<string, number> }>>;
  espnOnly?: Record<string, { full_name: string; position: string | null; team: string | null }>;
}

/**
 * Builds `data/players.json` — a slim index of only the players this league has
 * ever touched.
 *
 * The full Sleeper player map is ~5MB, far too large to commit or ship to a
 * browser. Restricting it to referenced players cuts it by well over 95% while
 * still resolving every ID that appears in a roster, draft, matchup, or trade.
 */
async function syncPlayers(leagues: ScriptLeague[]): Promise<void> {
  log.step("Building player index");

  // Per league AND unioned. The metadata file is shared because player metadata
  // is league-agnostic, but each league also records which players it actually
  // references, so a build only generates pages for its own players.
  const byLeague = new Map<string, Set<string>>();
  /** Metadata for players Sleeper has never had. See `ManualLineups.espnOnly`. */
  const espnOnly = new Map<string, { full_name: string; position: string | null; team: string | null }>();
  let current = new Set<string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && current.add(x));
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => current.add(k));
  };

  for (const league of leagues) {
    current = new Set<string>();
    byLeague.set(league.slug, current);
    const rawDir = join(dataDir(league.slug), "raw");
    const seasons =
      readJson<{ seasons: SeasonRecord[] }>(join(rawDir, "seasons.json"))?.seasons ?? [];

    for (const s of seasons) {
      const dir = join(rawDir, s.season);

      for (const r of readJson<Array<Record<string, unknown>>>(join(dir, "rosters.json")) ?? []) {
        collect(r.players);
        collect(r.reserve);
        collect(r.starters);
      }
      for (const p of readJson<Array<{ player_id: string }>>(join(dir, "draft-picks.json")) ?? []) {
        current.add(p.player_id);
      }
      for (let week = 1; week <= s.finalizedThroughWeek; week++) {
        for (const m of readJson<Array<Record<string, unknown>>>(
          join(dir, "matchups", `${wk(week)}.json`),
        ) ?? []) {
          collect(m.players);
          collect(m.players_points);
        }
        for (const t of readJson<Array<Record<string, unknown>>>(
          join(dir, "transactions", `${wk(week)}.json`),
        ) ?? []) {
          collect(t.adds);
          collect(t.drops);
        }
      }
    }

    // ESPN-era lineups, recovered by `import:espn:lineups`. Their ids are already
    // normalised to Sleeper's, so they index exactly like a Sleeper roster — the
    // handful Sleeper has never carried arrive as `espn-` ids and are resolved
    // from the same file below.
    const lineupDir = join(dataDir(league.slug), "manual", "lineups");
    if (existsSync(lineupDir)) {
      for (const file of readdirSync(lineupDir).filter((f) => f.endsWith(".json"))) {
        const l = readJson<ManualLineups>(join(lineupDir, file));
        for (const byOwner of Object.values(l?.weeks ?? {})) {
          for (const side of Object.values(byOwner)) collect(side.playerPoints);
        }
        for (const [id, meta] of Object.entries(l?.espnOnly ?? {})) espnOnly.set(id, meta);
      }
    }

    // Recovered ESPN drafts. A player drafted and cut before week 1 appears in no
    // lineup, so without this his pick renders as a bare id on the draft board.
    const draftDir = join(dataDir(league.slug), "manual", "drafts");
    if (existsSync(draftDir)) {
      for (const file of readdirSync(draftDir).filter((f) => f.endsWith(".json"))) {
        const d = readJson<{ picks?: Array<{ playerId: string }> }>(join(draftDir, file));
        for (const p of d?.picks ?? []) current.add(p.playerId);
      }
    }

    // Also index whoever is currently rostered, so in-progress pages resolve names.
    for (const [season, leagueId] of Object.entries(league.knownLeagueIds)) {
      if (seasons.find((s) => s.season === season)?.finalized) continue;
      for (const r of (await getRosters(leagueId)) ?? []) {
        collect(r.players);
        collect(r.reserve);
      }
    }
  }

  const ids = new Set<string>();
  for (const [slug, set] of byLeague) {
    set.delete("");
    for (const id of set) ids.add(id);
    writeIfChanged(
      join(dataDir(slug), "raw", "player-ids.json"),
      [...set].sort(),
      `${slug}: player-ids.json (${set.size})`,
    );
  }
  log.info(`${ids.size} distinct players referenced across ${leagues.length} league(s)`);

  // Cache the 5MB payload locally so repeated syncs in a day cost one request.
  const all = await cachedPlayerMap();
  if (!all) throw new Error("Could not load player map");

  const slim: Record<string, Omit<SleeperPlayer, "player_id">> = {};
  for (const id of [...ids].sort()) {
    const p = all[id];
    if (!p) {
      // Team defenses are keyed by abbreviation ("DET"), not a numeric id, and
      // are absent from the player map in some Sleeper responses.
      if (/^[A-Z]{2,4}$/.test(id)) {
        slim[id] = { full_name: `${id} D/ST`, position: "DEF", team: id };
        continue;
      }
      // An ESPN-era player Sleeper has never carried. Named from the import so a
      // 2019 lineup row reads as a person rather than an id.
      const espn = espnOnly.get(id);
      if (espn) slim[id] = { ...espn, years_exp: null };
      continue;
    }
    slim[id] = {
      full_name:
        p.full_name ?? (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || id),
      position: p.position ?? null,
      team: p.team ?? null,
      years_exp: p.years_exp ?? null,
    };
  }

  writeIfChanged(join(SHARED_DATA_DIR, "players.json"), slim, `players.json (${Object.keys(slim).length})`);
}

/**
 * The league's Sleeper avatar, downloaded into `public/avatars/<slug>.<ext>`.
 *
 * Self-hosted rather than hotlinked. The CDN is a live dependency otherwise, and
 * this image is also the favicon — a Sleeper outage should not blank the tab icon
 * of a site whose whole point is working without a server.
 *
 * The extension is decided by the BYTES, not assumed: Den Ops' avatar is a PNG and
 * Masterbatters' is a JPEG, and the endpoint reports `application/octet-stream`
 * for both. A stale file in the other format is removed so a format change cannot
 * leave two candidates behind.
 */
async function syncLeagueAvatar(league: ScriptLeague, avatar: string | null): Promise<void> {
  const dir = join(ROOT, "public", "avatars");
  const clear = (keep: string) => {
    for (const ext of ["png", "jpg", "gif"]) {
      const path = join(dir, `${league.slug}.${ext}`);
      if (ext !== keep && existsSync(path)) rmSync(path);
    }
  };

  if (!avatar) {
    clear("");
    log.skip("no league avatar set on Sleeper");
    return;
  }

  const res = await fetch(`https://sleepercdn.com/avatars/${avatar}`);
  if (!res.ok) {
    log.warn(`avatar ${avatar} returned ${res.status} — keeping any existing file`);
    return;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const ext =
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? "png"
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "jpg"
        : bytes.subarray(0, 3).toString() === "GIF"
          ? "gif"
          : null;
  if (!ext) {
    log.warn(`avatar ${avatar} is not a recognised image — skipping`);
    return;
  }

  clear(ext);
  const path = join(dir, `${league.slug}.${ext}`);
  // Byte-compare so an unchanged avatar produces no git diff, same rule as the
  // JSON writers.
  if (existsSync(path) && readFileSync(path).equals(bytes)) {
    log.skip(`avatars/${league.slug}.${ext} (unchanged)`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, bytes);
  log.write(`avatars/${league.slug}.${ext} (${Math.round(bytes.length / 1024)}KB)`);
}

async function syncLeague(league: ScriptLeague): Promise<void> {
  config = league;
  RAW_DIR = join(dataDir(league.slug), "raw");
  LEAGUE_CONFIG_DIR = configDir(league.slug);

  log.step(`■ ${league.name} (${league.slug})`);
  const state = await getState(config.sport);
  if (!state) throw new Error("Could not read NFL state");
  log.info(
    `NFL state: ${state.season} ${state.season_type}, week ${state.week} (display ${state.display_week})`,
  );

  let leagues = await discoverSeasons(Number(state.season));
  if (ONLY_SEASON) leagues = leagues.filter((l) => l.season === ONLY_SEASON);

  const records: SeasonRecord[] = [];
  for (const sleeperLeague of leagues) records.push(await syncSeason(sleeperLeague));

  // Newest season's avatar — the league's current identity, not a historical one.
  const newest = [...leagues].sort((a, b) => Number(b.season) - Number(a.season))[0];
  await syncLeagueAvatar(league, newest?.avatar ?? null);

  log.step("Writing season index");
  writeIfChanged(
    join(RAW_DIR, "seasons.json"),
    {
      // Snapshot of where the NFL calendar stood; useful when debugging a sync.
      syncedAgainst: {
        season: state.season,
        seasonType: state.season_type,
        week: state.week,
      },
      seasons: records,
    },
    "raw/seasons.json",
  );

}

for (const league of resolveLeagues(process.argv.slice(2))) {
  await syncLeague(league);
}

// Built from EVERY league, once, after the per-league passes. The index is shared
// (player metadata is league-agnostic), so building it from only the league being
// synced would drop every player the others reference — `--league=x` would quietly
// delete league y's names.
if (!SKIP_PLAYERS) await syncPlayers(allLeagues());

log.step("Done");
