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

/**
 * How deep a list has to be entered before a card says so.
 *
 * FAR SHALLOWER THAN THE RECORD BOOK, which goes twenty deep. A chip is a claim
 * that something notable happened, and "#18 highest week" is not notable — at
 * twenty deep roughly one game in seven earns one, which turns the chip into
 * decoration. Top five is a real result.
 */
export const MARK_DEPTH = 5;

/** The record-book lists a mark can belong to. */
export type RecordList =
  | "high"
  | "low"
  | "combinedHigh"
  | "combinedLow"
  | "blowout"
  | "narrow"
  | "playerWeek";

/**
 * Anchor per list, shared by the record book and by anything linking into it.
 *
 * ONE DEFINITION, because the two ends cannot be checked against each other by
 * the compiler: a chip's href is a string and a panel's id is a string, and a
 * typo in either produces a link that silently lands at the top of the page.
 */
export const RECORD_ANCHOR: Record<RecordList, string> = {
  high: "highest-scores",
  low: "lowest-scores",
  combinedHigh: "highest-scoring-matchups",
  combinedLow: "lowest-scoring-matchups",
  blowout: "biggest-blowouts",
  narrow: "narrowest-wins",
  playerWeek: "best-player-weeks",
};

/** Deep link to the list a mark belongs to. */
export const recordHref = (list: RecordList): string =>
  `/records/#${RECORD_ANCHOR[list]}`;

/** Cut-offs a score has to beat, in rank order. Only the top `MARK_DEPTH`. */
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
  /** Which record-book list this is, so a chip can link to it. */
  list: RecordList;
  /**
   * The MATCHUP PAGE's wording, matching `getRecordFlags` exactly.
   *
   * `short` is written for a card the width of a thumb, where "#7 lowest
   * scoring matchup" does not fit. A page has room, and its archived
   * counterpart already says the long form — so the same game must not read
   * "#7 low combined" today and "#7 lowest scoring matchup" once it is
   * archived.
   */
  long: string;
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

/**
 * A finished matchup that is NOT in the record book yet.
 *
 * Every score from the same week that is already final, plus the opponent in
 * this very matchup. Without them each game is ranked against history alone
 * and cannot see its own week, which is how two cards both claimed "#2 high"
 * with different scores.
 */
export interface PeerMatchup {
  a: number;
  b: number;
}

/**
 * Peers split by WHICH SIDE OF A TIE THEY FALL ON.
 *
 * Ranks on the record book are positional — the page numbers its rows `i + 1`
 * — so two equal scores take two consecutive places rather than sharing one.
 * A chip links into that list, so it has to number things the same way, which
 * means an exact tie needs an order. `ahead` wins ties, `behind` loses them,
 * and callers fill them from the week's own matchup order so the answer is
 * stable from render to render rather than depending on object identity.
 */
export interface Peers {
  ahead: PeerMatchup[];
  behind: PeerMatchup[];
}

const NO_PEERS: Peers = { ahead: [], behind: [] };

/** A live matchup as a peer — the two scores are all the ranking needs. */
export const peerScore = (m: { a: { points: number }; b: { points: number } }): PeerMatchup => ({
  a: m.a.points,
  b: m.b.points,
});

/**
 * Where a value places, or 0 for "nowhere".
 *
 * Counts what finishes above rather than scanning for the first cut it beats.
 * The two agree on the archive alone — a tied cut is "above", exactly as
 * `findIndex` with a strict `beats` used to treat it — but only counting
 * generalises to peers, which arrive unsorted and on both sides of a tie.
 */
const place = (
  value: number,
  cuts: number[],
  beats: (a: number, b: number) => boolean,
  ahead: number[] = [],
  behind: number[] = [],
): number => {
  let rank = 1;
  // A TIE COUNTS AS AHEAD for the archive and for `ahead` peers: an equal score
  // already in the book keeps the better number, and the newcomer takes the
  // next one down.
  for (const v of cuts) if (beats(v, value) || v === value) rank++;
  for (const v of ahead) if (beats(v, value) || v === value) rank++;
  for (const v of behind) if (beats(v, value)) rank++;
  // The cut lists are already truncated to MARK_DEPTH, so anything past it is
  // out of the book whether or not the peers pushed it there.
  return rank <= MARK_DEPTH ? rank : 0;
};

