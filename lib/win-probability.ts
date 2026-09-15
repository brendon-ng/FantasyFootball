/**
 * Live win probability for a matchup in progress.
 *
 * THIS IS SLEEPER'S OWN MODEL, read out of their shipped web bundle rather than
 * invented here — so a number on this site agrees with the number in the app
 * people are also looking at. Disagreeing would be worse than not showing one.
 *
 * Each team is a normal distribution centred on its PROJECTED final score. The
 * spread is not a clock: it comes from how far the current score still is from
 * that projection, which stands in for how much football is left. At kickoff
 * the standard deviation is about 30% of the projection; as the score converges
 * on it the distribution collapses and the probability hardens.
 *
 * The answer is P(team A's final > team B's final), taken from the difference
 * of the two distributions, clamped to 1–99% so a card never claims certainty
 * while anybody is still playing.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT. The maths below is transcribed from the
 * bundle and is exact. The PROJECTION it consumes is not: Sleeper blends a
 * player's pre-game projection with the state of his NFL game in a function
 * this could not reach, so `liveProjection` is our own reading of it — see
 * there. Expect agreement to a point or two, not to the decimal.
 */

/**
 * Normal CDF via Abramowitz & Stegun 7.1.26.
 *
 * Hand-rolled rather than pulled in: it is eight lines, this is the only place
 * on the site that needs one, and the error is under 1.5e-7 — four orders of
 * magnitude smaller than the percentage point this rounds to.
 */
function normalCdf(x: number, mean: number, variance: number): number {
  const sd = Math.sqrt(Math.max(variance, 1e-9));
  const z = (x - mean) / (sd * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + (z >= 0 ? y : -y));
}

const clamp = (lo: number, hi: number, x: number) => Math.max(lo, Math.min(hi, x || 0));

/** One team's outcome distribution, centred on its projected final. */
function distribution(current: number, projected: number): { mean: number; variance: number } {
  // 11 at kickoff (current 0), 1 once the score has reached the projection.
  const n = 1 + 10 * (1 - current / projected);
  const sd = Math.sqrt((current - projected) ** 2 / n);
  // `|| 0.1` is load-bearing and inherited: a team that OVERSHOOTS its
  // projection makes `n` negative, `sd` NaN, and NaN is falsy — so an
  // overperforming team falls through to a tiny variance and reads as nearly
  // certain. Kept because matching the app matters more than tidying it.
  return { mean: projected, variance: sd ** 2 || 0.1 };
}

export interface WinProbability {
  /** 0-1 for side A. */
  a: number;
  /** 0-1 for side B. Always `1 - a` unless the game is a dead tie. */
  b: number;
}

/**
 * Chance each side wins, or null when there is nothing to say.
 *
 * NULL BEFORE ANYONE HAS PLAYED, deliberately: two projections and no scores is
 * a prediction about the draft, not about a game in progress, and showing 52%
 * on a Thursday invites an argument about the projections rather than the game.
 */
export function winProbability(
  currentA: number,
  projectedA: number,
  currentB: number,
  projectedB: number,
): WinProbability | null {
  if (!(projectedA > 0) || !(projectedB > 0)) return null;
  if (currentA <= 0 && currentB <= 0) return null;

  // Both sides have reached their projection: nothing is left to play, so this
  // is a result rather than a forecast.
  const doneA = currentA.toFixed(2) === projectedA.toFixed(2);
  const doneB = currentB.toFixed(2) === projectedB.toFixed(2);
  if (doneA && doneB) {
    if (currentA === currentB) return { a: 0, b: 0 };
    return currentA > currentB ? { a: 1, b: 0 } : { a: 0, b: 1 };
  }

  const da = distribution(currentA, projectedA);
  const db = distribution(currentB, projectedB);
  // The difference of two independent normals is normal: means subtract,
  // variances add. P(difference > 0) is the chance A finishes ahead.
  const mean = da.mean - db.mean;
  const variance = da.variance + db.variance;
  const a = clamp(0.01, 0.99, 1 - normalCdf(0, mean, variance));
  return { a, b: clamp(0.01, 0.99, 1 - a) };
}

/**
 * Seconds left in an NFL game, from Sleeper's own scores feed.
 *
 * Transcribed from their bundle, quarter arithmetic and all: a game yet to
 * start is a full 3600, halftime is exactly 1800, and anything over — including
 * a finished overtime — is 0.
 */
export function secondsRemaining(game: {
  quarter?: string | null;
  time_remaining?: string | null;
  is_over?: boolean | null;
}): number {
  const q = game.quarter;
  if (!q) return 3600;
  if (game.is_over || q === "OT" || q === "F" || q === "F/OT") return 0;
  if (q === "HALF" || q === "Halftime") return 1800;
  const [mm, ss] = (game.time_remaining || "").split(":");
  const minutes = parseInt(mm) || 0;
  const seconds = parseInt(ss) || 0;
  const quarter = Number(q) || 0;
  return 15 * (4 - Math.min(quarter, 4)) * 60 + 60 * minutes + seconds;
}

/**
 * A player's projected FINAL, given what he has scored and how much is left.
 *
 * OUR APPROXIMATION, NOT SLEEPER'S. Theirs blends the same three inputs in a
 * function that lives in a module the bundle does not inline, so this is the
 * obvious reading of it: what he has already banked, plus the share of his
 * pre-game projection the remaining clock can still deliver.
 *
 * It is right at both ends by construction — a finished player projects to
 * exactly what he scored, an unstarted one to exactly his projection — so any
 * disagreement is confined to players mid-game, and shrinks as the day goes on.
 */
export function liveProjection(
  current: number,
  preGame: number,
  secondsLeft: number,
): number {
  if (secondsLeft <= 0) return current;
  if (secondsLeft >= 3600) return Math.max(preGame, current);
  return current + preGame * (secondsLeft / 3600);
}
