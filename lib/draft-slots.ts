/**
 * Where a pick sits in a draft, and which pick a keeper consumes.
 *
 * Pure and shared: the owner profile's pick list, the keeper tracker's projected
 * board, and any future post-draft check all need the same answers, and three
 * implementations of a bylaw would drift.
 *
 * NONE OF THIS WORKS UNTIL THE DRAFT ORDER EXISTS. Sleeper populates
 * `slot_to_roster_id` with an identity placeholder (slot 1 -> roster 1, ...) from
 * the moment a draft is created, so its presence proves nothing — verified
 * against a 2024 draft that had a start time set and was still unordered.
 * `draft_order` going non-null is the real signal; see `orderIsSet`.
 */

export interface DraftShape {
  rounds: number;
  teams: number;
  type: string;
  /** Slot -> roster, once drawn. */
  slotToRoster: Record<number, number>;
  /** 0 when the draft never reverses; otherwise the round the snake flips on. */
  reversalRound: number;
}

/**
 * True once the order has actually been drawn.
 *
 * Sleeper ships `slot_to_roster_id` as the identity map before then, which would
 * otherwise read as "team in roster order picks in roster order" — plausible,
 * wrong, and invisible.
 */
export const orderIsSet = (draftOrder: unknown, slotToRoster: Record<number, number>): boolean => {
  if (draftOrder) return true;
  const entries = Object.entries(slotToRoster);
  return entries.length > 0 && entries.some(([slot, roster]) => Number(slot) !== roster);
};

/**
 * Position within a round, 1..teams — the "10" in "3.10".
 *
 * A snake reverses every other round, so slot and pick-in-round only agree on odd
 * rounds. Verified against all 170 picks of the 2025 draft.
 */
export function pickInRound(round: number, slot: number, shape: DraftShape): number {
  if (shape.type !== "snake") return slot;
  const reversed =
    shape.reversalRound > 0 && round >= shape.reversalRound
      ? round % 2 === 1
      : round % 2 === 0;
  return reversed ? shape.teams - slot + 1 : slot;
}

/** Overall pick number, 1-based across the whole draft. */
export const overallPick = (round: number, slot: number, shape: DraftShape): number =>
  (round - 1) * shape.teams + pickInRound(round, slot, shape);

/** "3.10" — the label the league uses for a pick. */
export const pickLabel = (round: number, slot: number, shape: DraftShape): string =>
  `${round}.${String(pickInRound(round, slot, shape)).padStart(2, "0")}`;

export interface BoardPick {
  round: number;
  slot: number;
  /** Position within the round, 1..teams. */
  inRound: number;
  /** Roster whose slot this is. */
  fromRoster: number;
  /** Roster that will actually make the pick, after trades. */
  ownerRoster: number;
  traded: boolean;
}

/**
 * Every pick in the draft, with trades applied.
 *
 * Sleeper's `traded_picks` only lists picks that MOVED, so the baseline is every
 * round for every roster and those are laid on top.
 */
export function buildBoard(
  shape: DraftShape,
  tradedPicks: Array<{ round: number; rosterId: number; currentOwnerRosterId: number }>,
): BoardPick[] {
  const moved = new Map(tradedPicks.map((t) => [`${t.round}:${t.rosterId}`, t.currentOwnerRosterId]));
  const out: BoardPick[] = [];
  for (let round = 1; round <= shape.rounds; round++) {
    for (const [slotKey, fromRoster] of Object.entries(shape.slotToRoster)) {
      const slot = Number(slotKey);
      const ownerRoster = moved.get(`${round}:${fromRoster}`) ?? fromRoster;
      out.push({
        round,
        slot,
        inRound: pickInRound(round, slot, shape),
        fromRoster,
        ownerRoster,
        traded: ownerRoster !== fromRoster,
      });
    }
  }
  return out.sort((a, b) => a.round - b.round || a.inRound - b.inRound);
}

export interface SlotAssignment {
  playerId: string;
  /** The pick the keeper consumes, or null when none is legal. */
  pick: BoardPick | null;
  /** Set when the keeper had to move up from its own cost round. */
  bumpedFrom: number | null;
  reason: string | null;
}

