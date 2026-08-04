"use client";

/**
 * Bends the live season into a requested phase, for development.
 *
 * ONLY EVER FILLS IN WHAT IS MISSING. Ask for `weekLive` in October and it does
 * nothing, because the real data already says that. So the flags go quiet on
 * their own as the season catches up with them — no cleanup, and no risk of a
 * stale flag silently faking a state the league has genuinely reached.
 *
 * Scores are FABRICATED here, unlike everywhere else in the app. There is no way
 * to preview a live scoreboard without inventing one, so they are at least
 * deterministic — seeded from slug and week, so a reload shows the same game and a
 * screenshot is reproducible. Anything rendering a mocked phase badges it.
 */

import type { LeaguePhase } from "./phase.ts";
import type { LiveMatchup, LiveSeason } from "./types.ts";

/** Stable pseudo-score in a plausible fantasy range, 60-160. */
function fakePoints(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Number((60 + ((h >>> 0) % 10000) / 100).toFixed(2));
}

/**
 * Pairs teams for a week that Sleeper has not scheduled yet.
 *
 * A fixed rotation rather than anything clever: the point is to have plausible
 * pairings to lay out, not to reproduce Sleeper's scheduler.
 */
function fakeMatchups(live: LiveSeason, week: number, scored: boolean): LiveMatchup[] {
  const teams = [...live.teams].sort((a, b) => a.rosterId - b.rosterId);
  const out: LiveMatchup[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const a = teams[i];
    const b = teams[i + 1];
    out.push({
      matchupId: i / 2 + 1,
      a: {
        ownerSlug: a.ownerSlug,
        points: scored ? fakePoints(`${week}:${a.ownerSlug}`) : 0,
      },
      b: {
        ownerSlug: b.ownerSlug,
        points: scored ? fakePoints(`${week}:${b.ownerSlug}`) : 0,
      },
    });
  }
  return out;
}

export function applyPhaseMock(live: LiveSeason, phase: LeaguePhase | null): LiveSeason {
  if (!phase) return live;

  const inSeason = live.seasonType === "regular" || live.seasonType === "post";
  const weekPhases: LeaguePhase[] = ["weekPreview", "weekLive", "weekComplete"];
  if (!weekPhases.includes(phase)) return live;

  // Already there for real — leave it alone.
  if (inSeason && live.matchups.length) {
    const started = live.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
    const complete = (live.lastScoredLeg ?? 0) >= live.week;
    const actual: LeaguePhase = complete ? "weekComplete" : started ? "weekLive" : "weekPreview";
    if (actual === phase) return live;
  }

  const week = Math.max(1, live.week || 1);
  const scored = phase !== "weekPreview";
  return {
    ...live,
    seasonType: "regular",
    week,
    displayWeek: week,
    status: "in_season",
    matchups: fakeMatchups(live, week, scored),
    lastScoredLeg: phase === "weekComplete" ? week : week - 1,
  };
}
