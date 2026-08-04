/**
 * What part of the league year it is.
 *
 * DERIVED, never stored. Every signal comes from Sleeper, so the site moves
 * through the year on its own — nothing here needs editing each September.
 *
 * The preview/live split keys on whether anyone has POINTS ON THE BOARD, not on
 * the day of the week. Thursday kickoffs move, there are Saturday games in late
 * December, and a clock rule would be wrong several weeks a season. Points cannot
 * be wrong.
 *
 * Pure and dependency-free so both the server render and the browser can use it.
 */

import type { LiveSeason } from "./types.ts";

export const PHASES = [
  "offseason",
  "scheduled",
  "preDraft",
  "drafted",
  "weekPreview",
  "weekLive",
  "weekComplete",
] as const;

export type LeaguePhase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<LeaguePhase, string> = {
  offseason: "Offseason",
  scheduled: "Draft scheduled",
  preDraft: "Pre-draft",
  drafted: "Drafted",
  weekPreview: "Week preview",
  weekLive: "Games in progress",
  weekComplete: "Week complete",
};

export interface PhaseInput {
  live: Pick<LiveSeason, "seasonType" | "week" | "lastScoredLeg" | "matchups"> | null;
  /** From `useLiveDraft`. Null when Sleeper has no draft for the season. */
  draft: { status: string; orderSet: boolean; startTime: number | null } | null;
}

/**
 * The current phase.
 *
 * Ordered from the season inwards: once games are being played the draft is
 * irrelevant, so the week states are decided first.
 */
export function resolvePhase({ live, draft }: PhaseInput): LeaguePhase {
  const inSeason = live?.seasonType === "regular" || live?.seasonType === "post";

  if (inSeason && live) {
    const week = live.week;
    // `last_scored_leg` is Sleeper's own marker for the last fully scored week.
    // Safer than comparing against the current NFL week, which advances before
    // stat corrections settle — the same reason `sync` uses it to decide what is
    // safe to commit.
    if ((live.lastScoredLeg ?? 0) >= week) return "weekComplete";
    const started = live.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
    return started ? "weekLive" : "weekPreview";
  }

  if (draft?.status === "complete") return "drafted";
  if (draft?.orderSet) return "preDraft";
  // A DATE WITHOUT AN ORDER IS ITS OWN STATE, and by bylaw 1.7 it is the normal
  // one: the order is drawn AFTER the keeper deadline, so every year passes
  // through a window where the draft is booked, keepers are due, and the order is
  // still unknown. Folding it into `offseason` meant the site had nothing to say
  // for exactly the weeks it mattered most.
  if (draft?.startTime) return "scheduled";
  return "offseason";
}

/** True once the season has begun — the draft has run and history is last year's. */
export const isCurrentSeason = (phase: LeaguePhase): boolean =>
  phase !== "offseason" && phase !== "scheduled" && phase !== "preDraft";
