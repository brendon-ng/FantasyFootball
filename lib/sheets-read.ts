/**
 * Reading the punishment sheet straight from Google, with no Apps Script.
 *
 * READS ONLY. Writes still go through the Apps Script web app, because they
 * need what only a server has: a lock, a random draw nobody can tamper with,
 * and rules a browser cannot be trusted to enforce. A read needs none of that,
 * and the read was the half that kept failing — the `/exec` redirect is where
 * the slow and broken loads came from. `sheets.googleapis.com` answers directly.
 *
 * A PORT, NOT A REDESIGN. `buildFeed` and `buildBallots` reproduce the script's
 * `getWeeklyPunishments` and `getBallots` line for line and return the same
 * JSON, `ok: false` included, so everything downstream — `parseFeed`,
 * `parseBallotState`, the `ok` checks — cannot tell which one answered. The
 * script is the spec: change the sheet layout and BOTH need updating.
 *
 * THE API KEY IS PUBLIC BY DESIGN. It ships in the page's JavaScript, and is
 * restricted in Google Cloud to the Sheets API and this site's origin. That
 * stops another website borrowing it, but not a script that fakes a Referer —
 * which buys that script read access to a sheet already shared as "anyone with
 * the link can view". Ballots included: the sheet is public, so the secrecy
 * `getBallots` offers was only ever secrecy from the UI.
 *
 * NO CACHE, unlike the script's ten minutes. Every load reads the sheet as it
 * is, so an edit typed straight into it shows on the next reload; at two
 * requests a load this sits far inside the 300-a-minute project quota.
 */

import { fetchScriptJson } from "./apps-script.ts";

/** Where to read from. Null in config means read through Apps Script. */
export interface SheetSource {
  spreadsheetId: string;
  apiKey: string;
  league: string;
}

type Cell = string | number | boolean;
type Grid = Cell[][];
type Headers = Record<string, number>;

const API = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * One API call, through the same retrying transport the script's feed used.
 *
 * It retries timeouts, network errors and non-JSON bodies, and hands back any
 * JSON it gets — which for Google includes a 403 or 429 explained in `error`.
 * Those are not retried: a bad key or a blocked referrer is not going to fix
 * itself on the next attempt.
 */
async function sheetsGet(
  source: SheetSource,
  path: string,
  params: Array<[string, string]>,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams([...params, ["key", source.apiKey]]);
  const { body } = await fetchScriptJson([
    `${API}/${encodeURIComponent(source.spreadsheetId)}${path}?${query}`,
  ]);
  const data = (body ?? {}) as Record<string, unknown>;
  const error = data.error as { message?: string } | undefined;
  if (error) {
    throw new Error(`Google Sheets refused the read: ${error.message ?? "unknown error"}`);
  }
  return data;
}

/** Every tab's title, in sheet order. */
async function listTabs(source: SheetSource): Promise<string[]> {
  const data = await sheetsGet(source, "", [["fields", "sheets.properties.title"]]);
  const sheets = (data.sheets ?? []) as Array<{ properties?: { title?: string } }>;
  return sheets.map((s) => s.properties?.title ?? "");
}

/** A1 notation for a whole tab; a quote inside a title is doubled. */
const wholeTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

/**
 * Several tabs in one request, each shaped like `getDataRange().getValues()`.
 *
 * UNFORMATTED, so numbers are numbers and a checkbox is a boolean — what Apps
 * Script hands its handlers. The one difference is DATES: Apps Script gives a
 * `Date`, the API gives a serial day count, so `processDate` decodes those.
 *
 * PADDED TO A RECTANGLE because the API trims every row's trailing blanks, and
 * the script reads cells past them expecting `''`. An empty tab comes back as
 * one empty cell, as `getDataRange()` does, so `data[0]` always exists.
 */
async function readTabs(source: SheetSource, titles: string[]): Promise<Grid[]> {
  if (!titles.length) return [];
  const data = await sheetsGet(source, "/values:batchGet", [
    ...titles.map((t): [string, string] => ["ranges", wholeTab(t)]),
    ["valueRenderOption", "UNFORMATTED_VALUE"],
    ["dateTimeRenderOption", "SERIAL_NUMBER"],
  ]);
  const ranges = (data.valueRanges ?? []) as Array<{ values?: Cell[][] }>;
  return titles.map((_, i) => {
    const rows = ranges[i]?.values ?? [];
    if (!rows.length) return [[""]];
    const width = Math.max(1, ...rows.map((r) => r.length));
    return rows.map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ""));
  });
}

/**
 * The script's tab lookup: case-insensitive, whitespace-collapsed, exact.
 */
const sameTab = (title: string, league: string, season: number) =>
  title.trim().toLowerCase().replace(/\s+/g, " ") ===
  `${league.trim()} weekly ${season}`.toLowerCase().replace(/\s+/g, " ");

