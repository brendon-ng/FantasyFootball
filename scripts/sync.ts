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

import { existsSync } from "node:fs";
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
import { CACHE_DIR, SHARED_DATA_DIR, fileAgeMs, log, readJson, wk, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues, type ScriptLeague } from "./lib/league.ts";

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
 * Builds `data/players.json` — a slim index of only the players this league has
 * ever touched.
 *
 * The full Sleeper player map is ~5MB, far too large to commit or ship to a
 * browser. Restricting it to referenced players cuts it by well over 95% while
 * still resolving every ID that appears in a roster, draft, matchup, or trade.
 */
async function syncPlayers(seasons: SeasonRecord[]): Promise<void> {
  log.step("Building player index");

  const ids = new Set<string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && ids.add(x));
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => ids.add(k));
  };

  for (const s of seasons) {
    const dir = join(RAW_DIR, s.season);

    for (const r of readJson<Array<Record<string, unknown>>>(join(dir, "rosters.json")) ?? []) {
      collect(r.players);
      collect(r.reserve);
      collect(r.starters);
    }
    for (const p of readJson<Array<{ player_id: string }>>(join(dir, "draft-picks.json")) ?? []) {
      ids.add(p.player_id);
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

  // Also index whoever is currently rostered, so in-progress pages resolve names.
  for (const [season, leagueId] of Object.entries(config.knownLeagueIds)) {
    if (seasons.find((s) => s.season === season)?.finalized) continue;
    for (const r of (await getRosters(leagueId)) ?? []) {
      collect(r.players);
      collect(r.reserve);
    }
  }

  ids.delete("");
  log.info(`${ids.size} distinct players referenced`);

  // Cache the 5MB payload locally so repeated syncs in a day cost one request.
  const cachePath = join(CACHE_DIR, "players-nfl.json");
  let all = readJson<Record<string, SleeperPlayer>>(cachePath);
  if (!all || fileAgeMs(cachePath) > 24 * 60 * 60 * 1000) {
    log.info("fetching full player map (~5MB, max once/day)");
    all = await getAllPlayers(config.sport);
    if (all) writeJson(cachePath, all);
  } else {
    log.skip("using cached player map (<24h old)");
  }
  if (!all) throw new Error("Could not load player map");

  const slim: Record<string, Omit<SleeperPlayer, "player_id">> = {};
  for (const id of [...ids].sort()) {
    const p = all[id];
    if (!p) {
      // Team defenses are keyed by abbreviation ("DET"), not a numeric id, and
      // are absent from the player map in some Sleeper responses.
      if (/^[A-Z]{2,4}$/.test(id)) {
        slim[id] = { full_name: `${id} D/ST`, position: "DEF", team: id };
      }
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
  for (const league of leagues) records.push(await syncSeason(league));

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

  if (!SKIP_PLAYERS) await syncPlayers(records);
}

for (const league of resolveLeagues(process.argv.slice(2))) {
  await syncLeague(league);
}
log.step("Done");
