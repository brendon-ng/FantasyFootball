"use client";

import Link from "next/link";

import { Panel, PanelHeader } from "@/components/ui";
import { LiveStatus, useLiveRosters, useLiveTradedPicks } from "@/lib/sleeper-browser";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * A team's draft picks, with keeper assignments and rule violations.
 *
 * Live, because both inputs move: picks are traded right up to the deadline and
 * keeper selections change hourly. Sleeper's `traded_picks` only returns picks
 * that MOVED, so the full set is a baseline of rounds 1..N per roster with those
 * applied on top.
 */

const ORDINALS = [
  "", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
  "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th", "20th",
];
const ord = (n: number) => ORDINALS[n] ?? `${n}th`;

interface OwnedPick {
  round: number;
  /** Slug of the roster this pick originally belonged to. */
  fromSlug: string;
  /** True when it came from another team. */
  acquired: boolean;
}

interface Assignment {
  contract: KeeperContract;
  /** Round of the pick consumed, or null when no legal pick exists. */
  usedRound: number | null;
  /** Set when the keeper could not be placed at its own cost round. */
  bumpedFrom: number | null;
  reason: string | null;
}

/**
 * Allocates keepers to picks per bylaws 1.7.2.1.
 *
 * A keeper costs the pick in its round. Without one — or with more keepers in a
 * round than picks in it — the cost falls to the next available EARLIER round.
 * If none exists, the selection is illegal.
 *
 * Keepers are placed in ascending round order because that is most-constrained
 * first: a R1 keeper can only ever use a R1 pick, while a R12 keeper has eleven
 * fallbacks. Placing cheap keepers first would let one consume a pick an
 * expensive keeper had no alternative to.
 */
function allocate(contracts: KeeperContract[], picks: OwnedPick[]): Assignment[] {
  const pool = new Map<number, number>();
  for (const p of picks) pool.set(p.round, (pool.get(p.round) ?? 0) + 1);

  return [...contracts]
    .sort((a, b) => a.round - b.round)
    .map((contract) => {
      if (contract.expired) {
        return {
          contract,
          usedRound: null,
          bumpedFrom: null,
          reason: "Contract expired — cost is this year's ADP, not the original round",
        };
      }
      for (let r = contract.round; r >= 1; r--) {
        if ((pool.get(r) ?? 0) > 0) {
          pool.set(r, pool.get(r)! - 1);
          return {
            contract,
            usedRound: r,
            bumpedFrom: r === contract.round ? null : contract.round,
            reason: null,
          };
        }
      }
      return {
        contract,
        usedRound: null,
        bumpedFrom: null,
        reason: `No pick available in round ${contract.round} or earlier — this keeper cannot be made`,
      };
    });
}

