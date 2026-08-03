/**
 * Imports pre-Sleeper seasons (2020-2023) from saved ESPN Fantasy MHTML pages
 * into `data/manual/<season>.json`. Run with `npm run import:espn`.
 *
 * Those seasons predate the league's move to Sleeper, so there is no API to
 * query — only two archived pages per season. What they contain:
 *
 *   Standings page  final placement, team name, owner name(s), record, PF, PA
 *   Playoffs page   three bracket sections with every score
 *
 * What they do NOT contain: individual weekly matchups, rosters, drafts or
 * transactions. So imported seasons contribute to standings, finishes and
 * head-to-head-free records only — never to weekly highs, player records or
 * keeper contracts. `scripts/derive.ts` enforces that separation.
 *
 * The two pages cross-validate: the standings RK column must equal the final
 * placement derived independently from the brackets. The import fails if they
 * disagree, which is the whole reason to parse both.
 *
 * FORMAT NOTE — the consolation ladder is not a bracket. Teams are seeded into a
 * first matchup; winning moves you up a rung, losing moves you down, and the
 * loser of the bottom rung in the final week finishes last. ESPN encodes the
 * routing directly ("GmC1 - W to GmC4, L to GmC5"), which is what makes it
 * reconstructable.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";

// Set per league before importing.
let SOURCE_DIR!: string;
let MANUAL_DIR!: string;
let CONFIG_DIR!: string;

interface OwnerConfig {
  slug: string;
  firstName: string;
  lastName: string;
  espnNames?: string[];
}

// --- MHTML / HTML helpers ----------------------------------------------------

/**
 * Pulls the largest text/html part out of an MHTML archive.
 *
 * The boundary must be read from the Content-Type header, not guessed. Blink
 * writes boundaries that themselves contain "--" ("----MultipartBoundary--…"),
 * and ESPN's markup contains lines beginning "--cell points-against-avg", so
 * splitting on a generic /^--/ shreds the file mid-table.
 *
 * Read as latin1 so quoted-printable "=XX" escapes map to exact bytes, then
 * reinterpret the assembled bytes as UTF-8.
 */
function mhtmlBody(path: string): string {
  const raw = readFileSync(path, "latin1");

  const boundary = raw.slice(0, 4096).match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  if (!boundary) throw new Error(`No MIME boundary declared in ${path}`);

  let best = "";
  for (const part of raw.split(`--${boundary}`)) {
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd).toLowerCase();
    if (!headers.includes("text/html")) continue;
    let content = part.slice(headerEnd).trim();
    if (headers.includes("quoted-printable")) content = decodeQuotedPrintable(content);
    if (content.length > best.length) best = content;
  }
  if (!best) throw new Error(`No text/html part in ${path}`);
  return Buffer.from(best, "latin1").toString("utf8");
}

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const stripTags = (s: string) =>
  decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
  };
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gi, (m, e: string) => {
    const key = e.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith("#x")) return String.fromCharCode(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCharCode(parseInt(key.slice(1), 10));
    return m;
  });
}

