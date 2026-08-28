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

/**
 * A PLANNED DATE IS A COMPLETED DATE A THOUSAND YEARS OUT.
 *
 * The sheet has one date cell per week, and the league wanted "we intend to do
 * this on the 11th" recorded separately from "it happened on the 11th" without
 * adding a column or changing the API. So a plan is stored with 1000 added to
 * its year — 2026-11-11 planned is written 3026-11-11 — and confirming it
 * subtracts the thousand back off.
 *
 * THE COST IS REAL. Anyone reading the spreadsheet sees dates in the 3020s, and
 * `getWeeklyPunishments` serves that raw value to any future consumer, which
 * will read it as a date unless it knows this rule. So it is encoded and
 * decoded ONLY here: the feed keeps whatever the sheet holds, `buildLedger`
 * splits it, and nothing else ever looks.
 *
 * Detected by the year rather than a marker, and 3000 is the threshold because
 * a fantasy season is a 20xx number and never will not be.
 */
const PLANNED_OFFSET = 1000;
const PLANNED_FROM_YEAR = 3000;
const ISO_DATE = /^(\d{4})(-\d{2}-\d{2})/;

const shiftYear = (iso: string, by: number): string => {
  const m = ISO_DATE.exec(iso);
  return m ? `${Number(m[1]) + by}${m[2]}` : iso;
};

/** True when this cell holds an intention rather than a record. */
export const isPlanned = (iso: string | null): boolean => {
  const m = iso ? ISO_DATE.exec(iso) : null;
  return m ? Number(m[1]) >= PLANNED_FROM_YEAR : false;
};

/** The real date behind a planned one. */
export const fromPlanned = (iso: string): string =>
  shiftYear(iso, -PLANNED_OFFSET);

/** How a planned date is written to the sheet. */
export const toPlanned = (iso: string): string =>
  shiftYear(iso, PLANNED_OFFSET);

export interface PunishmentAssignment {
  week: number;
  /**
   * Owner slugs. PLURAL because two teams can tie for the weekly low, and
   * `buildWeeklyLows` emits a row for each of them — a shared low is shared.
   */
  losers: string[];
  punishmentId: number | null;
  /**
   * Whatever the sheet's date cell holds, UNDECODED — a real completion, or a
   * plan carrying its thousand-year offset. `buildLedger` separates the two.
   */
  completed: string | null;
}

/**
 * Where a season is in the punishment cycle.
 *
 * STORED IN THE SHEET, NOT DERIVED — the one place this deliberately parts
 * company with `resolvePhase()` in lib/phase, which reads the league's phase off
 * Sleeper and stores nothing.
 *
 * That works there because Sleeper publishes facts that IMPLY the phase: a draft
 * date exists, points are on the board. Here one of the two transitions has no
 * such fact. The moment voting opens, every count is still zero and nothing
 * distinguishes it from suggestions still being open — closing suggestions is a
 * decision somebody makes, not an event anything records. The sheet is already
 * the league's control surface, so a cell costs nothing.
 */
export type PunishmentPhase =
  | "suggesting"
  | "voting"
  | "last-place-voting"
  | "live";

/** In the order a season moves through them. */
export const PUNISHMENT_PHASES = [
  "suggesting",
  "voting",
  "last-place-voting",
  "live",
] as const;

/**
 * The vote for the season-long punishment, from the sheet.
 *
 * NO COUNTS WHILE IT IS OPEN — the league chose turnout only, so this carries
 * who has voted and never what for. The counts arrive once, in the response to
 * `decideSeasonVote`, which is the first moment they can be shown without
 * steering the vote they describe.
 */
export interface SeasonVote {
  /** The winning suggestion, once someone has closed the vote. */
  winnerId: number | null;
  /** ISO date the punishment was served. */
  completed: string | null;
  /** Slugs only. */
  voters: string[];
}

