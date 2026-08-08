"use client";

import { useEffect, useState } from "react";
import { refKey, type LeagueRef } from "@/lib/league-ref";
import { leagueMoves, type LeagueMove } from "@/lib/live";

import type { KeeperContract } from "@/lib/types";

/**
 * Applies not-yet-finalized transactions to the baked keeper contracts.
 *
 * `sync.ts` only persists a week once Sleeper has scored it, so nothing that
 * happens in the preseason reaches `data/raw` until week 1 finalizes — which is
 * after the keeper deadline and after the draft. Drops and trades genuinely
 * happen in that window, and bylaws 1.7.2.4 reprices a dropped-and-re-added
 * player, so a stale board would be wrong at the exact moment it is being used
 * to make decisions.
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
        c.ownerSlug = null;
        note(playerId, "dropped since the last sync");
      }
    }

    for (const [playerId, rosterId] of Object.entries(t.adds)) {
      const owner = rosterToOwner.get(rosterId) ?? null;
      const prior = byId.get(playerId);

      if (t.type === "trade" || t.type === "commissioner") {
        if (prior) {
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
        if (newRound !== prior.round) {
          note(playerId, `re-acquired — cost is now R${newRound}, was R${prior.round}`);
        } else {
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
