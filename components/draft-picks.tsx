"use client";

import Link from "next/link";
import { type LeagueRef } from "@/lib/league-ref";

import { Panel, PanelHeader } from "@/components/ui";
import {
  LiveStatus,
  useLiveDraft,
  useLiveRosters,
  useLiveTradedPicks,
} from "@/lib/live";
import { assignKeeperSlots, buildBoard, costRound, type DraftShape } from "@/lib/draft-slots";
import type { AdpEntry } from "@/lib/data";
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
  /** Draft slot, once the order has been drawn. Null before that. */
  slot: number | null;
  /** Position within the round, once known — the "10" in "3.10". */
  inRound: number | null;
}

interface Assignment {
  contract: KeeperContract;
  /** Round of the pick consumed, or null when no legal pick exists. */
  usedRound: number | null;
  /** Slot consumed, when the order is known. */
  usedSlot?: number | null;
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
 *
 * ROUND-ONLY FALLBACK. Bylaws 1.7.2.2.2 says a keeper takes the LOWER of two
 * picks in the same round (3.10 rather than 3.05), which needs an order that does
 * not exist until after the keeper deadline — Appendix A's whole point. When the
 * order IS drawn this defers to `assignKeeperSlots` in lib/draft-slots.ts, which
 * applies the rule properly and is shared with the projected board; a season with
 * no order yet still lands here.
 */
function allocate(
  contracts: KeeperContract[],
  picks: OwnedPick[],
  /** Effective cost, so an expired contract is placed at its ADP round. */
  cost: (c: KeeperContract) => number,
): Assignment[] {
  const pool = new Map<number, number>();
  for (const p of picks) pool.set(p.round, (pool.get(p.round) ?? 0) + 1);

  return [...contracts]
    .sort((a, b) => cost(a) - cost(b))
    .map((contract) => {
      for (let r = cost(contract); r >= 1; r--) {
        if ((pool.get(r) ?? 0) > 0) {
          pool.set(r, pool.get(r)! - 1);
          return {
            contract,
            usedRound: r,
            bumpedFrom: r === cost(contract) ? null : cost(contract),
            reason: null,
          };
        }
      }
      return {
        contract,
        usedRound: null,
        bumpedFrom: null,
        reason: `No pick available in round ${cost(contract)} or earlier — this keeper cannot be made`,
      };
    });
}

export function DraftPicks({
  ownerSlug,
  leagueRef,
  season,
  draftRounds,
  adp,
  maxKeepers,
  contracts,
  players,
  userIdToSlug,
  ownerNames,
}: {
  ownerSlug: string;
  leagueRef: LeagueRef | null;
  season: number;
  draftRounds: number;
  adp: Record<string, AdpEntry>;
  maxKeepers: number;
  /** Every contract this owner holds, from the baked data. */
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
}) {
  const cost = (c: KeeperContract) => costRound(c, adp[c.playerId], draftRounds);
  const rosters = useLiveRosters(leagueRef);
  const traded = useLiveTradedPicks(leagueRef);
  const draft = useLiveDraft(leagueRef);
  const loading = rosters.status === "loading" || traded.status === "loading";
  const failed = rosters.status === "error" || traded.status === "error";

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }
  const myRosterId = [...rosterToSlug.entries()].find(([, s]) => s === ownerSlug)?.[0];

  /**
   * Picks this owner holds in a given season.
   *
   * Baseline is rounds 1..N of your own; Sleeper only reports picks that MOVED,
   * so those are layered over the top.
   */
  const picksFor = (yr: number): OwnedPick[] => {
    if (myRosterId == null || rosters.status !== "ready" || traded.status !== "ready") return [];
    const inYear = (traded.data ?? []).filter((p) => Number(p.season) === yr);
    const movedAway = new Set(
      inYear
        .filter((p) => p.rosterId === myRosterId && p.currentOwnerRosterId !== myRosterId)
        .map((p) => p.round),
    );
    const out: OwnedPick[] = [];
    for (let r = 1; r <= draftRounds; r++) {
      if (!movedAway.has(r)) {
        out.push({ round: r, fromSlug: ownerSlug, acquired: false, slot: null, inRound: null });
      }
    }
    for (const p of inYear) {
      if (p.currentOwnerRosterId !== myRosterId || p.rosterId === myRosterId) continue;
      out.push({
        round: p.round,
        fromSlug: rosterToSlug.get(p.rosterId) ?? `roster-${p.rosterId}`,
        acquired: true,
        slot: null,
        inRound: null,
      });
    }
    return out.sort((a, b) => a.round - b.round || Number(a.acquired) - Number(b.acquired));
  };