export interface PunishmentSeason {
  season: number;
  phase: PunishmentPhase;
  /**
   * How many punishments the league will select. NULL when nobody has said.
   *
   * Null rather than a guess, because the only thing available to guess from is
   * the size of the Selected table, and that fills itself from the top of the
   * ballot — so before voting closes it reports however many suggestions exist,
   * which is a count of ideas rather than a target. 2026 opened with one
   * suggestion and duly claimed a pool size of one. A tile reading "—" is
   * honest; a tile reading "1" is wrong and looks deliberate.
   */
  poolSize: number | null;
  suggestions: PunishmentSuggestion[];
  assignments: PunishmentAssignment[];
  /** Absent on a sheet that predates the feature; treated as "no vote yet". */
  seasonVote: SeasonVote;
}

export interface PunishmentFeed {
  league: string;
  updatedAt: string | null;
  seasons: PunishmentSeason[];
}

/**
 * One person's approval ballot.
 *
 * BALLOTS ARE SECRET, so the feed never carries anyone else's. `getBallots`
 * returns the list of who has voted — turnout, which reveals no choices — plus
 * the picks of the one voter asked for.
 *
 * `updatedAt` IS WHAT SEPARATES "voted for nothing" FROM "has not voted", since
 * an empty ballot is a legal thing to cast and both have no ids. Only a real
 * save stamps a time.
 */
export interface Ballot {
  voter: string;
  punishmentIds: number[];
  updatedAt: string | null;
}