/** Flattens markup to a token stream, which is how the bracket is read. */
function tokens(html: string): string[] {
  const cleaned = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  return cleaned
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((l) => decodeEntities(l).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// --- owner resolution --------------------------------------------------------

const slugByName = new Map<string, string>();

/** Rebuilds the ESPN-name lookup for the league being imported. */
function loadOwnerAliases(): void {
  slugByName.clear();
  const cfg = readJson<{ owners: OwnerConfig[] }>(join(CONFIG_DIR, "league.json"));
  for (const o of cfg?.owners ?? []) {
    slugByName.set(`${o.firstName} ${o.lastName}`.toLowerCase(), o.slug);
    for (const alias of o.espnNames ?? []) slugByName.set(alias.toLowerCase(), o.slug);
  }
}

/**
 * "Olivia Nelli, Lauren Gross" is a co-owned team, and every listed owner is
 * credited. The first name is the primary, which becomes the team's slug.
 */
function resolveOwners(raw: string): string[] {
  const slugs = raw.split(",").map((n) => {
    const key = n.trim().toLowerCase();
    const slug = slugByName.get(key);
    if (!slug) {
      throw new Error(
        `ESPN owner "${n.trim()}" is not in config/league.json. Add them (with espnNames if the label differs).`,
      );
    }
    return slug;
  });
  return [...new Set(slugs)];
}

// --- standings ---------------------------------------------------------------

interface ImportedTeam {
  finalPlace: number;
  teamName: string;
  teamSlug: string;
  ownerSlugs: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  seed: number | null;
}

function parseStandings(html: string): ImportedTeam[] {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error("No standings table found");

  const out: ImportedTeam[] = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 5 || !/^\d+$/.test(cells[0])) continue;

    // "Team Name (Owner One, Owner Two)"
    const m = cells[1].match(/^(.*)\s+\(([^)]+)\)$/);
    if (!m) throw new Error(`Cannot split team/owner from "${cells[1]}"`);
    const ownerSlugs = resolveOwners(m[2]);
    const [w, l, t] = cells[2].split("-").map(Number);

    out.push({
      finalPlace: Number(cells[0]),
      teamName: m[1].trim(),
      teamSlug: ownerSlugs[0],
      ownerSlugs,
      wins: w,
      losses: l,
      ties: t || 0,
      pointsFor: Number(cells[3]),
      pointsAgainst: Number(cells[4]),
      seed: null,
    });
  }
  return out.sort((a, b) => a.finalPlace - b.finalPlace);
}

// --- playoffs ----------------------------------------------------------------

interface ImportedGame {
  section: "winners" | "winners-consolation" | "consolation";
  round: number;
  week: number | null;
  gameId: string | null;
  /** Routing ESPN prints for ladder games, e.g. "W to GmC4, L to GmC5". */
  routing: string | null;
  teams: Array<{ seed: number; teamName: string; points: number }>;
}

const SECTION_OF: Record<string, ImportedGame["section"]> = {
  "WINNER'S BRACKET": "winners",
  "WINNER'S CONSOLATION LADDER": "winners-consolation",
  "CONSOLATION LADDER": "consolation",
};

/**
 * Games per round, per section, for this league's shape (12 teams, 6 in the
 * playoff bracket). Rounds CANNOT be read from position in the document:
 * ESPN emits every "ROUND n | NFL Week w" header up front as column labels,
 * then all the entrants afterwards, so a positional reading stamps every game
 * with the last header seen.
 *
 * winners             R1: 2 games + 2 byes, R2: 2, final: 1
 * winners-consolation R2: 1 game (the two R1 losers), R3: 2 (3rd and 5th place)
 * consolation ladder  3 games per round for 3 rounds, ordered GmC1..GmC9
 */
const ROUND_SHAPE: Record<ImportedGame["section"], number[]> = {
  winners: [2, 2, 1],
  "winners-consolation": [1, 2],
  consolation: [3, 3, 3],
};

/** Which round index each section starts at (the ladders skip round 1 or not). */
const SECTION_FIRST_ROUND: Record<ImportedGame["section"], number> = {
  winners: 1,
  "winners-consolation": 2,
  consolation: 1,
};

/**
 * Reads the bracket pages.
 *
 * ESPN renders each entrant as the run: seed, team name, "(", record+division,
 * ")", score. Entrants are paired GREEDILY as they arrive — a "BYE" token closes
 * the current single entrant immediately. Deferring the pairing lets a bye shift
 * every subsequent matchup by one, silently inventing games that never happened.
 */
