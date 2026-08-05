/**
 * Which record books a FINISHED matchup has entered.
 *
 * ACHIEVED, NEVER PROJECTED. An earlier version marked a live score that was "on
 * pace for #4", which is a guess dressed as a fact — and for the low lists it is
 * a guess that is almost always wrong, since a team sitting on 40 points at noon
 * on Sunday has most of its lineup still to play. A mark now means the game is
 * over and the number is in the book.
 *
 * Pure and dependency-free: the record arrays are build-time data, so the
 * thresholds ship with the page and the browser needs no history to check a score
 * against them.
 */

/** Cut-offs a score has to beat, in rank order. Capped at the record book depth. */
export interface RecordThresholds {
  /** Team single-week points, descending. */
  high: number[];
  /** Team single-week points, ascending. */
  low: number[];
  /** Margin of victory, descending. */
  blowout: number[];
  /** Margin of victory, ascending. */
  narrow: number[];
  /** Both teams added together, descending. */
  combinedHigh: number[];
  /** Both teams added together, ascending. */
  combinedLow: number[];
}

export interface RecordMark {
  rank: number;
  /** Fits in a card chip. */
  short: string;
  /** The `title`, spelling out what the rank means. */
  full: string;
  tone: "good" | "bad";
  /** Set when the record belongs to ONE team rather than the game. */
  side?: "a" | "b";
}

const ORDINALS = ["1st", "2nd", "3rd"];
const ordinal = (n: number): string =>
  n <= 3 ? ORDINALS[n - 1] : `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || (n % 100) - (n % 10) === 10 ? 0 : n % 10]}`;

/** Where a value places, or 0 for "nowhere". */
const place = (value: number, cuts: number[], beats: (a: number, b: number) => boolean): number => {
  const i = cuts.findIndex((c) => beats(value, c));
  return i < 0 ? 0 : i + 1;
};

const higher = (a: number, b: number) => a > b;
const lower = (a: number, b: number) => a < b;

/**
 * Every record list this game has entered, best rank first.
 *
 * Player-week records are deliberately absent: they need a lineup, which the
 * matchup page has and a card does not.
 */
export function matchupMarks(a: number, b: number, t: RecordThresholds): RecordMark[] {
  const out: RecordMark[] = [];

  for (const [points, side] of [
    [a, "a"],
    [b, "b"],
  ] as Array<[number, "a" | "b"]>) {
    const hi = place(points, t.high, higher);
    if (hi) {
      out.push({
        rank: hi,
        short: `#${hi} high`,
        full: `${ordinal(hi)}-highest single-week score in league history`,
        tone: "good",
        side,
      });
    }
    const lo = place(points, t.low, lower);
    if (lo) {
      out.push({
        rank: lo,
        short: `#${lo} low`,
        full: `${ordinal(lo)}-lowest single-week score in league history`,
        tone: "bad",
        side,
      });
    }
  }

  const margin = Math.abs(a - b);
  const blowout = place(margin, t.blowout, higher);
  if (blowout) {
    out.push({
      rank: blowout,
      short: `#${blowout} blowout`,
      full: `${ordinal(blowout)}-biggest margin of victory in league history`,
      tone: "good",
    });
  }
  // A TIE IS NOT A NARROW WIN. Zero would top this list forever, and nobody won.
  if (margin > 0) {
    const narrow = place(margin, t.narrow, lower);
    if (narrow) {
      out.push({
        rank: narrow,
        short: `#${narrow} closest`,
        full: `${ordinal(narrow)}-narrowest margin of victory in league history`,
        tone: "good",
      });
    }
  }

  const combined = a + b;
  const ch = place(combined, t.combinedHigh, higher);
  if (ch) {
    out.push({
      rank: ch,
      short: `#${ch} high game`,
      full: `${ordinal(ch)}-highest combined score of any matchup in league history`,
      tone: "good",
    });
  }
  const cl = place(combined, t.combinedLow, lower);
  if (cl) {
    out.push({
      rank: cl,
      short: `#${cl} low game`,
      full: `${ordinal(cl)}-lowest combined score of any matchup in league history`,
      tone: "bad",
    });
  }

  return out.sort((x, y) => x.rank - y.rank);
}