  // The upcoming draft, plus any later season whose picks have started moving.
  // A season nobody has traded into is every team holding its own full slate,
  // which Sleeper cannot distinguish from a season that does not exist.
  const seasons = [
    ...new Set([
      season,
      ...(traded.data ?? []).map((p) => Number(p.season)).filter((y) => y > season),
    ]),
  ].sort((a, b) => a - b);

  // Once the order is drawn the upcoming season's picks carry real slots, and
  // the keeper assignment defers to the shared rule. Later seasons never will —
  // Sleeper has no draft for them yet — so they keep the round-only view.
  const shape: DraftShape | null =
    draft.data?.orderSet && draft.data.rounds > 0
      ? {
          rounds: draft.data.rounds,
          teams: draft.data.teams,
          type: draft.data.type,
          slotToRoster: draft.data.slotToRoster,
          reversalRound: draft.data.reversalRound,
        }
      : null;

  const picksWithSlots = (yr: number): OwnedPick[] => {
    if (!shape || yr !== season || myRosterId == null) return picksFor(yr);
    return buildBoard(shape, traded.data ?? [])
      .filter((p) => p.ownerRoster === myRosterId)
      .map((p) => ({
        round: p.round,
        fromSlug: rosterToSlug.get(p.fromRoster) ?? `roster-${p.fromRoster}`,
        acquired: p.traded,
        slot: p.slot,
        inRound: p.inRound,
      }));
  };

  const owned = picksWithSlots(season);
  const mockedOrder = Boolean(draft.data?.mocked);
  const selectedIds = new Set(
    (rosters.data ?? []).find((r) => r.rosterId === myRosterId)?.keepers ?? [],
  );
  // Keepers only consume picks in the draft they are being kept for.
  const selected = contracts.filter((c) => selectedIds.has(c.playerId));
  // Same rule either way; only the precision differs.
  const assignments: Assignment[] = shape
    ? assignKeeperSlots(
        selected.map((c) => ({ playerId: c.playerId, round: cost(c) })),
        buildBoard(shape, traded.data ?? []).filter((p) => p.ownerRoster === myRosterId),
      ).map((a) => ({
        contract: selected.find((c) => c.playerId === a.playerId)!,
        usedRound: a.pick?.round ?? null,
        usedSlot: a.pick?.slot ?? null,
        bumpedFrom: a.bumpedFrom,
        reason: a.reason,
      }))
    : allocate(selected, owned, cost);

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
        title="Draft Picks"
        meta={
          rosters.status === "ready"
            ? `${seasons.length} draft${seasons.length === 1 ? "" : "s"} · ${selected.length} keepers selected`
            : undefined
        }
        legend="Keeper selections and pick trades both come from Sleeper and change up to the deadline."
      />

      <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-2 sm:px-5">
        <span className="text-[11px] text-chalk-600">
          A keeper costs your pick in their round; without one it falls to the next earlier round
          (bylaws 1.7.2.1).
        </span>
        <span className="flex items-center gap-2">
          {/* Slots come from a stand-in order under ?mockDraftOrder=true, so the
              "7.10" labels below are illustrative rather than real. */}
          {mockedOrder ? (
            <span
              className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold"
              title="?mockDraftOrder=true — slots come from a stand-in order, not from Sleeper."
            >
              Mock order
            </span>
          ) : null}
          <LiveStatus
            status={loading ? "loading" : failed ? "error" : "ready"}
            provider={leagueRef?.provider}
          />
        </span>
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
        <div className="divide-y divide-ink-700">
          {seasons.map((yr) => {
            const yearPicks = yr === season ? owned : picksFor(yr);
            const isNext = yr === season;
            return (
              <details key={yr} open={isNext} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40 sm:px-5">
                  <span className="tabular text-sm font-semibold">{yr} Draft</span>
                  <span className="text-[11px] text-chalk-600">
                    {yearPicks.length} pick{yearPicks.length === 1 ? "" : "s"}
                    {isNext && selected.length
                      ? ` · ${assignments.filter((a) => a.usedRound != null).length} to keepers`
                      : ""}
                  </span>
                  <span className="ml-auto text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                </summary>
                <ol className="divide-y divide-ink-700 border-t border-ink-700">
                  {yearPicks.map((pick, i) => {
                    // Keeper annotations belong only to the draft they apply to.
                    const uses = isNext ? (consumedByRound.get(pick.round) ?? []) : [];
                    const indexInRound = yearPicks
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
                          {yr}{" "}
                          {pick.inRound != null
                            ? `${pick.round}.${String(pick.inRound).padStart(2, "0")}`
                            : `${ord(pick.round)} Rd`}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-chalk-600">
                          {pick.acquired
                            ? `from ${ownerNames[pick.fromSlug] ?? pick.fromSlug}`
                            : ""}
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
              </details>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
