/**
 * The weekly punishment tracker.
 *
 * The league that punishes its weekly low scorer keeps the punishments themselves
 * in a Google Sheet — suggestions, votes, vetoes, which one each week's loser drew
 * and whether they have served it. An Apps Script web app publishes that sheet as
 * JSON and the browser fetches it; see `punishmentsSource()` in lib/data.
 *
 * THE SHEET IS NOT THE SOURCE OF TRUTH FOR WHO LOST. `derived/weekly-lows.json`
 * already knows, from Sleeper, with the score attached — checked against the 2025
 * sheet, all 14 weeks agree including the co-owned team, which the sheet writes as
 * "Robbie & Thomas" and the site keys to its primary owner. So the ledger PREFERS
 * the derived answer and falls back to the sheet only for a week Sleeper has not
 * scored yet, which is the window where a punishment gets assigned. When the two
 * disagree the derived one wins and the row says so — a mismatch is a data-entry
 * slip in the sheet, and silently rendering it would make the site restate the
 * mistake with a straight face.
 *
 * DEPENDENCY-FREE AND CLIENT-SAFE: this ships to the browser, and every shape it
 * parses came off a spreadsheet, so nothing here trusts its input.
 */

export interface PunishmentSuggestion {
  /** Season-scoped. Stable once an assignment references it. */
  id: number;
  text: string;
  /** Owner slug, or null — 2025's suggestions were collected without attribution. */
  suggestedBy: string | null;
  votes: number;
  /** Struck from contention by the commissioner. */
  vetoed: boolean;
  /** Made the pool of `poolSize` that weeks are drawn from. */
  selected: boolean;
}

export interface PunishmentAssignment {
  week: number;
  /**
   * Owner slugs. PLURAL because two teams can tie for the weekly low, and
   * `buildWeeklyLows` emits a row for each of them — a shared low is shared.
   */
  losers: string[];
  punishmentId: number | null;
  /** ISO date, or null while it is still owed. */
  completed: string | null;
}

export interface PunishmentSeason {
  season: number;
  /** How many punishments the league selects — one per regular-season week. */
  poolSize: number;
  suggestions: PunishmentSuggestion[];
  assignments: PunishmentAssignment[];
}

export interface PunishmentFeed {
  league: string;
  updatedAt: string | null;
  seasons: PunishmentSeason[];
}

/** A weekly low as the site derives it, with the game it happened in. */
export interface DerivedLow {
  season: number;
  week: number;
  ownerSlug: string;
  points: number;
  /**
   * Resolved via `matchupPageId`, never constructed — a multi-week matchup has
   * one page, keyed by its first week.
   */
  matchupId: string | null;
}

/** Everything the client needs about a season it did not fetch. */
export interface SeasonLows {
  season: number;
  regularSeasonWeeks: number;
  lows: DerivedLow[];
}

/** One person on a team, already labelled for the width it will render at. */
export interface TeamLabel {
  slug: string;
  label: string;
}

/**
 * `${season}:${primaryOwnerSlug}` -> everyone credited with that team-season.
 *
 * A WEEKLY LOW IS A TEAM'S, AND A TEAM CAN HAVE TWO OWNERS. `weekly-lows.json`
 * keys a low to the PRIMARY owner, because a placement is a property of a team
 * and a team has one franchise key — so naming that one person credits half of a
 * co-owned team and quietly blames the wrong half. Keyed by season because
 * co-ownership changes: the same franchise can be shared one year and solo the
 * next.
 */
export type TeamMap = Record<string, TeamLabel[]>;

/**
 * Who to name for a team, falling back to the person themselves.
 *
 * The fallback matters: a loser slug can come from the SHEET for a week that has
 * not been archived, and it will not be in any standings row yet.
 */
export function teamFor(
  teams: TeamMap,
  names: Record<string, string>,
  season: number,
  slug: string,
): TeamLabel[] {
  return teams[`${season}:${slug}`] ?? [{ slug, label: names[slug] ?? slug }];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asText = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * A spreadsheet checkbox arrives as a boolean, but a hand-typed cell arrives as
 * "TRUE", "yes" or "1" — and an empty one as "".
 */
const asBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = asText(v)?.toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "x";
};

