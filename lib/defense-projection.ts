/**
 * A defence's projected final, built from its stat line rather than its total.
 *
 * WHY NEITHER PROVIDER'S MODEL IS RIGHT. Both treat a defence's score as one
 * number and blend it. Sleeper banks it, so a half-time shutout is money in
 * hand; ESPN decays all of it, so a pick-six evaporates. They are wrong in
 * opposite directions because a defence's score is really two different
 * things added together:
 *
 *   TIER STATS — points allowed, yards allowed. These start the game at the
 *   BEST tier, since nobody has scored yet, and walk downhill. They are not
 *   earnings, they are a claim about the game so far, and the rest of the game
 *   can revoke it. (Rarely they improve: a sack for a loss can drop a team back
 *   under a yardage line.)
 *
 *   COUNTING STATS — sacks, interceptions, fumble recoveries, touchdowns,
 *   safeties, blocks. These start at zero and only rise. A pick-six is six
 *   points nobody can take back.
 *
 * So they are projected separately: counting stats are banked and topped up
 * pro-rata, tier stats are re-derived from what the rest of the game is likely
 * to do to them.
 *
 * THE TIER PART IS AN EXPECTATION, NOT A POINT ESTIMATE, and that is the main
 * thing this buys over a tidier version of the same idea. Tier scoring is a
 * step function, so `tier(E[points allowed])` is not `E[tier(points allowed)]`
 * — a defence projected to finish on 20.6 points allowed is not "one point",
 * it is a spread across three or four tiers that happens to average something
 * else. Point estimates also make the projection jump by whole tiers as the
 * clock ticks, which an expectation smooths out.
 *
 * WHAT HAPPENS IN THE GAME DOES NOT ADJUST THE FORECAST, which is the one
 * counter-intuitive part and the one with the most evidence behind it. Across
 * 1,088 team-games, first-half points predict second-half points with a
 * coefficient of +0.026 on their own and −0.026 once a season-long prior is
 * included; adding them to a model that already has the prior improves RMSE by
 * 0.002. A defence pitching a shutout at half-time is not, on this evidence,
 * more likely to keep doing it. Game script appears to cancel team quality:
 * teams ahead run the clock, teams behind throw.
 */

import {
  LEAGUE_MEAN_POINTS,
  REMAINING_POINTS_PMF,
  SCORING_SHARE_REMAINING,
} from "./nfl-scoring.ts";

/** Sleeper stat keys that accumulate and cannot be lost. */
const COUNTING = [
  "sack",
  "int",
  "ff",
  "fum_rec",
  "def_td",
  "safe",
  "blk_kick",
  "def_st_td",
  "def_st_ff",
  "def_st_fum_rec",
  "def_pr_td",
  "def_kr_td",
  "int_ret_yd",
  "fum_rec_td",
] as const;

/**
 * Points-allowed tiers, as Sleeper names them, with the upper bound of each.
 *
 * Ordered, and read as "the first band this total falls in". `pts_allow_35p`
 * is the catch-all, so its bound is infinite.
 */
const PA_TIERS: Array<{ key: string; upTo: number }> = [
  { key: "pts_allow_0", upTo: 0 },
  { key: "pts_allow_1_6", upTo: 6 },
  { key: "pts_allow_7_13", upTo: 13 },
  { key: "pts_allow_14_20", upTo: 20 },
  { key: "pts_allow_21_27", upTo: 27 },
  { key: "pts_allow_28_34", upTo: 34 },
  { key: "pts_allow_35p", upTo: Infinity },
];

export interface DefenseInputs {
  /** This week's stat line so far, Sleeper's keys. */
  now: Record<string, number>;
  /** The pre-game projected stat line, same keys. */
  pre: Record<string, number>;
  /** The league's scoring settings. */
  scoring: Record<string, number>;
  /** Seconds left in this defence's game. 0 once it is over. */
  secondsLeft: number;
}

