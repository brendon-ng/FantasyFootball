"use client";

import Link from "next/link";

import { KeepPips, PositionPill, ValueBadge } from "@/components/keeper-table";
import { costRound } from "@/lib/draft-slots";
import { Tip } from "@/components/tooltip";
import { useLiveContracts } from "@/lib/keeper-live";
import { useLiveRosters } from "@/lib/sleeper-browser";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * Live keeper selections, keyed by owner slug.
 *
 * Which players a team has locked in changes hour to hour before the deadline,
 * so it is read from Sleeper in the browser rather than baked. Contract values
 * beside it are build-time data and never move.
 */
export function useSelectedKeepers(
  leagueId: string | null,
  userIdToSlug: Record<string, string>,
  /** Baked contracts to reconcile against live rosters and pending moves. */
  contracts: KeeperContract[] = [],
  /** First week not yet baked into the derived data. */
  fromWeek = 1,
): {
  byOwner: Map<string, Set<string>>;
  /** Contracts with pending preseason and in-week moves applied. */
  contracts: KeeperContract[];
  adjustments: Map<string, string>;
  ready: boolean;
} {
  const live = useLiveRosters(leagueId);

  const byOwner = new Map<string, Set<string>>();
  const rosterToOwner = new Map<number, string>();
  const liveRosterPlayers = new Map<string, Set<string>>();
  for (const r of live.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (!slug) continue;
    byOwner.set(slug, new Set(r.keepers));
    rosterToOwner.set(r.rosterId, slug);
    liveRosterPlayers.set(slug, new Set(r.players));
  }

  const adjusted = useLiveContracts({
    leagueId,
    fromWeek,
    contracts,
    rosterToOwner,
    liveRosterPlayers,
    rostersReady: live.status === "ready",
  });

  return {
    byOwner,
    contracts: adjusted.contracts,
    adjustments: new Map(adjusted.adjustments.map((a) => [a.playerId, a.note])),
    ready: live.status === "ready" && adjusted.ready,
  };
}

/**
 * Orders a team's contracts for display: locked-in keepers first, then the rest
 * in cost order.
 *
 * A summary that shows the four cheapest contracts is the wrong four once a team
 * has actually chosen — it can omit the players they are really keeping.
 * Selections lead, and the remainder backfills only up to the limit.
 */
export function orderBySelection(
  contracts: KeeperContract[],
  selected: Set<string>,
): KeeperContract[] {
  const byCost = (a: KeeperContract, b: KeeperContract) =>
    Number(a.expired) - Number(b.expired) || a.round - b.round;
  return [
    ...contracts.filter((c) => selected.has(c.playerId)).sort(byCost),
    ...contracts.filter((c) => !selected.has(c.playerId)).sort(byCost),
  ];
}

/** Shared row: position, name, optional Kept badge, ADP value, pips, cost. */
export function ContractRow({
  contract,
  player,
  adp,
  draftRounds,
  selected,
  rank,
  liveNote,
}: {
  contract: KeeperContract;
  player: PlayerMeta | undefined;
  adp: AdpEntry | undefined;
  draftRounds: number;
  selected: boolean;
  rank?: number;
  /** Set when a pending move changed this contract since the last sync. */
  liveNote?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 ${
        selected ? "bg-accent/[0.07]" : contract.expired ? "opacity-50" : ""
      }`}
    >
      {/* A rail marks a selection without reflowing the columns. */}
      <span
        aria-hidden
        className={`-ml-1 h-6 w-[3px] shrink-0 rounded-full ${
          selected ? "bg-accent" : "bg-transparent"
        }`}
      />
      {rank !== undefined ? (
        <span className="tabular w-4 shrink-0 text-[11px] text-chalk-600">{rank}</span>
      ) : null}
      <PositionPill position={player?.position ?? null} />
      <Link
        href={`/players/${contract.playerId}/`}
        className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
      >
        {player?.full_name ?? contract.playerId}
        {player?.team ? (
          <span className="ml-1.5 text-[11px] font-normal text-chalk-600">{player.team}</span>
        ) : null}
      </Link>
      {selected ? (
        <span
          className="shrink-0 rounded border border-accent-dim bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-normal tracking-wide text-accent"
          title="Locked in as a keeper on Sleeper"
        >
          Kept
        </span>
      ) : null}
      {/* A dot, not a banner: the row already shows the true current value, so
          this only says where that value came from. */}
      {liveNote ? (
        <Tip
          className="shrink-0 text-[10px] leading-none text-gold"
          text={`${liveNote}. Straight from Sleeper — this week has not been scored yet, so it is not in the committed data. It will archive automatically once it is.`}
        >
          ●
        </Tip>
      ) : null}
      <span className="hidden sm:block">
        <ValueBadge costRound={costRound(contract, adp, draftRounds)} adp={adp} compact />
      </span>
      <KeepPips used={contract.keepsUsed} total={contract.keepsUsed + contract.keepsRemaining} />
      <span
        className={`tabular w-9 shrink-0 text-right text-sm font-bold ${
          contract.expired ? "text-loss" : "text-accent"
        }`}
      >
        R{costRound(contract, adp, draftRounds)}
      </span>
    </div>
  );
}
