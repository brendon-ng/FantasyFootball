/**
 * Captures a Sleeper ADP snapshot and converts it to keeper round values.
 *
 * WHY SCRAPE: Sleeper publishes no ADP anywhere. Their REST player object has
 * 53 fields and the only rank-like one is `search_rank`, which is positional
 * (Bijan Robinson and Josh Allen are both "1"). Their GraphQL schema has 238
 * root fields and zero ADP types. beatadp.com renders a Sleeper ADP column
 * server-side, so a plain HTML fetch is enough — no browser, no JS execution.
 *
 * BYLAWS 1.7.2.2.1 fixes ADP "one week before the keeper deadline", so a
 * snapshot must be frozen once taken. This script therefore REFUSES to overwrite
 * an existing snapshot unless you pass --force. ADP drifts daily; a silently
 * re-captured file would change keeper costs after the deadline.
 *
 * TWO OUTPUTS, different lifetimes:
 *
 *   data/adp/live.json      Refreshed on every sync/build. Not authoritative —
 *                           purely so the UI can show current market value
 *                           before the keeper deadline locks anything in.
 *   data/adp/<season>.json  The frozen snapshot. Written once and never
 *                           silently overwritten; this is what revalues an
 *                           expired keeper contract.
 *
 *   npm run adp                  refresh live.json (part of `npm run data`)
 *   npm run adp -- --auto        refresh, and freeze if the bylaw window has opened
 *   npm run adp:lock             freeze this season's snapshot
 *   npm run adp:lock -- --force  re-freeze, overwriting
 *   npm run adp -- --season=2027
 */

import { join } from "node:path";

import { keeperDeadline } from "../lib/draft-slots.ts";
import { getAllPlayers, getDraft, getLeague, type SleeperPlayer } from "../lib/sleeper.ts";
import { CACHE_DIR, fileAgeMs, log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";

const SOURCE = "https://www.beatadp.com/platform-adp";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
/** Lock mode writes the frozen per-season snapshot; default refreshes live.json. */
const LOCK = args.has("--lock");
/**
 * Unattended mode, for the daily archive job: refresh live.json, and take the
 * frozen snapshot too if the bylaw window has opened since the last run.
 */
const AUTO = args.has("--auto");
/**
 * Bylaws 1.7.2.2.1 fix ADP one week before the keeper deadline, and 1.7 puts the
 * deadline three days before the draft — so the market stops moving ten days out.
 * Derived from `keeperDeadline` rather than restated, so one bylaw lives in one
 * place.
 */
const LOCK_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
const lockOpensAt = (draftStart: number) => keeperDeadline(draftStart) - LOCK_LEAD_MS;
const SEASON =
  [...args].find((a) => a.startsWith("--season="))?.split("=")[1] ??
  String(new Date().getUTCFullYear());

interface AdpRow {
  rank: number;
  name: string;
  team: string | null;
  consensus: number | null;
  sleeper: number | null;
}

interface AdpEntry extends AdpRow {
  playerId: string | null;
  position: string | null;
  /** Keeper cost round, derived from Sleeper ADP and league size. */
  round: number | null;
}

/** Strips tags and decodes the handful of entities the page actually emits. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const num = (s: string): number | null => {
  const v = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
};

/**
 * Parses the ADP table.
 *
 * Row shape is: rank | name+team | consensus | Sleeper | ESPN | Yahoo |
 * Underdog | FantasyPros. Name and team share one cell.
 */
function parseTable(html: string): AdpRow[] {
  const rows: AdpRow[] = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 4) continue;

    const rank = num(text(cells[0]));
    if (rank === null) continue;

    // The team is the trailing <span> inside the name cell.
    const nameCell = cells[1];
    const teamMatch = nameCell.match(/<span[^>]*>([A-Z]{2,4})<\/span>/);
    const team = teamMatch?.[1] ?? null;
    const name = text(nameCell.replace(/<span[\s\S]*?<\/span>/g, ""));
    if (!name) continue;

    rows.push({
      rank,
      name,
      team,
      consensus: num(text(cells[2])),
      sleeper: num(text(cells[3])),
    });
  }
  return rows;
}