function parsePlayoffs(html: string): ImportedGame[] {
  const toks = tokens(html);
  const games: ImportedGame[] = [];

  let section: ImportedGame["section"] | null = null;
  /** Weeks announced by the round headers, in order, per section. */
  const weeksBySection = new Map<ImportedGame["section"], number[]>();
  let pending: ImportedGame["teams"] = [];

  const emit = (teams: ImportedGame["teams"]) => {
    games.push({
      section: section!,
      round: 0, // assigned below from ROUND_SHAPE
      week: null,
      gameId: null,
      routing: null,
      teams,
    });
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];

    if (SECTION_OF[tok.toUpperCase()]) {
      pending = [];
      section = SECTION_OF[tok.toUpperCase()];
      continue;
    }
    if (!section) continue;

    const header = tok.match(/^(?:ROUND \d+|Championship)\s*\|\s*NFL Week (\d+)$/i);
    if (header) {
      const list = weeksBySection.get(section) ?? [];
      list.push(Number(header[1]));
      weeksBySection.set(section, list);
      continue;
    }

    // ESPN prints the ladder label AFTER its game ("… 109.72 | GmC1 - W to
    // GmC4, L to GmC5"), so it belongs to the game just emitted. Attaching it
    // to the next one shifts every id and routing by one.
    const label = tok.match(/^(Gm[A-Z]?\d+)(?:\s*-\s*(.*))?$/);
    if (label) {
      const last = games[games.length - 1];
      if (last && last.section === section && !last.gameId) {
        last.gameId = label[1];
        last.routing = label[2] ?? null;
      }
      continue;
    }

    if (tok.toUpperCase() === "BYE") {
      if (pending.length === 1) emit(pending.splice(0));
      continue;
    }

    // seed, name, "(", record, ")", score
    if (/^\d{1,2}$/.test(tok) && toks[i + 2] === "(" && toks[i + 4] === ")") {
      const score = Number(toks[i + 5]);
      if (Number.isFinite(score)) {
        pending.push({ seed: Number(tok), teamName: toks[i + 1], points: score });
        i += 5;
        if (pending.length === 2) emit(pending.splice(0));
        continue;
      }
    }
  }

  // Assign rounds and weeks from the known shape. Ladder games carry explicit
  // GmC ids, so those are authoritative where present.
  for (const sec of Object.keys(ROUND_SHAPE) as Array<ImportedGame["section"]>) {
    const inSection = games.filter((g) => g.section === sec);
    const weeks = weeksBySection.get(sec) ?? [];
    const shape = ROUND_SHAPE[sec];
    const firstRound = SECTION_FIRST_ROUND[sec];

    // Byes are round-1 entries and are not part of the game-count shape.
    const byes = inSection.filter((g) => g.teams.length === 1);
    for (const b of byes) {
      b.round = firstRound;
      b.week = weeks[0] ?? null;
    }

    const real = inSection.filter((g) => g.teams.length === 2);
    let idx = 0;
    for (let r = 0; r < shape.length; r++) {
      for (let k = 0; k < shape[r] && idx < real.length; k++, idx++) {
        real[idx].round = firstRound + r;
        real[idx].week = weeks[r] ?? null;
      }
    }
    if (idx !== real.length) {
      throw new Error(
        `${sec}: parsed ${real.length} games but ROUND_SHAPE accounts for ${idx}. The archived page's layout differs from the expected 12-team format.`,
      );
    }
  }

  return games;
}

/**
 * Recomputes final placement from the brackets alone and checks it against
 * ESPN's RK column.
 *
 * This is the reason both pages are parsed rather than just the standings. The
 * two are produced independently by ESPN, so agreement is strong evidence the
 * ladder was reconstructed correctly — and a silent misread of the ladder would
 * otherwise corrupt the last-place record, which the league cares about most.
 */
function crossValidate(season: number, standings: ImportedTeam[], games: ImportedGame[]): void {
  const finalRound = Math.max(...games.map((g) => g.round));
  const derived = new Map<string, number>();

  const decide = (g: ImportedGame, betterPlace: number) => {
    const [a, b] = g.teams;
    const [w, l] = a.points > b.points ? [a, b] : [b, a];
    derived.set(w.teamName, betterPlace);
    derived.set(l.teamName, betterPlace + 1);
  };

  const inRound = (sec: ImportedGame["section"]) =>
    games.filter((g) => g.section === sec && g.round === finalRound && g.teams.length === 2);

  for (const g of inRound("winners")) decide(g, 1);

  // 3rd-place game involves better seeds than the 5th-place game.
  const wc = inRound("winners-consolation").sort(
    (x, y) => Math.min(...x.teams.map((t) => t.seed)) - Math.min(...y.teams.map((t) => t.seed)),
  );
  wc.forEach((g, i) => decide(g, 3 + 2 * i));

  // Ladder finals are ordered by game id: GmC7 -> 7/8, GmC8 -> 9/10, GmC9 -> 11/12.
  const cl = inRound("consolation").sort((x, y) => (x.gameId ?? "").localeCompare(y.gameId ?? ""));
  cl.forEach((g, i) => decide(g, 7 + 2 * i));

  const mismatches = standings.filter((r) => derived.get(r.teamName) !== r.finalPlace);
  if (mismatches.length) {
    const detail = mismatches
      .map((r) => `${r.teamName}: ESPN RK ${r.finalPlace} vs bracket ${derived.get(r.teamName) ?? "none"}`)
      .join("; ");
    throw new Error(`${season}: standings and brackets disagree — ${detail}`);
  }
  log.info(`${standings.length}/${standings.length} placements cross-validate against the brackets`);
}

