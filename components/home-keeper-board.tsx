"use client";

import Link from "next/link";

import {
  ContractRow,
  orderBySelection,
  useSelectedKeepers,
} from "@/components/keeper-selection";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The home page's keeper summary, one card per team.
 *
 * Shows each team's locked-in keepers first, then backfills with their cheapest
 * remaining contracts up to the limit. Ordering purely by cost would hide the
 * players a team has actually chosen whenever a selection sits outside their
 * four cheapest — which is the whole point of the panel.
 */
export function HomeKeeperBoard({
  contractsByOwner,
  ownerNames,
  userIdToSlug,
  players,
  adp,
  leagueId,
  maxKeepers,
}: {
  contractsByOwner: Array<[string, KeeperContract[]]>;
  ownerNames: Record<string, string>;
  userIdToSlug: Record<string, string>;
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  leagueId: string | null;
  maxKeepers: number;
}) {
  const allBaked = contractsByOwner.flatMap(([, cs]) => cs);
  const { byOwner, contracts: live, adjustments, ready } = useSelectedKeepers(
    leagueId,
    userIdToSlug,
    allBaked,
  );
  // Regroup from the adjusted set so a dropped player disappears and a pending
  // pickup appears, rather than the board showing last week's roster.
  const liveByOwner = new Map<string, KeeperContract[]>();
  for (const c of live) {
    if (!c.ownerSlug) continue;
    liveByOwner.set(c.ownerSlug, [...(liveByOwner.get(c.ownerSlug) ?? []), c]);
  }

  return (
    <div className="grid gap-px bg-ink-600 sm:grid-cols-2 xl:grid-cols-3">
      {contractsByOwner.map(([slug]) => {
        const selected = byOwner.get(slug) ?? new Set<string>();
        const eligible = (liveByOwner.get(slug) ?? []).filter((c) => !c.expired);
        const shown = orderBySelection(eligible, selected).slice(0, maxKeepers);

        return (
          <div key={slug} className="bg-ink-800 p-1">
            <div className="flex items-baseline justify-between px-3 pb-1 pt-2">
              <Link
                href={`/owners/${slug}/`}
                className="text-sm font-semibold transition-colors hover:text-accent"
              >
                {ownerNames[slug] ?? slug}
              </Link>
              <span className="text-[11px] text-chalk-600">
                {ready && selected.size
                  ? `${selected.size} of ${maxKeepers} selected`
                  : `${eligible.length} eligible`}
              </span>
            </div>
            {shown.map((c, i) => (
              <ContractRow
                key={c.playerId}
                contract={c}
                player={players[c.playerId]}
                adp={adp[c.playerId]}
                selected={selected.has(c.playerId)}
                liveNote={adjustments.get(c.playerId)}
                rank={i + 1}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
