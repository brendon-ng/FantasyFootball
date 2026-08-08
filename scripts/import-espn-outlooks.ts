/**
 * ESPN's written season outlook for each player.
 *
 * The one thing neither provider's structured data can give you. ADP says where
 * the market has him; a projection says how many points; the outlook says WHY —
 * "DJ Moore is no longer on the roster, he's a lock for a larger role". That is
 * the reasoning a keeper decision actually turns on, and it exists nowhere else
 * in this pipeline.
 *
 * NOT ON `kona_playercard`, which is where the transactions importer looks and
 * where you would reasonably expect it. The field is `seasonOutlook` and it is
 * exposed by `view=kona_player_info` on the GLOBAL players endpoint:
 *
 *   /apis/v3/games/ffl/seasons/<year>/players?view=kona_player_info
 *
 * NO LEAGUE, NO AUTH. Every other ESPN importer here is scoped to one of this
 * league's own ids; this one is not, because the outlook is a fact about a
 * player rather than about a league. That matters — Den Ops has no ESPN league
 * after 2023, so a league-scoped route would have died with the move to Sleeper.
 *
 * RUN ONCE A YEAR, BY HAND. Deliberately NOT in `archive.yml`:
 *
 *   - The payload is 38MB and `limit` is ignored on the global endpoint, so
 *     there is no cheap version of this request.
 *   - Outlooks are written in the preseason and then left alone. Fetching daily
 *     would cost 38MB a day to rewrite the same file.
 *   - They go stale the moment the season starts, and a stale outlook that keeps
 *     refreshing its timestamp looks current when it is not. `capturedAt` says
 *     when it was written so the UI can admit its age.
 *
 * SHARED ACROSS LEAGUES, like `players.json` and `player-teams.json`: what ESPN
 * thinks of a player is a fact about the NFL, not about a fantasy league.
 *
 *   npm run import:espn:outlooks              # the upcoming season
 *   npm run import:espn:outlooks -- --season=2027
 *   npm run import:espn:outlooks -- --force   # refetch even if today's file exists
 */

import { join } from "node:path";

import { API, matchPlayer, sleeperIndex, type EspnPlayer } from "./lib/espn.ts";
import { SHARED_DATA_DIR, log, readJson, writeJson } from "./lib/io.ts";

const OUT = join(SHARED_DATA_DIR, "espn-outlooks.json");

export interface OutlookFile {
  season: number;
  capturedAt: string;
  source: string;
  /** Sleeper player id -> the outlook text. */
  outlooks: Record<string, string>;
}

/**
 * A sort is load-bearing, not decorative.
 *
 * ESPN rejects a bare `limit` — "Limit request must be accompanied by a sort" —
 * and the same filter shape is what the transactions importer sends. The limit
 * itself is ignored on this endpoint (all 11,529 players come back regardless),
 * but the filter must still be well-formed or the request 400s.
 */
const FILTER = JSON.stringify({
  players: { limit: 2000, offset: 0, sortPercOwned: { sortPriority: 1, sortAsc: false } },
});

interface CardPlayer extends EspnPlayer {
  seasonOutlook?: string | null;
}

const args = new Set(process.argv.slice(2));
const arg = (name: string): string | null => {
  for (const a of args) if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  return null;
};

/** The season being drafted — outlooks are written for the year ahead. */
const season = Number(arg("season") ?? new Date().getFullYear());
const force = args.has("--force");

const existing = readJson<OutlookFile>(OUT);
if (existing?.season === season && !force) {
  log.info(
    `${OUT} already holds ${Object.keys(existing.outlooks).length} outlooks for ${season} ` +
      `(captured ${existing.capturedAt.slice(0, 10)}). Pass --force to refetch.`,
  );
  process.exit(0);
}

const url = `${API}/${season}/players?view=kona_player_info`;
log.info(`Fetching ${season} outlooks — this is a ~38MB response, give it a moment`);

const res = await fetch(url, { headers: { "x-fantasy-filter": FILTER } });
if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
const body = (await res.json()) as { players?: Array<{ player?: CardPlayer }> } | CardPlayer[];
const rows: CardPlayer[] = Array.isArray(body)
  ? body
  : (body.players ?? []).map((r) => r.player).filter((p): p is CardPlayer => Boolean(p));

log.info(`${rows.length} players in the response`);

const idx = sleeperIndex();
const outlooks: Record<string, string> = {};
const renamed: string[] = [];
const ambiguous: string[] = [];
const unresolved: string[] = [];
let withText = 0;

for (const p of rows) {
  const text = p.seasonOutlook?.trim();
  if (!text) continue;
  withText++;

  const m = matchPlayer(p, idx);
  if (!m.matched) {
    unresolved.push(p.fullName);
    continue;
  }
  // First writer wins. The response is sorted by percent owned, so where two
  // ESPN rows collapse onto one Sleeper id the more relevant player's outlook
  // is the one already in place.
  if (outlooks[m.id]) continue;
  outlooks[m.id] = text;
  if (m.renamed) renamed.push(m.renamed);
  if (m.ambiguous) ambiguous.push(m.ambiguous);
}

/**
 * Two reports, and they are the only output a human has to read.
 *
 * `ambiguous` is the dangerous one — the names agree, so a wrong match is
 * invisible: the outlook simply describes a different person, plausibly, in a
 * panel nobody cross-checks.
 */
if (renamed.length) {
  log.info(`spelled differently in the two databases (${renamed.length}):`);
  for (const r of renamed.slice(0, 20)) log.skip(r);
}
if (ambiguous.length) {
  log.warn(`SAME NAME, SEVERAL CANDIDATES (${ambiguous.length}) — check these:`);
  for (const a of ambiguous) log.skip(a);
}
if (unresolved.length) {
  log.info(`no Sleeper player found (${unresolved.length}) — usually practice-squad depth`);
  for (const u of unresolved.slice(0, 10)) log.skip(u);
}

writeJson(OUT, {
  season,
  capturedAt: new Date().toISOString(),
  source: url,
  outlooks,
} satisfies OutlookFile);

log.write(
  `espn-outlooks.json — ${Object.keys(outlooks).length} outlooks for ${season} ` +
    `(${withText} had text, ${unresolved.length} unmatched)`,
);