/**
 * Assigns keepers to actual picks, per bylaws 1.7.2.2.2.
 *
 * TWO ORDERING RULES, and they are different things:
 *
 * 1. Keepers are placed in ASCENDING COST ROUND — most constrained first. A round
 *    1 keeper can only ever use a round 1 pick; a round 12 keeper has eleven
 *    fallbacks. Placing cheap ones first lets them eat a pick an expensive keeper
 *    had no alternative to.
 * 2. Within a round the keeper takes the LOWER slot — 3.10 over 3.05 — so the team
 *    keeps its earlier pick to actually draft with. "Lower" means later in the
 *    round, i.e. the higher pick-in-round.
 *
 * A keeper whose own round is gone moves UP to the nearest earlier round it can
 * pay for, which is what the existing round-only allocation already did.
 */
export function assignKeeperSlots(
  keepers: Array<{ playerId: string; round: number; expired: boolean }>,
  ownedPicks: BoardPick[],
): SlotAssignment[] {
  // Latest pick in a round first, so rule 2 falls out of a pop().
  const byRound = new Map<number, BoardPick[]>();
  for (const p of ownedPicks) {
    byRound.set(p.round, [...(byRound.get(p.round) ?? []), p]);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.inRound - b.inRound);

  return [...keepers]
    .sort((a, b) => a.round - b.round)
    .map((k) => {
      if (k.expired) {
        return {
          playerId: k.playerId,
          pick: null,
          bumpedFrom: null,
          reason: "Contract expired — cost is this year's ADP, not the original round",
        };
      }
      for (let r = k.round; r >= 1; r--) {
        const list = byRound.get(r);
        if (list?.length) {
          const pick = list.pop()!;
          return {
            playerId: k.playerId,
            pick,
            bumpedFrom: r === k.round ? null : k.round,
            reason: null,
          };
        }
      }
      return {
        playerId: k.playerId,
        pick: null,
        bumpedFrom: null,
        reason: `No pick available in round ${k.round} or earlier — this keeper cannot be made`,
      };
    });
}

/**
 * A stand-in draft order, for working on the board before one is drawn.
 *
 * Enabled with `?mockDraftOrder=true`, which sticks for the session — see
 * lib/sticky-params.ts. Deliberately NOT gated on
 * NODE_ENV: `npm run preview` builds production, and the subpath it serves is the
 * only place basePath bugs show up, so a dev-only gate would disable this exactly
 * where the board most needs looking at.
 *
 * Deterministic — the permutation is seeded by the draft id, so a reload does not
 * reshuffle and a screenshot stays reproducible. `Math.random()` would also
 * re-order on every React render.
 *
 * Anything consuming this MUST surface that it is fake. A mocked order renders
 * identically to a real one, and "the order is out" is exactly the kind of thing
 * someone would screenshot and believe.
 */
export function mockDraftOrder(
  slotToRoster: Record<number, number>,
  seed: string,
): Record<number, number> {
  const hash = (str: string): number => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const slots = Object.keys(slotToRoster).map(Number).sort((a, b) => a - b);
  const rosters = slots
    .map((s) => slotToRoster[s])
    .sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
  return Object.fromEntries(slots.map((slot, i) => [slot, rosters[i]]));
}

/**
 * A stand-in draft date, paired with `mockDraftOrder`.
 *
 * Two weeks out at 7pm local. Far enough that the keeper deadline — three days
 * before the draft, bylaws 1.7 — is still in the future, which is the state worth
 * previewing; a deadline that had already passed would exercise the wrong branch.
 */
export function mockDraftDate(now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 14);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}

/** Keeper deadline: three days before the draft (bylaws 1.7). */
export const keeperDeadline = (draftStart: number): number =>
  draftStart - 3 * 24 * 60 * 60 * 1000;

/**
 * A stand-in date for a draft that has already happened.
 *
 * Three days ago, so the keeper deadline — three days before the draft — is six
 * days past and reads as closed. That is the state `mockDraft` exists to show:
 * picks frozen, results in, first week not yet played.
 */
export function mockCompletedDraftDate(now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 3);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}
