"use client";

/**
 * Replays a real past season, so a phase can be developed before it arrives.
 *
 * REPLAY, NOT FABRICATION. An earlier version invented fixtures and scores; a
 * real season is strictly better, because the layout gets built against the shape
 * of actual data — blowouts, near-ties, a 40-point disaster week, co-owned teams —
 * rather than against numbers chosen to look reasonable. When this season reaches
 * the same phase, the UI has already been seen with data like it.
 *
 * The source is `public/mock/<league>.json`, written by derive from the most
 * recent finished season. Fetched ONLY when a mock is on, so nobody who is not
 * developing ever downloads it.
 *
 * ONLY FILLS IN WHAT IS MISSING. Once the real season reaches a phase, its own
 * data wins and the flag goes quiet — no cleanup, and no risk of a stale flag
 * faking a state the league has genuinely reached.
 */

import type { LeaguePhase } from "./phase.ts";
import type { LiveMatchup, LiveSeason, LiveTeam } from "./types.ts";

export interface Replay {
  season: number;
  regularSeasonWeeks: number;
  teams: Array<{
    ownerSlug: string;
    /** Co-owners included, so a replayed shared team reads "Jaymie & Katie". */
    ownerSlugs: string[];
    rosterId: number;
    teamName: string | null;
  }>;
  weeks: Record<string, Array<{ a: [string, number]; b: [string, number] }>>;
  draft: {
    startTime: number | null;
    type: string;
    rounds: number;
    teams: number;
    reversalRound: number;
    slotToRoster: Record<string, number>;
  } | null;
}

/** The week each phase replays. `drafted` is week 1 not yet played. */
export const DEFAULT_REPLAY_WEEK: Partial<Record<LeaguePhase, number>> = {
  drafted: 1,
  weekPreview: 6,
  weekLive: 6,
  weekComplete: 6,
};

/**
 * Standings as they stood after a given week.
 *
 * Summed from the replayed results rather than stored, so any week can be asked
 * for without a file per week.
 */
function standingsThrough(replay: Replay, throughWeek: number): LiveTeam[] {
  const acc = new Map<string, LiveTeam>(
    replay.teams.map((t) => [
      t.ownerSlug,
      {
        ownerSlug: t.ownerSlug,
        ownerSlugs: t.ownerSlugs ?? [t.ownerSlug],
        rosterId: t.rosterId,
        teamName: t.teamName,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        waiverBudgetUsed: 0,
        players: [],
        starters: [],
      },
    ]),
  );

  for (let week = 1; week <= throughWeek; week++) {
    for (const game of replay.weeks[String(week)] ?? []) {
      for (const [self, other] of [
        [game.a, game.b],
        [game.b, game.a],
      ] as const) {
        const team = acc.get(self[0]);
        if (!team) continue;
        team.pointsFor = Number((team.pointsFor + self[1]).toFixed(2));
        team.pointsAgainst = Number((team.pointsAgainst + other[1]).toFixed(2));
        if (self[1] > other[1]) team.wins += 1;
        else if (self[1] < other[1]) team.losses += 1;
        else team.ties += 1;
      }
    }
  }
  return [...acc.values()];
}

function weekMatchups(replay: Replay, week: number, scored: boolean): LiveMatchup[] {
  return (replay.weeks[String(week)] ?? []).map((g, i) => ({
    matchupId: i + 1,
    a: { ownerSlug: g.a[0], points: scored ? g.a[1] : 0 },
    b: { ownerSlug: g.b[0], points: scored ? g.b[1] : 0 },
  }));
}

export function applyPhaseMock(
  live: LiveSeason,
  phase: LeaguePhase | null,
  replay: Replay | null,
  week?: number,
): LiveSeason {
  if (!phase || !replay) return live;
  const target = week ?? DEFAULT_REPLAY_WEEK[phase];
  if (!target) return live;

  // The real season already got here — leave it alone.
  const inSeason = live.seasonType === "regular" || live.seasonType === "post";
  if (inSeason && live.matchups.length) {
    const started = live.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
    const complete = (live.lastScoredLeg ?? 0) >= live.week;
    const actual: LeaguePhase = complete ? "weekComplete" : started ? "weekLive" : "weekPreview";
    if (actual === phase) return live;
  }

  const done = phase === "weekComplete";
  const scored = phase === "weekLive" || done;

  return {
    ...live,
    // The REPLAYED season, not the current one. Keeping 2026 on screen while
    // showing 2025's results left every link dead — matchup pages are keyed by
    // season, so /matchups/2026-6-... does not exist, and neither does
    // /history/2026/. Naming the year the data comes from makes the whole page
    // navigable and stops it claiming results that have not happened.
    season: replay.season,
    week: target,
    displayWeek: target,
    // `drafted` keeps "pre": that is what Sleeper reports until week 1, and it is
    // how resolvePhase still tells it apart from a genuine week preview.
    seasonType: phase === "drafted" ? live.seasonType : "regular",
    status: phase === "drafted" ? live.status : "in_season",
    teams: standingsThrough(replay, done ? target : target - 1),
    matchups: weekMatchups(replay, target, scored),
    lastScoredLeg: done ? target : target - 1,
  };
}