export function DraftPicks({
  ownerSlug,
  leagueId,
  season,
  draftRounds,
  maxKeepers,
  contracts,
  players,
  userIdToSlug,
  ownerNames,
}: {
  ownerSlug: string;
  leagueId: string | null;
  season: number;
  draftRounds: number;
  maxKeepers: number;
  /** Every contract this owner holds, from the baked data. */
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
}) {
  const rosters = useLiveRosters(leagueId);
  const traded = useLiveTradedPicks(leagueId, season);
  const loading = rosters.status === "loading" || traded.status === "loading";
  const failed = rosters.status === "error" || traded.status === "error";

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }
  const myRosterId = [...rosterToSlug.entries()].find(([, s]) => s === ownerSlug)?.[0];

  // Baseline: you own each of your own rounds. Then apply every move.
  const owned: OwnedPick[] = [];
  if (myRosterId != null && rosters.status === "ready" && traded.status === "ready") {
    const movedAway = new Set(
      (traded.data ?? [])
        .filter((p) => p.rosterId === myRosterId && p.currentOwnerRosterId !== myRosterId)
        .map((p) => `${p.round}:${p.rosterId}`),
    );
    for (let r = 1; r <= draftRounds; r++) {
      if (!movedAway.has(`${r}:${myRosterId}`)) {
        owned.push({ round: r, fromSlug: ownerSlug, acquired: false });
      }
    }
    for (const p of traded.data ?? []) {
      if (p.currentOwnerRosterId !== myRosterId || p.rosterId === myRosterId) continue;
      owned.push({
        round: p.round,
        fromSlug: rosterToSlug.get(p.rosterId) ?? `roster-${p.rosterId}`,
        acquired: true,
      });
    }
    owned.sort((a, b) => a.round - b.round || Number(a.acquired) - Number(b.acquired));
  }

  const selectedIds = new Set(
    (rosters.data ?? []).find((r) => r.rosterId === myRosterId)?.keepers ?? [],
  );
  const selected = contracts.filter((c) => selectedIds.has(c.playerId));
  const assignments = allocate(selected, owned);

  // Which pick each keeper consumes, so the list can annotate it. Keyed by
  // round with a count, since a round can hold more than one pick.
  const consumedByRound = new Map<number, Assignment[]>();
  for (const a of assignments) {
    if (a.usedRound == null) continue;
    consumedByRound.set(a.usedRound, [...(consumedByRound.get(a.usedRound) ?? []), a]);
  }

  const problems: string[] = [];
  if (selected.length > maxKeepers) {
    problems.push(
      `${selected.length} keepers selected — the maximum is ${maxKeepers} (bylaws 1.7.1).`,
    );
  }
  for (const a of assignments) {
    if (a.reason) {
      problems.push(`${players[a.contract.playerId]?.full_name ?? a.contract.playerId}: ${a.reason}.`);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title={`${season} Draft Picks`}
        meta={
          rosters.status === "ready" ? `${owned.length} picks · ${selected.length} keepers` : undefined
        }
        legend="Keeper selections and pick trades both come from Sleeper and change up to the deadline."
      />

      <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2 sm:px-5">
        <span className="text-[11px] text-chalk-600">
          A keeper costs your pick in their round; without one it falls to the next earlier round
          (bylaws 1.7.2.1).
        </span>
        <LiveStatus status={loading ? "loading" : failed ? "error" : "ready"} />
      </div>

      {problems.length ? (
        <div className="border-b border-ink-700 bg-loss/[0.07] px-4 py-3 sm:px-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-loss">
            Invalid keeper selection
          </div>
          <ul className="space-y-0.5">
            {problems.map((p, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-chalk-300">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <div className="px-4 py-8 text-center text-sm text-chalk-600">Loading picks…</div>
      ) : failed || myRosterId == null ? (
        <div className="px-4 py-8 text-center text-sm text-chalk-600">
          Could not read picks from Sleeper.
        </div>
      ) : (
        <ol className="divide-y divide-ink-700">
          {owned.map((pick, i) => {
            const uses = consumedByRound.get(pick.round) ?? [];
            // Nth pick within this round gets the Nth keeper assigned to it.
            const indexInRound = owned
              .slice(0, i)
              .filter((p) => p.round === pick.round).length;
            const use = uses[indexInRound];

            return (
              <li
                key={`${pick.round}-${pick.fromSlug}-${i}`}
                className={`flex items-center gap-3 px-4 py-2 sm:px-5 ${
                  use ? "bg-accent/[0.06]" : ""
                }`}
              >
                <span className="tabular w-24 shrink-0 text-sm">
                  {season} {ord(pick.round)} Rd
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-chalk-600">
                  {pick.acquired ? `from ${ownerNames[pick.fromSlug] ?? pick.fromSlug}` : ""}
                </span>
                {use ? (
                  <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                    <span className="rounded border border-accent-dim bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                      Keeper
                    </span>
                    <Link
                      href={`/players/${use.contract.playerId}/`}
                      className="truncate text-sm font-medium transition-colors hover:text-accent"
                    >
                      {players[use.contract.playerId]?.full_name ?? use.contract.playerId}
                    </Link>
                    {use.bumpedFrom ? (
                      <span
                        className="text-[10px] text-gold"
                        title={`Cost round is ${use.bumpedFrom}, but that pick was unavailable, so it falls to this earlier pick (bylaws 1.7.2.1.1)`}
                      >
                        ↑R{use.bumpedFrom}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