export interface BallotState {
  /** Everyone who has cast a ballot. Slugs only — no picks. */
  voters: string[];
  /** The viewer's own ballot, or null if they are not identified. */
  mine: Ballot | null;
  /**
   * The viewer's own last-place picks.
   *
   * NULL AND [] ARE DIFFERENT, and the difference is the whole point: an empty
   * array is a ballot cast for nothing, null is no ballot at all. Verified
   * against the live endpoint, which returns `[]` after an empty save and
   * `null` before any save.
   */
  seasonPick: number[] | null;
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

/**
 * One person on a team, in both the forms a row might have space for.
 *
 * BOTH, RATHER THAN ONE CHOSEN UP FRONT, because the choice is a matter of
 * width and only the component knows how much it has. The ledger shows first
 * names on a phone and full names once there is room.
 */
export interface TeamLabel {
  slug: string;
  /** Full name when playing alone, first name when the team is shared. */
  label: string;
  /** Always just the first name. */
  first: string;
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
 * The primary owner of whatever team this person was on that season.
 *
 * The map is keyed by PRIMARY owner, because that is how a team-season is keyed
 * everywhere — but a slug can arrive naming the co-owner instead, from a
 * hand-typed URL or a hand-edited sheet cell. Looked up rather than assumed, and
 * returns the slug unchanged when it names nobody on a team.
 */
export function primaryOwner(
  teams: TeamMap,
  season: number,
  slug: string,
): string {
  if (teams[`${season}:${slug}`]) return slug;
  const prefix = `${season}:`;
  for (const [key, people] of Object.entries(teams)) {
    if (key.startsWith(prefix) && people.some((p) => p.slug === slug)) {
      return key.slice(prefix.length);
    }
  }
  return slug;
}

/**
 * Who to name for a team, falling back to the person themselves.
 *
 * NAMING A CO-OWNER NAMES THE WHOLE TEAM. `thomas-moore` is not a key in the
 * map — Robbie is the primary — so a slug arriving that way used to render one
 * person for a team of two, on a screen whose entire job is saying who owes
 * something. Resolved to the primary first, so it does not matter which half of
 * a shared team a URL or a sheet cell happens to name.
 *
 * The final fallback still matters: a loser slug can come from the SHEET for a
 * week that has not been archived, and will not be in any standings row yet.
 */
export function teamFor(
  teams: TeamMap,
  names: Record<string, string>,
  season: number,
  slug: string,
): TeamLabel[] {
  const key = primaryOwner(teams, season, slug);
  const known = teams[`${season}:${key}`];
  if (known) return known;
  // Not in any standings row — a loser slug straight off the sheet for a week
  // that has not been archived. Split rather than looked up, since there is
  // nothing to look it up in.
  const label = names[slug] ?? slug;
  return [{ slug, label, first: label.split(" ")[0] }];
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
 * One suggestion, from wherever it came.
 *
 * SHARED BY THE READ AND THE WRITE. `addSuggestion` echoes back the row it
 * created in the same shape the feed uses, so parsing it through this rather
 * than trusting it is what guarantees a just-added row renders identically to
 * one that arrived on the next refresh.
 *
 * Null for a row with no id or no text — that is an empty spreadsheet row, of
 * which every sheet has hundreds below the last real one.
 */
export function parseSuggestion(raw: unknown): PunishmentSuggestion | null {
  const r = obj(raw);
  const id = asNumber(r.id);
  const text = asText(r.text);
  if (id == null || !text) return null;
  return {
    id,
    text,
    suggestedBy: asText(r.suggestedBy)?.toLowerCase() ?? null,
    votes: asNumber(r.votes) ?? 0,
    vetoed: asBool(r.vetoed),
    selected: asBool(r.selected),
  };
}

export const hasVoted = (b: Ballot | null): boolean => Boolean(b?.updatedAt);

export function parseBallot(raw: unknown): Ballot | null {
  const r = obj(raw);
  const voter = asText(r.voter)?.toLowerCase();
  if (!voter) return null;
  const ids = asRows(r.punishmentIds)
    .map(asNumber)
    .filter((n): n is number => n != null);
  return {
    voter,
    punishmentIds: [...new Set(ids)].sort((a, b) => a - b),
    updatedAt: asText(r.updatedAt),
  };
}

export function parseBallotState(raw: unknown): BallotState {
  const top = obj(raw);
  const pick = top.seasonPick;
  return {
    voters: asRows(top.voters)
      .map((v) => asText(v)?.toLowerCase())
      .filter((v): v is string => Boolean(v)),
    mine: parseBallot(top.ballot),
    // Only an actual array counts. A missing key on an older sheet must read as
    // "has not voted", not as "voted for nothing".
    seasonPick: Array.isArray(pick)
      ? pick.map(asNumber).filter((n): n is number => n != null)
      : null,
  };
}

/** The sheet's own word for the phase, if it said anything recognisable. */
/**
 * The phase cell, read forgivingly.
 *
 * A HUMAN TYPES THIS. Spaces, hyphens and underscores are all stripped before
 * matching, so "last place voting", "Last-Place-Voting" and "last_place_voting"
 * are one value — the alternative is a misspelt cell silently falling through to
 * `derivePhase()`, which for a league with its pool set answers `live` and hides
 * the very ballot the cell was changed to open.
 */
const readPhase = (v: unknown): PunishmentPhase | null => {
  const s = asText(v)?.toLowerCase().replace(/[\s_-]+/g, "");
  const hit = PUNISHMENT_PHASES.find((p) => p.replace(/-/g, "") === s);
  return hit ?? null;
};

/**
 * The phase implied by the data, for when the sheet does not say.
 *
 * A FALLBACK, NOT THE RULE. It cannot see the suggesting -> voting transition,
 * which is exactly why the phase is stored — before the first vote is cast an
 * open ballot and a closed one look identical.
 *
 * `selected` ALONE DOES NOT MEAN LIVE. The Selected table fills itself from the
 * top of the ballot, so with one suggestion and no votes cast that one is
 * already "selected" — 2026 looked live on its first day, holding a single
 * unvoted idea. A pool is only really set once somebody voted it in or a week
 * has been lost, so this asks for one of those.
 */
export function derivePhase(season: {
  suggestions: PunishmentSuggestion[];
  assignments: PunishmentAssignment[];
}): PunishmentPhase {
  const voted = season.suggestions.some((s) => s.votes > 0);
  if (season.assignments.some((a) => a.losers.length || a.punishmentId != null))
    return "live";
  if (voted && season.suggestions.some((s) => s.selected)) return "live";
  return voted ? "voting" : "suggesting";
}

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
      const parsed = parseSuggestion(x);
      if (parsed) suggestions.push(parsed);
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

    const ordered = {
      suggestions: suggestions.sort((a, b) => a.id - b.id),
      assignments: assignments.sort((a, b) => a.week - b.week),
    };
    /**
     * A SEASON WITH A LEDGER IS LIVE, whatever the cell says.
     *
     * The sheet wins on the phase everywhere else — that is the whole reason it
     * is stored. But once a week has been lost and a punishment assigned, the
     * pool is manifestly set, and no cell can put the season back to collecting
     * suggestions. This is not hypothetical: the phase column arrived with 2025
     * reading "suggesting", which taken literally hides a finished season's
     * fourteen weeks behind a suggestion form.
     *
     * Only this direction is clamped. Nothing infers voting from suggesting, or
     * live from votes alone — those are judgement calls the sheet is entitled to
     * make. A served punishment is not a judgement call.
     */
    const played = ordered.assignments.some(
      (a) => a.losers.length || a.punishmentId != null,
    );
    const phase = played
      ? "live"
      : (readPhase(row.phase) ?? derivePhase(ordered));
    const sv = obj(row.seasonVote);
    seasons.push({
      season,
      phase,
      seasonVote: {
        winnerId: asNumber(sv.winnerId),
        completed: asText(sv.completed),
        voters: asRows(sv.voters)
          .map((v) => asText(v)?.toLowerCase())
          .filter((v): v is string => Boolean(v)),
      },
      // Counting the Selected table is only a fair reading of "pool size" once
      // the pool is actually set. Before that it counts suggestions.
      poolSize:
        asNumber(row.poolSize) ??
        (phase === "live"
          ? ordered.suggestions.filter((s) => s.selected).length || null
          : null),
      ...ordered,
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
  /** A real completion. Null while it is only planned, or still owed. */
  completed: string | null;
  /** When they intend to do it. Null once it is done, or if nothing is set. */
  planned: string | null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * One row per week that either source knows about.
 *
 * NOT one row per regular-season week: an unplayed season would render fourteen
 * blanks, and a season in progress would advertise weeks nobody has lost yet.
 */
export function buildLedger(
  season: PunishmentSeason | null,
  lows: DerivedLow[],
): LedgerRow[] {
  const byId = new Map((season?.suggestions ?? []).map((s) => [s.id, s]));
  const assignments = new Map(
    (season?.assignments ?? []).map((a) => [a.week, a]),
  );

  const derivedByWeek = new Map<number, DerivedLow[]>();
  for (const l of lows) {
    derivedByWeek.set(l.week, [...(derivedByWeek.get(l.week) ?? []), l]);
  }

  const weeks = [
    ...new Set([...derivedByWeek.keys(), ...assignments.keys()]),
  ].sort((a, b) => a - b);

  return weeks.map((week) => {
    const derived = derivedByWeek.get(week) ?? [];
    const a = assignments.get(week);
    const sheetLosers = a?.losers ?? [];
    const derivedLosers = derived.map((d) => d.ownerSlug);

    const useDerived = derivedLosers.length > 0;
    const losers = useDerived ? derivedLosers : sheetLosers;
    const disagrees =
      useDerived &&
      sheetLosers.length > 0 &&
      !sameSet(derivedLosers, sheetLosers);

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
      punishment:
        a?.punishmentId != null ? (byId.get(a.punishmentId) ?? null) : null,
      punishmentId: a?.punishmentId ?? null,
      // One cell, two meanings, split here and nowhere else.
      completed: isPlanned(a?.completed ?? null)
        ? null
        : (a?.completed ?? null),
      planned:
        a?.completed && isPlanned(a.completed)
          ? fromPlanned(a.completed)
          : null,
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
  return {
    weeks: rows.length,
    assigned,
    completed,
    outstanding: assigned - completed,
  };
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
export function poolRemaining(
  season: PunishmentSeason | null,
  rows: LedgerRow[],
) {
  if (!season) return [];
  const drawn = new Set(
    rows.map((r) => r.punishmentId).filter((id): id is number => id != null),
  );
  return season.suggestions.filter(
    (s) => s.selected && !s.vetoed && !drawn.has(s.id),
  );
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
      const t = out.get(slug) ?? {
        slug,
        lost: 0,
        completed: 0,
        outstanding: 0,
      };
      t.lost += 1;
      if (r.punishmentId != null) {
        if (r.completed) t.completed += 1;
        else t.outstanding += 1;
      }
      out.set(slug, t);
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      b.outstanding - a.outstanding ||
      b.lost - a.lost ||
      a.slug.localeCompare(b.slug),
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
