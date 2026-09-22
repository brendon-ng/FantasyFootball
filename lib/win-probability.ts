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
 * ALL THREE PIECES ARE TRANSCRIBED, not inferred: the probability maths here,
 * the seconds-remaining arithmetic, and the per-player projection blend in
 * `liveProjection`. The blend was guessed at first and the guess was wrong
 * enough to move a mid-game probability by double digits, which is how it got
 * found; anything still approximate would show up the same way.
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
export function distribution(current: number, projected: number): { mean: number; variance: number } {
  /**
   * 11 at kickoff (current 0), 1 once the score has reached the projection.
   *
   * FLOORED AT 1, WHICH MATTERS NOW THAT A PROJECTION CAN SIT BELOW THE SCORE.
   * Sleeper's blend guarantees per-player `projected >= current`, so a team
   * total never fell below its own score and this expression never went under
   * 1. `defenseProjection` breaks that guarantee deliberately, and unclamped
   * the heuristic did not degrade, it inverted: a projection five points below
   * the score produced MORE uncertainty than one ten points above, and past
   * roughly `current / 1.1` the term went negative, the square root returned
   * NaN, and the `|| 0.1` below caught it — pinning a wide-open team at a
   * third of a point of spread.
   *
   * Inert on everything that could already happen: for `projected >= current`
   * this is the same expression it always was, including the finished case
   * where the two are equal.
   */
  const n = 1 + 10 * Math.max(0, 1 - current / projected);
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
 * Each team's chance of finishing LAST in the league this week.
 *
 * NOT A HEAD-TO-HEAD QUESTION, so the win-probability maths above does not
 * answer it: "lowest of twelve" is P(X_i < every other X_j), and for more than
 * two normals that has no closed form.
 *
 * SOLVED BY INTEGRATION, NOT SIMULATION. The honest alternatives were Monte
 * Carlo — simple, but it resamples every render, so a number on screen would
 * jitter by a point while nothing had actually happened — and this, which is
 * deterministic and reproducible:
 *
 *   P(i is lowest) = ∫ φ_i(x) · ∏_{j≠i} (1 − Φ_j(x)) dx
 *
 * i.e. for every possible score x, the chance team i lands exactly there times
 * the chance everybody else lands above it. Checked against a 200k-trial
 * simulation; see the test below the fold in the commit.
 *
 * THE GRID ADAPTS TO THE NARROWEST TEAM. A side that has finished has variance
 * floored at 0.1 — a standard deviation of about a third of a point — so a grid
 * sized to the league's whole range would step straight over its spike and
 * report nonsense. The step is a fraction of the smallest standard deviation,
 * capped so the loop stays bounded.
 *
 * Normalised at the end: exactly one team finishes last, so the column sums to
 * 1 by construction and any residual integration error is absorbed rather than
 * displayed.
 */
export function lastPlaceOdds(
  teams: Array<{ current: number; projected: number }>,
): number[] | null {
  if (teams.length < 2) return null;
  const dists = teams.map((t) => distribution(t.current, t.projected));
  if (dists.some((d) => !Number.isFinite(d.mean) || !Number.isFinite(d.variance))) return null;

  const sds = dists.map((d) => Math.sqrt(Math.max(d.variance, 1e-9)));
  const lo = Math.min(...dists.map((d, i) => d.mean - 6 * sds[i]));
  const hi = Math.max(...dists.map((d, i) => d.mean + 6 * sds[i]));
  if (!(hi > lo)) return null;

  const STEPS = Math.min(20000, Math.max(2000, Math.ceil((hi - lo) / (Math.min(...sds) / 6))));
  const dx = (hi - lo) / STEPS;

  const out = new Array<number>(teams.length).fill(0);
  for (let k = 0; k <= STEPS; k++) {
    const x = lo + k * dx;
    // Survival — the chance each team finishes ABOVE x.
    const above = dists.map((d) => 1 - normalCdf(x, d.mean, d.variance));
    for (let i = 0; i < teams.length; i++) {
      let others = 1;
      for (let j = 0; j < teams.length; j++) if (j !== i) others *= above[j];
      if (others <= 0) continue;
      out[i] += normalPdf(x, dists[i].mean, dists[i].variance) * others * dx;
    }
  }

  const total = out.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  return out.map((p) => p / total);
}

/**
 * A FANTASY SCORE CAN GO DOWN. This is the fact both certainty checks below
 * turn on, and getting it wrong is what made them claim more than they knew.
 *
 * A lost fumble, an interception, negative rushing yards, a defence shipping
 * another touchdown — a team with players still out there can FALL, not only
 * climb. So "nobody below them can catch up" is not established by anybody's
 * current score while a single game is unfinished; the team above can come
 * down to meet them instead.
 *
 * Both functions therefore require the teams they reason about to have
 * FINISHED. A finished score is the only one that cannot move, and certainty
 * about an ordering needs both ends of it pinned.
 */

/**
 * Who is CERTAINLY last — decided by arithmetic, not by the integral above.
 *
 * NOT A PROBABILITY, AND DELIBERATELY NOT READ AS ONE. `lastPlaceOdds` is a
 * numerical integral over normals that is then normalised; it returns 0.9999…
 * for a settled week and will never return a float equal to 1, so thresholding
 * it at "close enough" would either mark a team who could still escape or fail
 * to mark one who cannot. Certainty is a fact about the schedule, so it is
 * computed from the schedule:
 *
 *   a team is last for sure when EVERY team has finished and this one is
 *   strictly the lowest
 *
 * EVERY team, including the ones above. An earlier version asked only that
 * this team had finished and the rest were currently ahead, on the reasoning
 * that the rest could only climb further away. They cannot — see the note
 * above — so a side still playing with a comfortable lead could come back down
 * and take last off them.
 *
 * Strict inequality, which is also why a tie at the bottom marks NOBODY: two
 * teams level on a final score is an unresolved question for the commissioner,
 * not a determined loser, and the marker should not pre-empt it.
 *
 * Returns one flag per team, in the order given.
 */
export function lockedIntoLast(
  teams: Array<{ current: number; done: boolean }>,
): boolean[] {
  return teams.map(
    (t, i) => t.done && teams.every((o, j) => j === i || (o.done && o.current > t.current)),
  );
}

/**
 * Who CANNOT finish last — the mirror of `lockedIntoLast`, and decided the same
 * way: by arithmetic, not by the integral.
 *
 * The integral cannot say zero. `distribution` keeps Sleeper's `|| 0.1`
 * variance floor, so a team that has finished is still modelled as a normal
 * with a standard deviation of about a third of a point rather than as a point
 * mass. Two finished teams ten points apart sit twenty-odd sigma from each
 * other, which comes out somewhere around 1e-108 — vanishingly small, never
 * 0.0, and the display then rounded it to "<1%" when the honest answer was 0%.
 *
 *   a team is safe once IT has finished and some OTHER finished team is below
 *
 * BOTH must have finished. An earlier version asked only for the other team,
 * reasoning that this one could only climb away from it. It cannot: a side on
 * 80 with players still out can fumble and throw its way below a finished 74.1
 * — unlikely, and not impossible, which is the whole difference between "<1%"
 * and "0%".
 *
 * Strict, so being level with a finished team is not safety — that is a tie
 * for last, which is still last.
 */
export function safeFromLast(
  teams: Array<{ current: number; done: boolean }>,
): boolean[] {
  return teams.map(
    (t, i) => t.done && teams.some((o, j) => j !== i && o.done && o.current < t.current),
  );
}

function normalPdf(x: number, mean: number, variance: number): number {
  const v = Math.max(variance, 1e-9);
  return Math.exp(-((x - mean) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v);
}

/**
 * A DEFENCE's projected final, which is not the same shape as everyone else's.
 *
 * ESPN'S MODEL, solved from their published `totalProjectedPointsLive` and
 * confirmed to the fourth decimal at two different clocks:
 *
 *   projected = current × (1 − f) + preGame × f
 *
 * A WEIGHTED AVERAGE, where every other position gets banked-plus-share. The
 * difference is that most of a defence's score is not BANKED, it is a
 * STATEMENT ABOUT THE GAME SO FAR that the rest of the game can revoke. The
 * Rams sat on 10 points in the second quarter tonight: five for allowing no
 * points and five for a yards-allowed tier, and nothing else — no sack, no
 * takeaway, no touchdown. Treating that as money in the bank, which the
 * offence model does, projected them at 14.27. ESPN said 6.84, because a
 * shutout at half-time is not a shutout.
 *
 * This is the one place the site deliberately disagrees with Sleeper's app,
 * which applies its single blend to defences too and had them at 15.52.
 *
 * KNOWN CRUDE, in the other direction: a defence that has actually banked
 * something permanent — a pick-six is six points nobody can take back — gets
 * regressed along with everything else, because the model works on the total
 * rather than on the stat line. Decomposing banked events from decaying tiers
 * would beat both providers; that is not what this does.
 */
export function defenseProjection(
  current: number,
  preGame: number,
  secondsLeft: number,
): number {
  const f = Math.max(0, Math.min(1, secondsLeft / 3600));
  return current * (1 - f) + preGame * f;
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
 * SLEEPER'S OWN BLEND, transcribed from their bundle like the probability maths
 * above. An earlier version of this file guessed at it — banked points plus a
 * pro-rata share of the projection — and the guess was wrong enough to move the
 * probability by double digits mid-game, which is what gave this away.
 *
 * What it actually does is anchor on the PRE-GAME projection and drag it toward
 * the player's CURRENT PACE as the game runs down:
 *
 *   o  fraction of the game REMAINING (1 at kickoff, 0 at the whistle)
 *   s  pace estimate — what he has, plus his points-per-minute so far
 *      extrapolated over the minutes left, damped by `o`
 *   h  the anchor: his projection, or his current score if he has beaten it
 *
 *   result = h + (1 - o) * (max(s, current) - h)
 *
 * So at kickoff `1 - o` is 0 and it returns the projection untouched; at the
 * final whistle `o` is 0 and it returns exactly what he scored. In between the
 * weight shifts from forecast to evidence. Both ends are exact, which is why
 * the earlier guess looked plausible all week and only diverged mid-game.
 */
export function liveProjection(
  current: number,
  preGame: number,
  secondsLeft: number,
): number {
  // Minutes in a game. 90 for soccer and 48 for basketball in their code; this
  // site is football only, so 60.
  const minutes = 60;
  const o = secondsLeft / (60 * minutes);
  // `|| 1` guards the kickoff divide-by-zero, exactly as they do.
  const pace =
    current + (current / (minutes - secondsLeft / 60 || 1)) * (secondsLeft / minutes) * o;

  // Kept as three terms rather than folded to `pace`, which is what they sum
  // to: the split is theirs, and collapsing it would hide a change if they ever
  // reweight it.
  const low = 0.2 * o * pace;
  const mid = (0.35 + 0.65 * (1 - o)) * pace;
  const high = 0.45 * o * pace;

  const notStarted = o >= 1;
  const over = o <= 0;
  const ceiling = Math.max(low + mid + high, current);
  const anchor = notStarted ? preGame : Math.max(preGame, current);
  if (over && current < 0) return current;
  return anchor + (1 - o) * (ceiling - anchor);
}