// --- main --------------------------------------------------------------------

interface SeasonSources {
  standings: string;
  playoffs: string;
  /** week -> scoreboard page. Optional; only some seasons have been recovered. */
  weeks: Map<number, string>;
}

interface WeeklyMatchup {
  week: number;
  kind: "regular" | "playoff" | "consolation";
  home: { ownerSlug: string; points: number };
  away: { ownerSlug: string; points: number };
}

/**
 * Weekly matchups for a season, if its scoreboards were recovered.
 *
 * CROSS-VALIDATED, not trusted. Every team's regular-season scores must sum to
 * its standings Points For, and its win-loss-tie derived from those games must
 * equal the standings record — otherwise a mis-parsed or missing week would
 * quietly corrupt every all-time record. Both are exact matches, and the import
 * throws rather than writing something that disagrees with itself.
 *
 * Postseason weeks are classified against the bracket, which is the only source
 * that knows whether a given game was a playoff or a consolation match.
 */
function buildWeeklyMatchups(
  season: number,
  weekFiles: Map<number, string>,
  standings: ImportedTeam[],
  games: ImportedGame[],
  playoffWeekStart: number,
): WeeklyMatchup[] {
  if (!weekFiles.size) return [];

  const slugOfTeam = new Map(
    standings.map((r) => [normaliseTeamName(r.teamName), r.ownerSlugs[0]]),
  );
  const resolve = (teamName: string): string => {
    const slug = slugOfTeam.get(normaliseTeamName(teamName));
    if (!slug) {
      throw new Error(
        `${season}: scoreboard team "${teamName}" is not in the standings page. ` +
          `Team names must match between the two archives.`,
      );
    }
    return slug;
  };

  // Bracket section by week and unordered slug pair, so a postseason game is
  // labelled by what it actually was rather than by which week it fell in.
  const sectionOf = new Map<string, ImportedGame["section"]>();
  for (const g of games) {
    if (g.week == null || g.teams.length < 2) continue;
    const pair = g.teams
      .map((t: { teamName: string }) => slugOfTeam.get(normaliseTeamName(t.teamName)) ?? t.teamName)
      .sort();
    sectionOf.set(`${g.week}:${pair.join("|")}`, g.section);
  }

  const out: WeeklyMatchup[] = [];
  for (const week of [...weekFiles.keys()].sort((a, b) => a - b)) {
    const parsed = parseWeek(mhtmlBody(weekFiles.get(week)!));
    if (!parsed.length) throw new Error(`${season} week ${week}: no games parsed`);
    for (const g of parsed) {
      const home = { ownerSlug: resolve(g.home.teamName), points: g.home.points };
      const away = { ownerSlug: resolve(g.away.teamName), points: g.away.points };
      let kind: WeeklyMatchup["kind"] = "regular";
      if (week >= playoffWeekStart) {
        const section = sectionOf.get(
          `${week}:${[home.ownerSlug, away.ownerSlug].sort().join("|")}`,
        );
        kind = section === "winners" ? "playoff" : "consolation";
      }
      out.push({ week, kind, home, away });
    }
  }

  // --- the invariants ---
  const pf = new Map<string, number>();
  const rec = new Map<string, { w: number; l: number; t: number }>();
  const bump = (slug: string, k: "w" | "l" | "t") => {
    const r = rec.get(slug) ?? { w: 0, l: 0, t: 0 };
    r[k] += 1;
    rec.set(slug, r);
  };
  for (const m of out.filter((m) => m.week < playoffWeekStart)) {
    for (const side of [m.home, m.away]) {
      pf.set(side.ownerSlug, Number(((pf.get(side.ownerSlug) ?? 0) + side.points).toFixed(2)));
    }
    if (m.home.points > m.away.points) {
      bump(m.home.ownerSlug, "w");
      bump(m.away.ownerSlug, "l");
    } else if (m.away.points > m.home.points) {
      bump(m.away.ownerSlug, "w");
      bump(m.home.ownerSlug, "l");
    } else {
      bump(m.home.ownerSlug, "t");
      bump(m.away.ownerSlug, "t");
    }
  }

  for (const row of standings) {
    const slug = row.ownerSlugs[0];
    const got = pf.get(slug);
    if (got == null || Math.abs(got - row.pointsFor) > 0.05) {
      throw new Error(
        `${season}: ${slug} scores sum to ${got ?? 0} across the weekly pages but the ` +
          `standings say ${row.pointsFor}. A week is missing or mis-parsed.`,
      );
    }
    const r = rec.get(slug) ?? { w: 0, l: 0, t: 0 };
    if (r.w !== row.wins || r.l !== row.losses || r.t !== row.ties) {
      throw new Error(
        `${season}: ${slug} is ${r.w}-${r.l}-${r.t} across the weekly pages but the ` +
          `standings say ${row.wins}-${row.losses}-${row.ties}.`,
      );
    }
  }
  log.info(
    `${standings.length}/${standings.length} teams reconcile on points for and record`,
  );
  return out;
}

