/**
 * How NFL scoring actually arrives, measured rather than assumed.
 *
 * Calibrated from 1088 team-games across the 2024-2025 regular seasons, taken from
 * Sleeper's scores feed, which publishes a score per QUARTER. Every game
 * reconciles: the four quarters plus overtime equal the final in all 1088.
 *
 * Two things this is here to correct, both of which were guesses before:
 *
 * SCORING IS NOT SPREAD EVENLY OVER THE CLOCK. Quarters average 4.47, 7.00,
 * 4.76 and 6.59 points — the second and fourth run hot, because a half ending
 * concentrates scoring. So the share of a game's points still to come is not
 * the share of its clock: entering the fourth quarter a quarter of the time is
 * left but 29.4% of the scoring.
 *
 * AND SCORING IS MORE REGULAR THAN A POISSON PROCESS. A compound Poisson of
 * touchdowns and field goals, fitted to the same means, overstates the spread
 * by about a fifth at every stage (sd 11.63 against a measured 9.86 over a
 * full game) and overstates the chance of a shutout everywhere. Football has
 * structure a Poisson does not: possessions alternate, and the clock caps how
 * many drives are left. So the distribution is kept empirical instead.
 *
 * REGENERATE by re-running the calibration over more seasons; the shape is
 * stable between the two here, and nothing downstream assumes these exact
 * numbers beyond their being a distribution that sums to 1.
 */

/** Team-games behind the tables below. */
export const CALIBRATION_SAMPLE = 1088;

/** Mean points scored by one team in one game — the league baseline. */
export const LEAGUE_MEAN_POINTS = 22.962;

/**
 * Share of a game's scoring still to come at the start of each quarter.
 *
 * Index 0 is kickoff. Compare with the share of CLOCK remaining — 1.00, 0.75,
 * 0.50, 0.25 — to see the gap this exists to close.
 */
export const SCORING_SHARE_REMAINING = [1.0, 0.8055, 0.5007, 0.2936];

/**
 * Probability that exactly N more points are scored, from the start of each
 * quarter. `REMAINING_POINTS_PMF[q][n]` where q is 0-3 and n is a point total.
 *
 * Measured, not modelled. Each row sums to 1.
 */
export const REMAINING_POINTS_PMF: readonly (readonly number[])[] = [
  [0.008272, 0.0, 0.000919, 0.013787, 0.0, 0.0, 0.020221, 0.016544, 0.003676, 0.015625, 0.048713, 0.001838, 0.01011, 0.038603, 0.029412, 0.015625, 0.03125, 0.048713, 0.016544, 0.034007, 0.077206, 0.033088, 0.023897, 0.042279, 0.059743, 0.014706, 0.037684, 0.059743, 0.024816, 0.020221, 0.036765, 0.032169, 0.011949, 0.012868, 0.04136, 0.011949, 0.007353, 0.014706, 0.019301, 0.001838, 0.011029, 0.014706, 0.01011, 0.0, 0.011029, 0.002757, 0.0, 0.004596, 0.004596, 0.0, 0.0, 0.000919, 0.002757],
  [0.018382, 0.0, 0.000919, 0.034007, 0.0, 0.000919, 0.028493, 0.036765, 0.007353, 0.020221, 0.065257, 0.008272, 0.016544, 0.073529, 0.039522, 0.020221, 0.054228, 0.076287, 0.014706, 0.030331, 0.067096, 0.040441, 0.016544, 0.037684, 0.060662, 0.003676, 0.025735, 0.046875, 0.025735, 0.013787, 0.020221, 0.014706, 0.004596, 0.006434, 0.032169, 0.011029, 0.001838, 0.007353, 0.007353, 0.000919, 0.004596, 0.001838, 0.000919, 0.0, 0.000919, 0.000919],
  [0.080882, 0.0, 0.0, 0.076287, 0.0, 0.002757, 0.061581, 0.11489, 0.020221, 0.045037, 0.125919, 0.008272, 0.022978, 0.056985, 0.090993, 0.015625, 0.028493, 0.075368, 0.01011, 0.012868, 0.03125, 0.038603, 0.007353, 0.013787, 0.026654, 0.002757, 0.002757, 0.011029, 0.01011, 0.0, 0.001838, 0.003676, 0.0, 0.000919],
  [0.222426, 0.0, 0.002757, 0.142463, 0.0, 0.002757, 0.088235, 0.195772, 0.022978, 0.033088, 0.094669, 0.011029, 0.011949, 0.034007, 0.068934, 0.012868, 0.007353, 0.013787, 0.001838, 0.001838, 0.007353, 0.013787, 0.002757, 0.001838, 0.003676, 0.0, 0.000919, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.000919],
];