/**
 * Names beatadp renders differently from Sleeper. These are nicknames rather
 * than spelling variants, so no amount of normalisation catches them — the
 * mapping has to be explicit. Keys and values are both pre-normalisation.
 */
const NAME_ALIASES: Record<string, string> = {
  "Cameron Ward": "Cam Ward",
  "Bam Knight": "Zonovan Knight",
  "Hollywood Brown": "Marquise Brown",
  "Kenneth Gainwell": "Kenny Gainwell",
};

/** Normalises a name for matching: lowercase, no punctuation, no suffix. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

async function loadPlayerMap(): Promise<Record<string, SleeperPlayer>> {
  const cachePath = join(CACHE_DIR, "players-nfl.json");
  const cached = readJson<Record<string, SleeperPlayer>>(cachePath);
  if (cached && fileAgeMs(cachePath) < 24 * 60 * 60 * 1000) {
    log.skip("using cached player map");
    return cached;
  }
  log.info("fetching player map (~5MB)");
  const all = await getAllPlayers();
  if (!all) throw new Error("could not load player map");
  writeJson(cachePath, all);
  return all;
}

async function captureFor(slug: string, lock = LOCK, season = SEASON): Promise<void> {
  const outPath = join(dataDir(slug), "adp", lock ? `${season}.json` : "live.json");

  if (lock) {
    const existing = readJson<{ capturedAt: string }>(outPath);
    if (existing && !FORCE) {
      log.warn(
        `${season} ADP was already frozen at ${existing.capturedAt}. ` +
          `Bylaws 1.7.2.2.1 fixes ADP before the keeper deadline — pass --force to overwrite.`,
      );
      return;
    }
  }

  const rules = readJson<{ teams: number }>(join(configDir(slug), "rules", `${season}.json`));
  const teams = rules?.teams ?? 10;

  log.step(`Capturing ${season} Sleeper ADP (${lock ? "FROZEN snapshot" : "live refresh"})`);
  log.info(`source: ${SOURCE} (PPR · Redraft · 1QB — the page's default state)`);

  const res = await fetch(SOURCE, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${SOURCE} returned HTTP ${res.status}`);
  const rows = parseTable(await res.text());
  if (rows.length < 50) {
    throw new Error(
      `Only parsed ${rows.length} rows — beatadp's markup likely changed. Check parseTable().`,
    );
  }
  log.info(`${rows.length} rows parsed`);

  const players = await loadPlayerMap();

  // Index by normalised name. Collisions are rare but real (two "Michael
  // Carter"s), so team breaks the tie when available.
  const byName = new Map<string, SleeperPlayer[]>();
  for (const p of Object.values(players)) {
    if (!p.player_id) continue;
    const full = p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`;
    const key = normalise(full);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }

  let matched = 0;
  const entries: AdpEntry[] = rows.map((r) => {
    const lookupName = NAME_ALIASES[r.name] ?? r.name;
    const candidates = byName.get(normalise(lookupName)) ?? [];
    const hit =
      candidates.find((c) => r.team && c.team === r.team) ??
      // Fall back to the fantasy-relevant candidate when the team disagrees
      // (mid-offseason trades make beatadp and Sleeper briefly disagree).
      candidates.find((c) => c.position && ["QB", "RB", "WR", "TE", "K"].includes(c.position)) ??
      candidates[0];
    if (hit) matched++;

    return {
      ...r,
      playerId: hit?.player_id ?? null,
      position: hit?.position ?? null,
      // ADP is an overall pick number; a round in OUR league is `teams` picks
      // wide, so pick 15 in a 10-team league is round 2.
      round: r.sleeper === null ? null : Math.max(1, Math.ceil(r.sleeper / teams)),
    };
  });

  const unmatched = entries.filter((e) => !e.playerId);
  log.info(`matched ${matched}/${entries.length} to Sleeper player IDs`);
  if (unmatched.length) {
    log.warn(`unmatched (${unmatched.length}): ${unmatched.slice(0, 8).map((u) => u.name).join(", ")}${unmatched.length > 8 ? "…" : ""}`);
  }

  writeJson(outPath, {
    season: Number(season),
    source: SOURCE,
    scoring: "ppr",
    format: "redraft",
    quarterbacks: 1,
    leagueTeams: teams,
    frozen: lock,
    // For the frozen file this timestamp is the whole point; for live.json it
    // just tells the UI how stale the number on screen is.
    capturedAt: new Date().toISOString(),
    note:
      "Sleeper publishes no ADP via API; this is scraped from beatadp.com's server-rendered Sleeper column. " +
      "`round` converts Sleeper ADP to a keeper cost round for this league's size.",
    entries,
  });
  log.write(`data/${slug}/adp/${lock ? season : "live"}.json (${entries.length} players)`);

  if (!lock) return;

  log.step("Round breakdown");
  for (let round = 1; round <= 17; round++) {
    const inRound = entries.filter((e) => e.round === round);
    if (!inRound.length) continue;
    const names = inRound.slice(0, 3).map((e) => e.name).join(", ");
    log.info(`R${String(round).padStart(2)} · ${String(inRound.length).padStart(3)} players · ${names}${inRound.length > 3 ? "…" : ""}`);
  }
}

/**
 * The season the keeper cycle is pricing — the same rule `keeperCycleSeason()`
 * uses on the read side, from the same committed files.
 *
 * A DRAFT ADVANCES IT, not a finished season: contracts roll onto the next year
 * the moment a draft is archived, months before the season it belongs to ends.
 */
