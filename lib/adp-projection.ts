import { adpSortKey } from "@/lib/adp-format";
import {
  overallPick,
  pickInRound,
  pickLabel,
  type BoardPick,
  type DraftShape,
} from "@/lib/draft-slots";
import type { AdpEntry } from "@/lib/data";

/**
 * Where every undrafted player lands if the draft runs in exact ADP order.
 *
 * THE KEEPERS COME OFF THE BOARD IMMEDIATELY, but the picks they cost are spread
 * across all 17 rounds. That asymmetry is the whole reason a keeper league's
 * early rounds feel thin: at pick 1 the pool is already missing every kept
 * player, and it only catches up as their pick slots go by. So a keeper cell
 * consumes NO player from the pool — he was never in it — while every live pick
 * takes the next name.
 *
 * STRICT ADP ORDER, DELIBERATELY. Modelling reaches and positional runs would be
 * guessing; this states the market's own ordering and lets the dilution show
 * rather than hiding it behind a simulation.
 *
 * ANSWERS BOTH DIRECTIONS from one walk. The board asks "who is at this pick"
 * and the player modal asks "which pick is this player", and they have to agree
 * — a modal reading 14.08 while the cell at 14.08 names someone else is worse
 * than either number on its own.
 *
 * TAKES THE OCCUPIED CELLS, NOT THE SELECTED PLAYERS. A keeper the bylaws leave
 * unplaceable frees his cell back to the draft, so `placeKeepers().byPick` is the
 * authority on what is actually spent; treating him as off the board here and
 * on the board there would shift every later pick by one.
 *
 * ORDER-DEPENDENT, which is easy to miss. A player's projected OVERALL pick
 * depends on how the keeper cells fall through the board, and that depends on
 * which team sits in which slot. There is no answer before the order is drawn,
 * so callers gate on having a board at all.
 */

export interface ProjectedPick {
  round: number;
  slot: number;
  /** Position within the round, 1..teams — the "08" in "14.08". */
  inRound: number;
  /** 1-based across the whole draft, e.g. 138. */
  overall: number;
  /** "14.08". */
  label: string;
  /** Roster that would actually make the pick, after trades. */
  ownerRoster: number;
  /**
   * True when the player is being KEPT and this is the pick his keeper consumes,
   * rather than a spot the draft would take him at.
   */
  kept?: boolean;
}

export interface DraftProjection {
  /** "round:slot" -> who the market says is there. */
  byPick: Map<string, AdpEntry>;
  /**
   * playerId -> where the draft WOULD take him if he were released. Kept players
   * only; empty for everyone else, who are already in `byPlayer`.
   *
   * This is what makes a keeper's value legible. `byPlayer` says Jaxon
   * Smith-Njigba leaves the board at 11.06 because that is the pick his keeper
   * spends — true, and useless for deciding whether to spend it. This says the
   * draft would take him 1.02, so an R11 contract is worth ten rounds. The two
   * answer different questions and the UI shows both.
   */
  ifReleased: Map<string, ProjectedPick>;

  /**
   * playerId -> where he comes off the board.
   *
   * COVERS KEPT PLAYERS TOO, marked `kept`: for them it is the pick their keeper
   * consumes, which is where they actually leave the board. It is deliberately
   * NOT a counterfactual "where would he go if released" — that reads as a wild
   * answer next to a name you have already ticked (an elite keeper on a cheap
   * contract would show 1.02), and the pick he is occupying is the fact the
   * board is drawing.
   */
  byPlayer: Map<string, ProjectedPick>;
}

export function projectDraft({
  board,
  shape,
  placedByPick,
  adp,
}: {
  board: BoardPick[];
  shape: DraftShape;
  /** "round:slot" -> the keeper occupying it, from `placeKeepers()`. */
  placedByPick: Map<string, { playerId: string }>;
  adp: Record<string, AdpEntry>;
}): DraftProjection {
  const byPick = new Map<string, AdpEntry>();
  const byPlayer = new Map<string, ProjectedPick>();
  const ifReleased = new Map<string, ProjectedPick>();

  const kept = new Set([...placedByPick.values()].map((k) => k.playerId));
  // Sorted on the ADP figure being SHOWN, not beatadp's consensus `rank` — the
  // same rule the pool list uses, so the two orderings cannot disagree.
  const pool = Object.values(adp)
    .filter((e) => e.playerId && !kept.has(e.playerId))
    .sort((a, b) => adpSortKey(a) - adpSortKey(b) || a.rank - b.rank);

  const inOrder = [...board].sort(
    (a, b) => overallPick(a.round, a.slot, shape) - overallPick(b.round, b.slot, shape),
  );

  const cellByKey = new Map(inOrder.map((p) => [`${p.round}:${p.slot}`, p]));

  let next = 0;
  for (const p of inOrder) {
    const key = `${p.round}:${p.slot}`;
    if (placedByPick.has(key)) continue;
    const entry = pool[next];
    if (!entry) break;
    next++;
    byPick.set(key, entry);
    byPlayer.set(entry.playerId as string, {
      round: p.round,
      slot: p.slot,
      inRound: pickInRound(p.round, p.slot, shape),
      overall: overallPick(p.round, p.slot, shape),
      label: pickLabel(p.round, p.slot, shape),
      ownerRoster: p.ownerRoster,
    });
  }

  /**
   * A kept player leaves the board at the pick his keeper consumes.
   *
   * The same cell the grid paints green, so the two never disagree about where
   * he went. `placeKeepers` has already applied the same-round bump rule, so
   * this is the pick actually spent rather than the contract's nominal round.
   */
  const liveCells = inOrder.filter((p) => !placedByPick.has(`${p.round}:${p.slot}`));
  const sortKey = (e: AdpEntry) => [adpSortKey(e), e.rank] as const;
  const before = (a: readonly [number, number], b: readonly [number, number]) =>
    a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

  for (const [cellKey, kept] of placedByPick) {
    const cell = cellByKey.get(cellKey);
    if (!cell) continue;
    const at = (p: BoardPick, flag: Partial<ProjectedPick>): ProjectedPick => ({
      round: p.round,
      slot: p.slot,
      inRound: pickInRound(p.round, p.slot, shape),
      overall: overallPick(p.round, p.slot, shape),
      label: pickLabel(p.round, p.slot, shape),
      ownerRoster: p.ownerRoster,
      ...flag,
    });

    byPlayer.set(kept.playerId, at(cell, { kept: true }));

    /**
     * Releasing him does two things at once and both matter: he re-enters the
     * pool at his own ADP, and the cell he was occupying goes back to the draft.
     * Counting only the first would place him one pick early for every keeper
     * ahead of him.
     *
     * Exact but for one ripple — freeing his cell can let a team-mate slide under
     * the same-round bump rule, moving a later keeper by a pick. Rare, an order
     * of magnitude smaller than the number itself, and modelling it would mean
     * re-running the whole placement once per player.
     */
    const entry = adp[kept.playerId];
    if (!entry || entry.rank == null) continue;
    const cells = [...liveCells, cell].sort(
      (a, b) => overallPick(a.round, a.slot, shape) - overallPick(b.round, b.slot, shape),
    );
    const k = sortKey(entry);
    const target = cells[pool.filter((e) => before(sortKey(e), k)).length];
    if (target) ifReleased.set(kept.playerId, at(target, {}));
  }

  return { byPick, byPlayer, ifReleased };
}