// --- Normalisation, as the script does it ---

const isEmpty = (v: unknown) => v === "" || v == null;

function getNumber(val: unknown): number | null {
  if (isEmpty(val)) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function getString(val: unknown): string | null {
  if (isEmpty(val)) return null;
  return String(val).trim();
}

function getSlug(val: unknown): string | null {
  if (isEmpty(val)) return null;
  return String(val).toLowerCase().trim();
}

function getBoolean(val: unknown): boolean {
  if (isEmpty(val)) return false;
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

/** Sheets counts days from 1899-12-30; the Unix epoch is day 25569. */
const serialToMs = (serial: number) => Math.round((serial - 25569) * 86_400_000);

/**
 * A date cell as `yyyy-MM-dd`.
 *
 * A NUMBER HERE IS A DATE-TYPED CELL. The serial counts WALL-CLOCK days in the
 * sheet's own time zone, so reading its UTC calendar date gives the same day the
 * script got from `formatDate(date, sheetZone)`, with no zone arithmetic. Only
 * date columns come through here, so nothing mistakes a plain number for one.
 *
 * Years past 2999 survive, which matters: a PLANNED date is stored a thousand
 * years out (see `buildLedger`), and 3026-11-11 has to come back as exactly that.
 */
function processDate(val: unknown): string | null {
  if (isEmpty(val)) return null;
  if (typeof val === "number") {
    return new Date(serialToMs(val)).toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Hand-typed text the sheet did not recognise as a date. The browser parses a
  // zoneless string as LOCAL time, so the local calendar date is the one typed.
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return str;
}

/** Comma-separated ids, as the ballot tables store them. */
const idList = (raw: unknown): number[] => {
  const s = String(raw ?? "").trim();
  return s ? s.split(",").map((x) => Number(x.trim())) : [];
};

/** Row 2's header names from a table's first column to the blank spacer. */
function getHeaders(row2: Cell[], startCol: number): Headers {
  if (startCol === -1) return {};
  const headers: Headers = {};
  for (let c = startCol; c < row2.length; c++) {
    const val = String(row2[c]).trim().toLowerCase();
    if (!val) break;
    headers[val] = c;
  }
  return headers;
}

function isRowBlank(row: Cell[], headers: Headers): boolean {
  for (const key in headers) {
    if (!isEmpty(row[headers[key]])) return false;
  }
  return true;
}

/** Column of each table title in row 1, or -1. The LAST match wins, as in the script. */
function findTables(row1: Cell[]) {
  const at = { suggestions: -1, selected: -1, assignments: -1, ballots: -1, seasonBallot: -1 };
  for (let c = 0; c < row1.length; c++) {
    const v = String(row1[c]).trim().toLowerCase();
    if (v === "suggestions") at.suggestions = c;
    else if (v === "selected") at.selected = c;
    else if (v === "assignments and completion") at.assignments = c;
    else if (v === "ballots") at.ballots = c;
    else if (v === "season ballot") at.seasonBallot = c;
  }
  return at;
}

/** The script's `parseSeasonTab`, unchanged in behaviour. */
function parseSeasonTab(data: Grid, season: number) {
  if (data.length < 2) {
    return { season, phase: null, poolSize: 0, suggestions: [], assignments: [] };
  }
  const [row1, row2] = data;

  // The phase lives in R1.
  let phase: string | null = null;
  if (row1.length > 17 && !isEmpty(row1[17])) phase = String(row1[17]).trim();

  const at = findTables(row1);
  const t1 = getHeaders(row2, at.suggestions);
  const t2 = getHeaders(row2, at.selected);
  const t3 = getHeaders(row2, at.assignments);
  const sb = getHeaders(row2, at.seasonBallot);

  // Selected first: a suggestion's `selected` flag is membership in it.
  const selectedIds = new Set<number>();
  let poolSize: number | null = null;
  if (at.selected !== -1 && row1.length > at.selected + 1) {
    const raw = row1[at.selected + 1];
    if (!isEmpty(raw) && !isNaN(Number(raw))) poolSize = parseInt(String(raw), 10);
  }
  if (at.selected !== -1 && t2.id !== undefined) {
    for (let r = 2; r < data.length; r++) {
      if (isRowBlank(data[r], t2)) break;
      const id = getNumber(data[r][t2.id]);
      if (id !== null) selectedIds.add(id);
    }
  }
  if (poolSize === null) poolSize = selectedIds.size;

  const suggestions = [];
  if (at.suggestions !== -1) {
    for (let r = 2; r < data.length; r++) {
      const row = data[r];
      if (isRowBlank(row, t1)) break;
      const id = getNumber(row[t1.id]);
      if (id === null) continue;
      suggestions.push({
        id,
        text: getString(row[t1.punishment]),
        suggestedBy: getSlug(row[t1["suggested by"]]),
        votes: getNumber(row[t1.votes]),
        vetoed: getBoolean(row[t1.vetoed]),
        selected: selectedIds.has(id),
      });
    }
  }

  const assignments = [];
  if (at.assignments !== -1) {
    for (let r = 2; r < data.length; r++) {
      const row = data[r];
      if (isRowBlank(row, t3)) break;
      const week = getNumber(row[t3.week]);
      if (week === null) continue;
      assignments.push({
        week,
        loser: getSlug(row[t3.loser]),
        punishmentId: getNumber(row[t3.id]),
        completed: processDate(row[t3.completed]),
      });
    }
  }

  const voters: string[] = [];
  if (at.seasonBallot !== -1 && sb.voter !== undefined) {
    for (let r = 2; r < data.length; r++) {
      if (isRowBlank(data[r], sb)) break;
      const v = getSlug(data[r][sb.voter]);
      if (v) voters.push(v);
    }
  }

  // The season vote's result sits in fixed cells: Z1 winner, Z2 date, Z3 finalists.
  let winnerId: number | null = null;
  let completed: string | null = null;
  let finalists: number[] = [];
  if (row1.length > 25 && !isEmpty(row1[25])) winnerId = getNumber(row1[25]);
  if (row2.length > 25 && !isEmpty(row2[25])) completed = processDate(row2[25]);
  if (data.length > 2 && data[2].length > 25 && !isEmpty(data[2][25])) {
    finalists = idList(data[2][25]);
  }

  return {
    season,
    phase,
    poolSize,
    suggestions,
    assignments,
    seasonVote: { winnerId, finalists, completed, voters },
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `getWeeklyPunishments` for every season, as the script answers it. */
export async function fetchSheetFeed(source: SheetSource): Promise<unknown> {
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(source.league)}\\s+weekly\\s+(\\d{4})\\s*$`,
    "i",
  );
  const matched = (await listTabs(source))
    .flatMap((title) => {
      const m = title.match(pattern);
      return m ? [{ title, season: parseInt(m[1], 10) }] : [];
    })
    .sort((a, b) => b.season - a.season);
  const grids = await readTabs(source, matched.map((m) => m.title));
  return {
    ok: true,
    func: "getWeeklyPunishments",
    league: source.league,
    updatedAt: new Date().toISOString(),
    seasons: matched.map((m, i) => parseSeasonTab(grids[i], m.season)),
  };
}

/** `getBallots`: turnout for everyone, picks for the one voter asked about. */
export async function fetchSheetBallots(
  source: SheetSource,
  season: number,
  voter: string | null,
): Promise<unknown> {
  const { league } = source;
  const fail = (error: string) => ({ ok: false, error });
  const target = voter ? voter.trim().toLowerCase() : null;

  const title = (await listTabs(source)).find((t) => sameTab(t, league, season));
  if (title === undefined) return fail(`Tab for league "${league}" season ${season} not found.`);

  const [data] = await readTabs(source, [title]);
  if (data.length < 2) return fail("Target sheet is empty or improperly formatted.");
  const [row1, row2] = data;

  const at = findTables(row1);
  if (at.ballots === -1) return fail("Could not locate 'Ballots' table on the sheet.");
  const b = getHeaders(row2, at.ballots);
  const sb = getHeaders(row2, at.seasonBallot);

  const voters: string[] = [];
  let ballot: { voter: string; punishmentIds: number[]; updatedAt: unknown } | null = null;
  for (let r = 2; r < data.length; r++) {
    const row = data[r];
    const v = String(row[b.voter] || "").trim().toLowerCase();
    if (!v) {
      if (isRowBlank(row, b)) break;
      continue;
    }
    voters.push(v);
    if (target && v === target) {
      const updated = row[b.updated];
      ballot = {
        voter: v,
        punishmentIds: idList(row[b["punishment ids"]]),
        // The script stores an ISO string. Were the sheet ever to turn one into
        // a date cell it would arrive as a serial; read as UTC, which can be off
        // by the sheet's offset, but `hasVoted` only asks whether it is set.
        updatedAt:
          typeof updated === "number"
            ? new Date(serialToMs(updated)).toISOString()
            : updated || null,
      };
    }
  }
  // Asked about somebody who has not voted: an empty ballot, not an error.
  if (target && !ballot) ballot = { voter: target, punishmentIds: [], updatedAt: null };

  let seasonPick: number[] | null = null;
  if (target && at.seasonBallot !== -1) {
    for (let r = 2; r < data.length; r++) {
      const row = data[r];
      const v = String(row[sb.voter] || "").trim().toLowerCase();
      if (!v) {
        if (isRowBlank(row, sb)) break;
        continue;
      }
      if (v === target) {
        seasonPick = idList(row[sb["punishment ids"]]);
        break;
      }
    }
  }

  return { ok: true, func: "getBallots", league, season, voters, ballot, seasonPick };
}