function seasonFiles(): Map<number, SeasonSources> {
  const files = existsSync(SOURCE_DIR) ? readdirSync(SOURCE_DIR) : [];
  const found = new Map<number, SeasonSources>();
  const entry = (year: number): SeasonSources => {
    const e = found.get(year) ?? { standings: "", playoffs: "", weeks: new Map() };
    found.set(year, e);
    return e;
  };

  for (const f of files) {
    const season = f.match(/(\d{4})(Standings|Playoffs)\.mhtml$/i);
    if (season) {
      const e = entry(Number(season[1]));
      if (season[2].toLowerCase() === "standings") e.standings = join(SOURCE_DIR, f);
      else e.playoffs = join(SOURCE_DIR, f);
      continue;
    }
    // Weekly scoreboards, e.g. DenOps2019W7.mhtml / DenOps2019W14playoffs.mhtml.
    const week = f.match(/(\d{4})W(\d{1,2})[a-z]*\.mhtml$/i);
    if (week) entry(Number(week[1])).weeks.set(Number(week[2]), join(SOURCE_DIR, f));
  }
  return found;
}

// --- weekly scoreboards ------------------------------------------------------

interface WeekSide {
  teamName: string;
  points: number;
}

/**
 * Team names as a join key.
 *
 * The two archives disagree on internal whitespace — 2021's scoreboard renders
 * "She Doesn't  Even Go Here" with a double space where the standings page has
 * one. The standings parser already collapses runs on its way through, so this
 * makes the weekly side match rather than failing a real team.
 */
const normaliseTeamName = (s: string): string =>
  decodeEntities(s).replace(/\s+/g, " ").trim();

/**
 * One week's games from an archived ESPN scoreboard.
 *
 * Joined on TEAM NAME rather than ESPN's numeric teamId. The id is stable and
 * tempting, but the standings page only labels 11 of 12 teams with an owner — the
 * logged-in account is listed separately as "My Team" with no owner attached — so
 * an id-based join silently loses one team. Both pages were archived at the same
 * moment, so their team names agree exactly; the importer throws below if any
 * name fails to resolve.
 */
