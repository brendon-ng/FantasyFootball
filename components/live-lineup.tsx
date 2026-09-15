"use client";

import { useMemo } from "react";

import { LineupPanel, type LineupRow } from "@/components/lineup-panel";
import { fmt } from "@/components/ui";
import { positionRank } from "@/lib/espn-maps";
import type { LineupStates } from "@/lib/live";
import { buildNameIndex, matchLivePlayer, type NameIndex } from "@/lib/player-match";
import type { LiveLineupSlot, PlayerMeta } from "@/lib/types";

/**
 * A live lineup, in the same panel the finished matchup page draws.
 *
 * THE RENDERING IS SHARED — `LineupPanel` — so a game looks the same on Sunday
 * as it does once the archive catches up on Tuesday. All this does is turn what
 * the provider says into the rows that panel wants, which is the one part that
 * genuinely differs: the archive has slot ordering and record marks, the live
 * feed has neither, and only the live feed needs its players resolved.
 */
export function LiveLineup({
  title,
  lineup,
  players,
  stateOf,
  markOf,
}: {
  title: string;
  lineup: LiveLineupSlot[] | undefined;
  /** The baked index. Also decides which names can link — a page exists per key. */
  players: Record<string, PlayerMeta>;
  /** From `useLineupStates`, hoisted so both lineups share one NFL-clock fetch. */
  stateOf: LineupStates["stateOf"];
  /**
   * A record-book mark for a STARTED player, once the game is settled.
   *
   * Passed in rather than computed here: ranking needs the rest of the week,
   * which the caller has and a lineup does not.
   */
  markOf?: (slot: LiveLineupSlot) => { short: string; full: string } | null;
}) {
  /**
   * Built once per lineup, not per row. Same reasoning as `LiveRosters`: a
   * lineup resolves a dozen names against a few hundred players, and rebuilding
   * the index inside the row would make it quadratic.
   */
  const nameIndex = useMemo(() => buildNameIndex(players), [players]);

  const rows = useMemo(
    () =>
      (lineup ?? []).map((p) => {
        const row = toRow(p, players, nameIndex);
        // THE RESOLVED TEAM, not the slot's. Sleeper sends no team on a lineup
        // — every id it returns is a Sleeper id and the baked index has it — so
        // asking the raw slot left every Sleeper player with no state at all.
        return {
          ...row,
          state: stateOf({ id: p.id, team: row.team, played: p.played }),
          // STARTERS ONLY, matching the archive: the all-time list is built
          // from started players, so a chip on a bench row would claim a
          // record the book does not contain.
          mark: p.started ? (markOf?.(p) ?? null) : null,
        };
      }),
    [lineup, players, nameIndex, stateOf, markOf],
  );
  const startersTotal = rows.filter((r) => r.started).reduce((t, r) => t + r.points, 0);

  return (
    <LineupPanel
      title={title}
      meta={`${fmt.pts(startersTotal)} from starters`}
      // Sorted like a depth chart rather than by the provider's slot order,
      // which is the one thing the live feed cannot tell us. `LineupPanel`
      // drops the Slot column when nothing fills it.
      rows={[...rows].sort(
        (a, b) =>
          Number(b.started) - Number(a.started) ||
          positionRank(a.position) - positionRank(b.position) ||
          b.points - a.points ||
          a.name.localeCompare(b.name),
      )}
      emptyLabel="No lineup set yet."
      // No "left on it" here: the week may still be running, so points on the
      // bench are not yet a regret.
      benchLabel={(n, pts) => `Bench · ${n} players · ${fmt.pts(pts)}`}
    />
  );
}

function toRow(
  p: LiveLineupSlot,
  players: Record<string, PlayerMeta>,
  index: NameIndex,
): LineupRow {
  /**
   * The provider's id is not enough on ESPN — see `matchLivePlayer`. Sleeper
   * publishes no `espn_id` for plenty of current players, so falling straight
   * through would leave recognisable names unclickable.
   */
  const matchedId = matchLivePlayer(p, players, index);
  const meta = matchedId ? players[matchedId] : undefined;
  return {
    id: p.id,
    // The live feed names the lineup but not the slot ordering, so there is
    // nothing honest to put here. The column disappears rather than guessing.
    slot: null,
    started: p.started,
    // NAME from the baked index first — that is what the rest of the site
    // shows, "James Cook" rather than ESPN's "James Cook III".
    name: meta?.full_name ?? p.name ?? p.id,
    position: meta?.position ?? p.position,
    // TEAM from the PROVIDER first, the other way round: `PlayerMeta.team` is
    // recorded per season and is stale the moment somebody is traded.
    team: p.team ?? meta?.team ?? null,
    points: p.points,
    href: meta ? `/players/${matchedId}/` : null,
  };
}
