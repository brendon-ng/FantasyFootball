"use client";

import { ContractRow, orderBySelection, useSelectedKeepers } from "@/components/keeper-selection";
import { type LeagueRef } from "@/lib/league-ref";
import { LiveStatus } from "@/lib/live";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/** One owner's full contract list, with live selections marked and floated up. */
export function OwnerContracts({
  ownerSlug,
  contracts,
  players,
  adp,
  userIdToSlug,
  leagueRef,
  maxKeepers,
  draftRounds,
}: {
  ownerSlug: string;
  /**
   * EVERY owned contract in the league, not just this owner's.
   *
   * The live layer reassigns ownership, so it has to see a player before it can
   * move him here — a trade received since the last archive is filed under the
   * SENDING owner until then. Narrowed to `ownerSlug` after the hook, below.
   */
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  /** Last round of the draft — the floor an expired contract is revalued to. */
  draftRounds: number;
  userIdToSlug: Record<string, string>;
  leagueRef: LeagueRef | null;
  maxKeepers: number;
}) {
  const { byOwner, contracts: live, adjustments, ready } = useSelectedKeepers(
    leagueRef,
    userIdToSlug,
    contracts,
  );
  const selected = byOwner.get(ownerSlug) ?? new Set<string>();
  const mine = live.filter((c) => c.ownerSlug === ownerSlug);
  const ordered = orderBySelection(mine, selected);

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2 sm:px-5">
        <span className="text-[11px] text-chalk-600">
          {ready
            ? `${selected.size} of ${maxKeepers} keepers selected · ${ordered.length} rostered`
            : "Loading from Sleeper"}
        </span>
        <LiveStatus status={ready ? "ready" : "loading"} provider={leagueRef?.provider} />
      </div>
      <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
        {ordered.map((c) => (
          // `min-w-0`: a GRID ITEM defaults to `min-width: auto`, so without it
          // the row refuses to shrink below its content — the name never
          // truncates and the cost column is clipped off the right edge by the
          // panel's `overflow-hidden`. The keeper page does not hit this because
          // its rows sit in a plain block container. Same fix as the home board.
          <div key={c.playerId} className="min-w-0 bg-ink-800">
            <ContractRow
              contract={c}
              player={players[c.playerId]}
              adp={adp[c.playerId]}
              draftRounds={draftRounds}
              selected={selected.has(c.playerId)}
              liveNote={adjustments.get(c.playerId)}
            />
          </div>
        ))}
      </div>
    </>
  );
}
