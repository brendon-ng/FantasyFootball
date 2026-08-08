import { assignKeeperSlots, costRound, type BoardPick } from "@/lib/draft-slots";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract } from "@/lib/types";

/**
 * Which pick each keeper consumes, league-wide.
 *
 * Lifted out of `ProjectedDraftBoard` so the board and the available-pool list
 * agree. The pool needs to know how many LIVE picks each round still has in
 * order to draw round breaks, and that count is a function of where keepers
 * land — which depends on pick ownership after trades and on the same-round bump
 * rule, so it cannot be approximated by counting cost rounds. Two derivations of
 * that would drift, and the disagreement would be invisible: the board and the
 * list would simply tell you different things about the same draft.
 */

export interface Placement {
  /** "round:slot" -> the keeper occupying it. */
  byPick: Map<string, { playerId: string; rosterId: number }>;
  /**
   * Live (undrafted, unspent) picks per round, indexed 1..rounds. Index 0 unused
   * so the array reads like a round number.
   */
  livePicksByRound: number[];
}

export function placeKeepers({
  board,
  rounds,
  selectedByRoster,
  contracts,
  adp,
  draftRounds,
  maxKeepers,
}: {
  board: BoardPick[];
  rounds: number;
  /** rosterId -> playerIds locked in. */
  selectedByRoster: Map<number, string[]>;
  contracts: KeeperContract[];
  adp: Record<string, AdpEntry>;
  draftRounds: number;
  maxKeepers: number;
}): Placement {
  const byId = new Map(contracts.map((c) => [c.playerId, c]));
  const byPick = new Map<string, { playerId: string; rosterId: number }>();

  for (const [rosterId, playerIds] of selectedByRoster) {
    const owned = board.filter((p) => p.ownerRoster === rosterId);
    const picked = playerIds
      .map((id) => byId.get(id))
      .filter((c): c is KeeperContract => Boolean(c))
      .slice(0, maxKeepers)
      // Cost, not the stored round: an expired contract is revalued to ADP and
      // consumes the pick that costs, rather than being left off the board.
      .map((c) => ({ playerId: c.playerId, round: costRound(c, adp[c.playerId], draftRounds) }));
    for (const a of assignKeeperSlots(picked, owned)) {
      if (a.pick) byPick.set(`${a.pick.round}:${a.pick.slot}`, { playerId: a.playerId, rosterId });
    }
  }

  // Counted off the BOARD, not off the team count: a round holds however many
  // picks exist in it, and a keeper that bumped up out of its cost round has
  // already been placed wherever it actually landed.
  const livePicksByRound = Array.from({ length: rounds + 1 }, () => 0);
  for (const p of board) {
    if (p.round <= rounds && !byPick.has(`${p.round}:${p.slot}`)) livePicksByRound[p.round]++;
  }

  return { byPick, livePicksByRound };
}