function cycleSeason(slug: string): number {
  const seasons =
    readJson<Array<{ season: number }>>(join(dataDir(slug), "derived", "seasons.json")) ?? [];
  const drafts =
    readJson<Array<{ season: number }>>(join(dataDir(slug), "derived", "drafts.json")) ?? [];
  return Math.max(0, ...seasons.map((x) => x.season), ...drafts.map((x) => x.season)) + 1;
}

/**
 * Whether the bylaw window has opened and nothing has been frozen yet.
 *
 * ASKS SLEEPER FOR THE DRAFT DATE, because that is the only place it exists —
 * nothing is committed until the draft has actually run. Returns false for every
 * reason it might not apply: no draft scheduled, no date set, already drafted,
 * already frozen, or simply too early.
 */
async function lockIsDue(slug: string, season: number): Promise<boolean> {
  if (readJson(join(dataDir(slug), "adp", `${season}.json`))) return false;

  const cfg = readJson<{ knownLeagueIds: Record<string, string> }>(
    join(configDir(slug), "league.json"),
  );
  const leagueId = cfg?.knownLeagueIds[String(season)];
  if (!leagueId) {
    log.info(`no ${season} league id yet — nothing to freeze against`);
    return false;
  }

  const draftId = (await getLeague(leagueId))?.draft_id;
  const draft = draftId ? await getDraft(draftId) : null;
  if (!draft?.start_time) {
    log.info(`${season} draft has no date set — ADP stays live`);
    return false;
  }
  // A draft that has already run freezes nothing: the cycle is about to advance
  // and the next season's market is the one that matters.
  if (draft.status === "complete") return false;

  const opens = lockOpensAt(draft.start_time);
  if (Date.now() < opens) {
    const days = Math.ceil((opens - Date.now()) / 86_400_000);
    log.info(`${season} ADP locks in ${days} day${days === 1 ? "" : "s"} — staying live`);
    return false;
  }
  return true;
}

// Only leagues that use keepers need ADP; it exists to reprice expired contracts.
for (const league of resolveLeagues(process.argv.slice(2))) {
  if (!league.features?.adp) {
    log.skip(`${league.slug} — ADP not enabled for this league`);
    continue;
  }
  log.step(`■ ${league.name} (${league.slug})`);

  if (!AUTO) {
    await captureFor(league.slug);
    continue;
  }

  // Live ALWAYS refreshes, even inside the lock window. The frozen file is what
  // the site reads there, so keeping live.json current costs nothing and means
  // the market is already up to date the moment the cycle advances.
  const season = cycleSeason(league.slug);
  await captureFor(league.slug, false, String(season));
  if (await lockIsDue(league.slug, season)) {
    log.info(`bylaws 1.7.2.2.1 window is open — freezing ${season}`);
    // A second scrape rather than reusing the first. It happens on exactly one
    // day per year, and threading the parsed rows through would complicate the
    // path that runs the other 364.
    await captureFor(league.slug, true, String(season));
  }
}