/**
 * Owner slugs out of one cell.
 *
 * Accepts an array or a delimited string, because a tied week has two losers and
 * there is no telling which shape a spreadsheet will hand over. Splits on the
 * separators a person would reach for — comma, slash, ampersand — but NOT on the
 * hyphen inside a slug.
 */
const asSlugs = (v: unknown): string[] => {
  const parts = Array.isArray(v) ? v : [v];
  return parts
    .flatMap((p) => (asText(p) ?? "").split(/[,/&]|\s+and\s+/i))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
};

const asRows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/**
 * Turns whatever the endpoint returned into a feed, discarding anything
 * unusable rather than throwing.
 *
 * A row with no id or no text is dropped: it is an empty spreadsheet row, of
 * which every sheet has hundreds below the last real one.
 */
export function parseFeed(raw: unknown): PunishmentFeed {
  const top = obj(raw);
  const seasons: PunishmentSeason[] = [];

  for (const s of asRows(top.seasons)) {
    const row = obj(s);
    const season = asNumber(row.season);
    if (season == null) continue;

    const suggestions: PunishmentSuggestion[] = [];
    for (const x of asRows(row.suggestions)) {
      const r = obj(x);
      const id = asNumber(r.id);
      const text = asText(r.text);
      if (id == null || !text) continue;
      suggestions.push({
        id,
        text,
        suggestedBy: asText(r.suggestedBy)?.toLowerCase() ?? null,
        votes: asNumber(r.votes) ?? 0,
        vetoed: asBool(r.vetoed),
        selected: asBool(r.selected),
      });
    }

    const assignments: PunishmentAssignment[] = [];
    for (const x of asRows(row.assignments)) {
      const r = obj(x);
      const week = asNumber(r.week);
      if (week == null) continue;
      const losers = asSlugs(r.loser ?? r.losers);
      const punishmentId = asNumber(r.punishmentId);
      const completed = asText(r.completed);
      // A WEEK NUMBER ALONE IS NOT DATA. The sheet pre-numbers a row per week of
      // the year, so a finished season still ships blank rows for the playoff
      // weeks the punishment does not cover — 2025 returns three. Rendering them
      // would put "Not drawn yet" against weeks nobody can lose.
      if (!losers.length && punishmentId == null && !completed) continue;
      assignments.push({ week, losers, punishmentId, completed });
    }

    seasons.push({
      season,
      poolSize: asNumber(row.poolSize) ?? suggestions.filter((s) => s.selected).length,
      suggestions: suggestions.sort((a, b) => a.id - b.id),
      assignments: assignments.sort((a, b) => a.week - b.week),
    });
  }

  return {
    league: asText(top.league) ?? "",
    updatedAt: asText(top.updatedAt),
    seasons: seasons.sort((a, b) => b.season - a.season),
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export interface LedgerRow {
  season: number;
  week: number;
  /** Who owes it. Sleeper's answer where there is one, else the sheet's. */
  losers: string[];
  source: "derived" | "sheet" | "none";
  /** Set when both sources named someone and they are not the same people. */
  disagrees: boolean;
  /** Only populated on a disagreement, so the row can explain itself. */
  sheetLosers: string[];
  /** The low score itself. Null for a week Sleeper has not scored yet. */
  points: number | null;
  matchupId: string | null;
  punishment: PunishmentSuggestion | null;
  /** Kept even when the punishment is unknown, so a bad id is visible. */
  punishmentId: number | null;
  completed: string | null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * One row per week that either source knows about.
 *
 * NOT one row per regular-season week: an unplayed season would render fourteen
 * blanks, and a season in progress would advertise weeks nobody has lost yet.
 */
export function buildLedger(season: PunishmentSeason | null, lows: DerivedLow[]): LedgerRow[] {
  const byId = new Map((season?.suggestions ?? []).map((s) => [s.id, s]));
  const assignments = new Map((season?.assignments ?? []).map((a) => [a.week, a]));

  const derivedByWeek = new Map<number, DerivedLow[]>();
  for (const l of lows) {
    derivedByWeek.set(l.week, [...(derivedByWeek.get(l.week) ?? []), l]);
  }

  const weeks = [...new Set([...derivedByWeek.keys(), ...assignments.keys()])].sort(
    (a, b) => a - b,
  );

  return weeks.map((week) => {
    const derived = derivedByWeek.get(week) ?? [];
    const a = assignments.get(week);
    const sheetLosers = a?.losers ?? [];
    const derivedLosers = derived.map((d) => d.ownerSlug);

    const useDerived = derivedLosers.length > 0;
    const losers = useDerived ? derivedLosers : sheetLosers;
    const disagrees = useDerived && sheetLosers.length > 0 && !sameSet(derivedLosers, sheetLosers);

    return {
      // Carried on the row so a renderer can resolve co-owners without also
      // being told which season it is looking at.
      season: season?.season ?? lows[0]?.season ?? 0,
      week,
      losers,
      source: losers.length ? (useDerived ? "derived" : "sheet") : "none",
      disagrees,
      sheetLosers: disagrees ? sheetLosers : [],
      // A tie has two teams on the same score, so either one states it.
      points: derived.length ? derived[0].points : null,
      matchupId: derived.length === 1 ? derived[0].matchupId : null,
      punishment: a?.punishmentId != null ? (byId.get(a.punishmentId) ?? null) : null,
      punishmentId: a?.punishmentId ?? null,
      completed: a?.completed ?? null,
    };
  });
}

export interface LedgerTotals {
  weeks: number;
  assigned: number;
  completed: number;
  outstanding: number;
}

export const ledgerTotals = (rows: LedgerRow[]): LedgerTotals => {
  const assigned = rows.filter((r) => r.punishmentId != null).length;
  const completed = rows.filter((r) => r.completed).length;
  return { weeks: rows.length, assigned, completed, outstanding: assigned - completed };
};

/**
 * The selected punishments nobody has drawn yet.
 *
 * Keyed off the ASSIGNMENT's id rather than the resolved punishment, so an id
 * that matches no suggestion still removes nothing from the pool — a dangling
 * reference should not quietly put a punishment back in play.
 *
 * Vetoed is excluded belt-and-braces: a veto strikes a suggestion from
 * contention, so it should never also be selected, and if the sheet ever says
 * both then it is not something anyone can draw.
 */
export function poolRemaining(season: PunishmentSeason | null, rows: LedgerRow[]) {
  if (!season) return [];
  const drawn = new Set(rows.map((r) => r.punishmentId).filter((id): id is number => id != null));
  return season.suggestions.filter((s) => s.selected && !s.vetoed && !drawn.has(s.id));
}

export interface OwnerTally {
  slug: string;
  lost: number;
  completed: number;
  outstanding: number;
}

/** Per owner, across the ledger. A tied week credits each of its losers. */
export function tallyByOwner(rows: LedgerRow[]): OwnerTally[] {
  const out = new Map<string, OwnerTally>();
  for (const r of rows) {
    for (const slug of r.losers) {
      const t = out.get(slug) ?? { slug, lost: 0, completed: 0, outstanding: 0 };
      t.lost += 1;
      if (r.punishmentId != null) {
        if (r.completed) t.completed += 1;
        else t.outstanding += 1;
      }
      out.set(slug, t);
    }
  }
  return [...out.values()].sort(
    (a, b) => b.outstanding - a.outstanding || b.lost - a.lost || a.slug.localeCompare(b.slug),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2025-09-12" -> "Sep 12".
 *
 * Parsed by hand rather than through `Date`, which would read a bare ISO date as
 * UTC midnight and render the day before for anyone west of Greenwich — which is
 * everyone in this league. Anything that is not an ISO date is passed through
 * untouched, because a sheet still holding "9/12" should show what it holds.
 */
export function formatCompleted(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : value;
}