const higher = (a: number, b: number) => a > b;
const lower = (a: number, b: number) => a < b;

/**
 * Every record list this game has entered, best rank first.
 *
 * Player-week records are deliberately absent: they need a lineup, which the
 * matchup page has and a card does not.
 */
export function matchupMarks(
  a: number,
  b: number,
  t: RecordThresholds,
  peers: Peers = NO_PEERS,
): RecordMark[] {
  const out: RecordMark[] = [];

  const singles = (ms: PeerMatchup[]) => ms.flatMap((m) => [m.a, m.b]);
  const margins = (ms: PeerMatchup[]) => ms.map((m) => Math.abs(m.a - m.b));
  const combinedOf = (ms: PeerMatchup[]) => ms.map((m) => m.a + m.b);
  // A TIE IS NOT A NARROW WIN, for a peer either — the same rule applied below
  // to this game's own margin.
  const wins = (ms: PeerMatchup[]) => margins(ms).filter((m) => m > 0);

  for (const [points, side] of [
    [a, "a"],
    [b, "b"],
  ] as Array<[number, "a" | "b"]>) {
    /**
     * THE OPPONENT IS A PEER TOO. Both halves of one matchup can make the same
     * list — two big scores against each other is exactly when that happens —
     * and ranked only against history they would both claim the same number.
     * Side `a` takes ties, matching the order the card renders them in.
     */
    const aheadSingles = [...singles(peers.ahead), ...(side === "a" ? [] : [a])];
    const behindSingles = [...singles(peers.behind), ...(side === "a" ? [b] : [])];
    const hi = place(points, t.high, higher, aheadSingles, behindSingles);
    if (hi) {
      out.push({
        rank: hi,
      list: "high",
        short: `#${hi} high`,
        long: `#${hi} highest score`,
        full: `${ordinal(hi)}-highest single-week score in league history`,
        tone: "good",
        side,
      });
    }
    const lo = place(points, t.low, lower, aheadSingles, behindSingles);
    if (lo) {
      out.push({
        rank: lo,
      list: "low",
        short: `#${lo} low`,
        long: `#${lo} lowest score`,
        full: `${ordinal(lo)}-lowest single-week score in league history`,
        tone: "bad",
        side,
      });
    }
  }

  const margin = Math.abs(a - b);
  const blowout = place(margin, t.blowout, higher, margins(peers.ahead), margins(peers.behind));
  if (blowout) {
    out.push({
      rank: blowout,
      list: "blowout",
      short: `#${blowout} blowout`,
      long: `#${blowout} blowout`,
      full: `${ordinal(blowout)}-biggest margin of victory in league history`,
      tone: "good",
    });
  }
  // A TIE IS NOT A NARROW WIN. Zero would top this list forever, and nobody won.
  if (margin > 0) {
    const narrow = place(margin, t.narrow, lower, wins(peers.ahead), wins(peers.behind));
    if (narrow) {
      out.push({
        rank: narrow,
      list: "narrow",
        short: `#${narrow} closest`,
      long: `#${narrow} closest win`,
        full: `${ordinal(narrow)}-narrowest margin of victory in league history`,
        tone: "good",
      });
    }
  }

  const combined = a + b;
  const ch = place(combined, t.combinedHigh, higher, combinedOf(peers.ahead), combinedOf(peers.behind));
  if (ch) {
    out.push({
      rank: ch,
      list: "combinedHigh",
      short: `#${ch} high combined`,
      long: `#${ch} highest scoring matchup`,
      full: `${ordinal(ch)}-highest combined score of any matchup in league history`,
      tone: "good",
    });
  }
  const cl = place(combined, t.combinedLow, lower, combinedOf(peers.ahead), combinedOf(peers.behind));
  if (cl) {
    out.push({
      rank: cl,
      list: "combinedLow",
      short: `#${cl} low combined`,
      long: `#${cl} lowest scoring matchup`,
      full: `${ordinal(cl)}-lowest combined score of any matchup in league history`,
      tone: "bad",
    });
  }

  return out.sort((x, y) => x.rank - y.rank);
}
