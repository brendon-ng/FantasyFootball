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
 *   npm run adp                  capture for the upcoming season
 *   npm run adp -- --force       re-capture, overwriting the frozen snapshot
 *   npm run adp -- --season=2027
 */

import { join } from "node:path";

import { getAllPlayers, type SleeperPlayer } from "../lib/sleeper.ts";
import { CACHE_DIR, DATA_DIR, fileAgeMs, log, readJson, writeJson } from "./lib/io.ts";

const SOURCE = "https://www.beatadp.com/platform-adp";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
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

async function main(): Promise<void> {
  const outPath = join(DATA_DIR, "adp", `${SEASON}.json`);
  const existing = readJson<{ capturedAt: string }>(outPath);
  if (existing && !FORCE) {
    log.warn(
      `${SEASON} ADP was already frozen at ${existing.capturedAt}. ` +
        `Bylaws 1.7.2.2.1 fixes ADP before the keeper deadline — pass --force to overwrite.`,
    );
    return;
  }

  const rules = readJson<{ teams: number }>(
    join(DATA_DIR, "..", "config", "rules", `${SEASON}.json`),
  );
  const teams = rules?.teams ?? 10;

  log.step(`Capturing ${SEASON} Sleeper ADP`);
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
    season: Number(SEASON),
    source: SOURCE,
    scoring: "ppr",
    format: "redraft",
    quarterbacks: 1,
    leagueTeams: teams,
    // Frozen timestamp — this is the whole point of the file.
    capturedAt: new Date().toISOString(),
    note:
      "Sleeper publishes no ADP via API; this is scraped from beatadp.com's server-rendered Sleeper column. " +
      "`round` converts Sleeper ADP to a keeper cost round for this league's size.",
    entries,
  });
  log.write(`data/adp/${SEASON}.json (${entries.length} players)`);

  log.step("Round breakdown");
  for (let round = 1; round <= 17; round++) {
    const inRound = entries.filter((e) => e.round === round);
    if (!inRound.length) continue;
    const names = inRound.slice(0, 3).map((e) => e.name).join(", ");
    log.info(`R${String(round).padStart(2)} · ${String(inRound.length).padStart(3)} players · ${names}${inRound.length > 3 ? "…" : ""}`);
  }
}

await main();