/** Points from the tier a given points-allowed total lands in. */
function tierPoints(pointsAllowed: number, scoring: Record<string, number>): number {
  for (const t of PA_TIERS) {
    if (pointsAllowed <= t.upTo) return scoring[t.key] ?? 0;
  }
  return 0;
}

/**
 * The share of a game's scoring still to come, interpolated within the quarter.
 *
 * `SCORING_SHARE_REMAINING` is measured at quarter boundaries; between them
 * this runs straight, which is the honest resolution of the data — the feed
 * gives scores per quarter and nothing finer.
 */
export function scoringShareRemaining(secondsLeft: number): number {
  const s = Math.max(0, Math.min(3600, secondsLeft));
  if (s <= 0) return 0;
  const quartersLeft = s / 900;
  const i = Math.min(3, Math.max(0, Math.ceil(quartersLeft) - 1));
  const atStart = SCORING_SHARE_REMAINING[3 - i] ?? 0;
  const atEnd = i === 0 ? 0 : (SCORING_SHARE_REMAINING[3 - i + 1] ?? 0);
  // How far into this quarter we are, 0 at its start and 1 at its end.
  const through = 1 - (quartersLeft - Math.floor(quartersLeft) || 1);
  return atStart + (atEnd - atStart) * through;
}

/**
 * The distribution of points a defence still has to concede.
 *
 * Takes the measured shape for whichever quarter the game is in, then SCALES
 * THE VALUES so its mean matches what this particular defence is expected to
 * allow. Scaling the values rather than reweighting keeps the measured shape —
 * the coefficient of variation is what changes across a game, and that is
 * already in the four separate rows.
 */
function remainingAllowedPmf(
  secondsLeft: number,
  projectedTotalAllowed: number,
): Array<{ points: number; p: number }> {
  if (secondsLeft <= 0) return [{ points: 0, p: 1 }];
  const quartersLeft = Math.max(0, Math.min(4, secondsLeft / 900));
  const row = REMAINING_POINTS_PMF[Math.min(3, 4 - Math.ceil(quartersLeft))] ?? [];
  const rowMean = row.reduce((t, p, v) => t + p * v, 0);
  if (!(rowMean > 0)) return [{ points: 0, p: 1 }];

  // What this defence, rather than an average one, is expected to still allow.
  const expected =
    (projectedTotalAllowed > 0 ? projectedTotalAllowed : LEAGUE_MEAN_POINTS) *
    scoringShareRemaining(secondsLeft);
  const scale = expected / rowMean;
  return row.map((p, v) => ({ points: v * scale, p })).filter((x) => x.p > 0);
}

/**
 * A defence's projected final score for the week.
 *
 * Returns null when the inputs cannot support an answer — no projected stat
 * line, most often — so the caller can fall back rather than print a zero.
 */
export function projectDefense(input: DefenseInputs): number | null {
  const { now, pre, scoring, secondsLeft } = input;
  if (!Object.keys(pre).length) return null;

  const share = scoringShareRemaining(secondsLeft);

  // 1. Counting stats: what is banked, plus the share of the projection left
  //    to earn. Never less than banked — these cannot be taken away.
  let counting = 0;
  for (const key of COUNTING) {
    const weight = scoring[key];
    if (!weight) continue;
    const banked = now[key] ?? 0;
    const projectedTotal = pre[key] ?? 0;
    counting += (banked + projectedTotal * share) * weight;
  }

  // 2. Tier stats: the expectation over where the final total lands, not the
  //    tier of the expected total. See the note at the top.
  const allowedSoFar = now.pts_allow ?? 0;
  const pmf = remainingAllowedPmf(secondsLeft, pre.pts_allow ?? 0);
  let tier = 0;
  for (const { points, p } of pmf) {
    tier += p * tierPoints(allowedSoFar + points, scoring);
  }

  return Number((counting + tier).toFixed(2));
}
