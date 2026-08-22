/**
 * The last-place punishment — one per season, for whoever finished bottom.
 *
 * A MEMORIES LOG, NOT A PROCESS. Unlike the weekly punishment, which the league
 * suggests, votes on and draws for, this is simply recorded: what the punishment
 * was, who ended up owing it, when they did it, and photos of them doing it.
 * There is no ballot, no wheel and no deadline tracking here.
 *
 * IT LIVES IN CONFIG, NOT IN THE SHEET. That is the one place this parts company
 * with everything else on the punishment surfaces. The weekly tracker earns its
 * Apps Script round trip because the league WRITES to it constantly and somebody
 * who just voted has to see their vote; this changes twice a year — someone sets
 * the text, someone logs a date. Committing it means no loading state, no
 * third-party outage, no skeleton on three leagues' history pages, and a record
 * that lands in git history beside every other slow-moving league fact.
 *
 * WHO LOST IS NEVER CONFIGURED. `SeasonSummary.lastPlace` already carries it,
 * derived from the toilet bowl (Sleeper's inverted losers bracket) or the
 * consolation ladder (ESPN), and verified across every season the site holds.
 * Writing the name down again would be a second source to disagree with the
 * first.
 */

/** One season's entry in `config/leagues/<slug>/season-punishments.json`. */
export interface SeasonPunishmentEntry {
  /** The punishment itself. An entry without one is treated as no entry. */
  punishment: string;
  /**
   * ISO `YYYY-MM-DD`, or `true` for done on a date nobody wrote down.
   *
   * BOTH ARE DONE. A memories log of punishments served years ago routinely
   * knows that something happened and not when, and the alternative to saying
   * so is inventing a date — which would then be rendered, and believed. Absent
   * or null means it has not been done.
   */
  completed?: string | boolean | null;
  /** Anything worth remembering that the sentence above does not say. */
  notes?: string;
}

/**
 * FOUR STATES, and `none` is the absence of the whole thing.
 *
 * They are not a sequence a season walks through in order — a punishment can be
 * decided before anyone knows who will owe it, or written down years later
 * alongside the photos. Every surface handles all of them rather than assuming
 * where in the year it is.
 *
 * | State | Means |
 * | --- | --- |
 * | `none` | no entry — that season had no last-place punishment. Renders NOTHING |
 * | `pending` | decided, but the season has no last place yet |
 * | `owed` | decided, somebody owes it, not done |
 * | `done` | there is a completion date |
 */
export type SeasonPunishmentState = "pending" | "owed" | "done";

export interface SeasonPunishment {
  season: number;
  state: SeasonPunishmentState;
  punishment: string;
  completed: string | null;
  notes: string | null;
  /**
   * Primary owner slug of the team that finished last, or null while the season
   * is unfinished. Null is the `pending` state and is expected, not a gap.
   */
  loser: string | null;
}

/**
 * Joins a config entry to what the season itself knows.
 *
 * `done` WINS OVER EVERYTHING. A date says it happened, so a season whose last
 * place somehow never resolved still reads as done rather than falling back to
 * `pending` and claiming it is waiting on a result nobody needs.
 */
export function resolveSeasonPunishment(
  season: number,
  entry: SeasonPunishmentEntry | undefined,
  lastPlace: string | null,
): SeasonPunishment | null {
  const text = entry?.punishment?.trim();
  if (!text) return null;

  /**
   * `completed` ANSWERS TWO QUESTIONS AT ONCE — whether it happened, and when.
   * They come apart: `true` is the first without the second. So the state is
   * decided by the flag and the date is carried separately, and a surface that
   * wants to print a date has to cope with not having one.
   */
  const raw = entry?.completed;
  const completed = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const isDone = raw === true || completed != null;

  return {
    season,
    state: isDone ? "done" : lastPlace ? "owed" : "pending",
    punishment: text,
    completed,
    notes: entry?.notes?.trim() || null,
    loser: lastPlace,
  };
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
 * THE YEAR IS PART OF THE DATE HERE, unlike the weekly ledger's `formatCompleted`.
 *
 * A weekly punishment is served inside the season it was earned, so the year is
 * implied by the table it sits in. This one is routinely served in the NEXT
 * calendar year — the 2025 punishment done in spring 2026 — so "Apr 12" against
 * a panel headed 2025 would name the wrong year.
 */
export function formatPunishmentDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : value;
}