function parseWeek(html: string): Array<{ away: WeekSide; home: WeekSide }> {
  const nameById = new Map<string, string>();
  for (const m of html.matchAll(
    /teamId=(\d+)&amp;scoringPeriodId=\d+"[^>]*>[\s\S]{0,400}?ScoreCell__TeamName[^>]*>([^<]+)</g,
  )) {
    if (!nameById.has(m[1])) nameById.set(m[1], normaliseTeamName(m[2]));
  }

  const out: Array<{ away: WeekSide; home: WeekSide }> = [];
  for (const block of html.matchAll(
    /<ul class="ScoreboardScoreCell__Competitors[^"]*"[^>]*>([\s\S]*?)<\/ul>/g,
  )) {
    const sides: Record<string, WeekSide> = {};
    for (const item of block[1].matchAll(
      /ScoreboardScoreCell__Item--(away|home)[^"]*"([\s\S]*?)(?=<li class="ScoreboardScoreCell__Item|$)/g,
    )) {
      const id = item[2].match(/teamId=(\d+)/)?.[1];
      const score = item[2].match(/ScoreCell__Score[^>]*>([\d.]+)</)?.[1];
      const teamName = id ? nameById.get(id) : undefined;
      if (teamName && score != null) sides[item[1]] = { teamName, points: Number(score) };
    }
    if (sides.away && sides.home) out.push({ away: sides.away, home: sides.home });
  }
  return out;
}

for (const league of resolveLeagues(process.argv.slice(2))) {
  if (!league.features?.espnImport) {
    log.skip(`${league.slug} — no ESPN history to import`);
    continue;
  }
  CONFIG_DIR = configDir(league.slug);
  MANUAL_DIR = join(dataDir(league.slug), "manual");
  SOURCE_DIR = join(MANUAL_DIR, "source");
  loadOwnerAliases();

  log.step(`■ ${league.name} (${league.slug})`);
  const bySeason = seasonFiles();
  if (!bySeason.size) {
    log.warn(`no MHTML files in ${SOURCE_DIR}`);
    continue;
  }

  for (const [season, paths] of [...bySeason].sort((a, b) => a[0] - b[0])) {
  if (!paths.standings || !paths.playoffs) {
    log.warn(`${season}: need both Standings and Playoffs pages — skipping`);
    continue;
  }

  const standings = parseStandings(mhtmlBody(paths.standings));
  const games = parsePlayoffs(mhtmlBody(paths.playoffs));

  // Seeds come only from the bracket pages; every team appears in exactly one
  // of the three sections in round 1, so this covers the whole league.
  const seedByTeam = new Map<string, number>();
  for (const g of games) for (const t of g.teams) if (!seedByTeam.has(t.teamName)) seedByTeam.set(t.teamName, t.seed);
  for (const row of standings) row.seed = seedByTeam.get(row.teamName) ?? null;

  crossValidate(season, standings, games);

  const weeks = games.map((g) => g.week).filter((w): w is number => w != null);
  const playoffWeekStart = Math.min(...weeks);
  const matchups = buildWeeklyMatchups(season, paths.weeks, standings, games, playoffWeekStart);

  writeJson(join(MANUAL_DIR, `${season}.json`), {
    season,
    source: "ESPN Fantasy (imported from archived MHTML)",
    imported: true,
    teams: standings.length,
    playoffWeekStart,
    finalWeek: Math.max(...weeks),
    regularSeasonWeeks: playoffWeekStart - 1,
    // Says plainly what this data cannot support, so derive never over-reaches.
    hasWeeklyMatchups: matchups.length > 0,
    hasRosters: false,
    hasDrafts: false,
    standings,
    games,
    matchups,
  });

  const missingSeed = standings.filter((r) => r.seed == null).length;
  log.write(
    `${MANUAL_DIR.split("/data/")[1]}/${season}.json — ${standings.length} teams, ${games.length} playoff games` +
      (matchups.length ? `, ${matchups.length} weekly matchups` : "") +
      (missingSeed ? `, ${missingSeed} without a seed` : ""),
  );
    log.info(
      `champion ${standings[0].ownerSlugs.join(" + ")} · last ${standings[standings.length - 1].ownerSlugs.join(" + ")}`,
    );
  }
}

log.step("Done");
