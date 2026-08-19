"use client";

import { useEffect, useState } from "react";
import { refKey, type LeagueRef } from "@/lib/league-ref";
import { leagueMoves, type LeagueMove } from "@/lib/live";

import type { KeeperContract } from "@/lib/types";

/**
 * Applies not-yet-finalized transactions to the baked keeper contracts.
 *
 * WHAT THIS IS STILL FOR, now that transactions archive ahead of scoring.
 * `sync` fetches them through `settings.leg` rather than the last scored week,
 * so a preseason trade is committed by the next daily `archive.yml` run — hours,
 * not the month it used to be. This closes the remaining gap: the window between
 * a move processing and that run, plus the wait for the next scheduled deploy,
 * which together can still be a day. Bylaws 1.7.2.4 reprice a dropped-and-
 * re-added player, so a board that is a day stale is wrong exactly when it is
 * being used to decide keepers.
 *
 * MATCHUPS still wait for scoring; only transactions run ahead. Anything here
 * that reads a week's POINTS would still be held to the old horizon.
 *
 * AN ADJUSTMENT MARKS A DIFFERENCE, NOT AN EVENT, and that distinction is what
 * makes the gold dot clear on its own. `fromWeek` is 1, so Sleeper keeps
 * returning a preseason trade for as long as the league exists — noting it
 * whenever it is SEEN meant the dot would still be there months after derive had
 * baked the move in. Every branch below therefore compares against the committed
 * contract and stays silent when they already agree, which also means this needs
 * no knowledge of when sync or derive last ran.
 *
 * WHY A PRESEASON MOVE STAYS MARKED FOR WEEKS. `resolveKeepers` only walks
 * FINISHED seasons and seasons with an ARCHIVED DRAFT, so an in-progress
 * pre-draft season contributes nothing to a contract however promptly its
 * transactions are archived — `raw/<season>/transactions` fills up daily while
 * `keepers.json` does not move. The dot is telling the truth for that whole
 * window; it clears when the draft is archived and the cycle turns.
 *
 * THE RULES HERE MIRROR `resolveKeepers()` IN scripts/derive.ts. If one changes,
 * change both — the derived value and the live adjustment must agree or a
 * contract will flicker as a week finalizes.
 */

export interface LiveAdjustment {
  playerId: string;
  note: string;
}

/** Weeks to probe. Preseason moves all land on leg 1; a few more covers early season. */
const PROBE_WEEKS = 4;

export function useLiveContracts({
  leagueRef,
  fromWeek,
  contracts,
  rosterToOwner,
  liveRosterPlayers,
  rostersReady,
  undraftedFreeAgentRound = 11,
  maxKeeps = 2,
}: {
  leagueRef: LeagueRef | null;
  /** First week not yet baked into the derived data. */
  fromWeek: number;
  contracts: KeeperContract[];
  /** roster_id -> owner slug, from the live rosters. */
  rosterToOwner: Map<number, string>;
  /** owner slug -> player_ids currently rostered, from the live rosters. */
  liveRosterPlayers: Map<string, Set<string>>;
  rostersReady: boolean;
  undraftedFreeAgentRound?: number;
  maxKeeps?: number;
}): { contracts: KeeperContract[]; adjustments: LiveAdjustment[]; ready: boolean } {
  const [txns, setTxns] = useState<LeagueMove[] | null>(null);
  // `refKey` stands in for `leagueRef`, a fresh object on every render.
  const key = refKey(leagueRef);

  useEffect(() => {
    if (!leagueRef) return;
    let cancelled = false;

    (async () => {
      try {
        const moves = await leagueMoves(leagueRef, fromWeek, PROBE_WEEKS);
        if (!cancelled) setTxns(moves);
      } catch {
        // Fail soft: the baked contracts are still shown, just unadjusted.
        if (!cancelled) setTxns([]);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fromWeek]);

  if (!leagueRef) return { contracts, adjustments: [], ready: true };
  if (!txns || !rostersReady) return { contracts, adjustments: [], ready: false };

  const byId = new Map(contracts.map((c) => [c.playerId, { ...c }]));
  const adjustments: LiveAdjustment[] = [];
  const note = (playerId: string, text: string) => adjustments.push({ playerId, note: text });

  for (const t of [...txns].sort((a, b) => a.ts - b.ts)) {
    // Drops first, except in a trade where the drop side is the sending team.
    if (t.type !== "trade") {
      for (const playerId of Object.keys(t.drops)) {
        const c = byId.get(playerId);
        if (!c) continue;
        // Only a CHANGE is worth marking. See the note on state vs events below.
        if (c.ownerSlug !== null) {
          c.ownerSlug = null;
          note(playerId, "dropped since the last sync");
        }
      }
    }

    for (const [playerId, rosterId] of Object.entries(t.adds)) {
      const owner = rosterToOwner.get(rosterId) ?? null;
      const prior = byId.get(playerId);

      if (t.type === "trade" || t.type === "commissioner") {
        if (prior && prior.ownerSlug !== owner) {
          prior.ownerSlug = owner;
          note(playerId, t.type === "trade" ? "traded since the last sync" : "moved by the commissioner");
        }
        continue;
      }

      if (!prior) {
        byId.set(playerId, {
          playerId,
          ownerSlug: owner,
          round: undraftedFreeAgentRound,
          keepsUsed: 0,
          keepsRemaining: maxKeeps,
          expired: false,
          origin: "undrafted-fa",
          startSeason: 0,
          originalDraftRound: null,
          provenance: [`picked up since the last sync — R${undraftedFreeAgentRound} value`],
        });
        note(playerId, `picked up since the last sync — R${undraftedFreeAgentRound}`);
      } else {
        // "11th round OR the round originally drafted, whichever is EARLIER."
        const base = prior.originalDraftRound ?? undraftedFreeAgentRound;
        const newRound = Math.min(undraftedFreeAgentRound, base);
        byId.set(playerId, {
          ...prior,
          ownerSlug: owner,
          round: newRound,
          keepsUsed: 0,
          keepsRemaining: maxKeeps,
          expired: false,
          origin: "reacquired",
          provenance: [
            ...prior.provenance,
            `re-acquired since the last sync — min(R${undraftedFreeAgentRound}, R${base}) = R${newRound}, contract reset`,
          ],
        });
        // Unchanged means derive has already replayed this pickup, so there is
        // nothing pending to mark.
        const changed =
          prior.ownerSlug !== owner ||
          prior.round !== newRound ||
          prior.keepsUsed !== 0 ||
          prior.origin !== "reacquired";
        if (changed && newRound !== prior.round) {
          note(playerId, `re-acquired — cost is now R${newRound}, was R${prior.round}`);
        } else if (changed) {
          note(playerId, "re-acquired — contract reset");
        }
      }
    }
  }

  // The live roster is the authority on who holds whom; the transaction log is
  // not a complete record of roster mutation. Same rule derive applies to the
  // final snapshot of a finished season.
  for (const c of byId.values()) {
    const holder = [...liveRosterPlayers.entries()].find(([, ids]) => ids.has(c.playerId))?.[0] ?? null;
    if (holder !== c.ownerSlug) {
      if (!adjustments.some((a) => a.playerId === c.playerId)) {
        note(c.playerId, holder ? `now held by ${holder}` : "no longer rostered");
      }
      c.ownerSlug = holder;
    }
  }

  return { contracts: [...byId.values()], adjustments, ready: true };
}
