"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Tip } from "@/components/tooltip";
import { TradeModal } from "@/components/trade-modal";
import { useLiveRosters } from "@/lib/sleeper-browser";
import type { DraftPickRecord, PlayerMeta, PlayerTransaction, Trade } from "@/lib/types";

/**
 * Player transaction history, live.
 *
 * `sync.ts` only persists a week once Sleeper has scored it, so a preseason drop
 * or trade is absent from `player-history.json` until week 1 finalises. The page
 * therefore fetches the unfinalised weeks itself and MERGES them into the same
 * list, in the same order and the same rows.
 *
 * They are not fenced off in a banner: the page's job is to show what is
 * currently true, and a reader looking for "was this player dropped" wants one
 * answer, not two lists to reconcile. A dot marks the handful of events that are
 * not yet archived, explained on hover, and disappears once the sync catches up.
 */

interface RawTxn {
  type: string;
  status: string;
  status_updated: number;
  created: number;
  leg: number;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
}

const PROBE_WEEKS = 4;

const TYPE_LABEL: Record<string, string> = {
  draft: "Draft",
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

const ACTION_RAIL: Record<string, string> = {
  draft: "bg-win/60",
  keep: "bg-accent/70",
  add: "bg-win/60",
  trade: "bg-sky-400/60",
  drop: "bg-loss/60",
};

/** Fetches the not-yet-archived weeks and shapes them like baked history. */
function usePendingTransactions({
  playerId,
  leagueId,
  season,
  fromWeek,
  userIdToSlug,
}: {
  playerId: string;
  leagueId: string | null;
  season: number;
  fromWeek: number;
  userIdToSlug: Record<string, string>;
}): { events: PlayerTransaction[]; holder: string | null; ready: boolean } {
  const rosters = useLiveRosters(leagueId);
  const [txns, setTxns] = useState<RawTxn[] | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const pages = await Promise.all(
          Array.from({ length: PROBE_WEEKS }, (_, i) => fromWeek + i).map((w) =>
            fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${w}`)
              .then((r) => (r.ok ? r.json() : []))
              .catch(() => []),
          ),
        );
        if (!cancelled) {
          setTxns(
            (pages.flat() as RawTxn[]).filter(
              (t) =>
                t?.status === "complete" &&
                (t.adds?.[playerId] != null || t.drops?.[playerId] != null),
            ),
          );
        }
      } catch {
        if (!cancelled) setTxns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, fromWeek, playerId]);

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }

  const holder =
    (rosters.data ?? []).find((r) => r.players.includes(playerId))?.ownerId != null
      ? (userIdToSlug[
          (rosters.data ?? []).find((r) => r.players.includes(playerId))!.ownerId!
        ] ?? null)
      : null;

  const events: PlayerTransaction[] = (txns ?? []).map((t) => {
    const to = t.adds?.[playerId];
    const from = t.drops?.[playerId];
    const isTrade = to != null && from != null;
    return {
      season,
      week: t.leg,
      preseason: true,
      type: (t.type as PlayerTransaction["type"]) ?? "free_agent",
      action: isTrade ? "trade" : to != null ? "add" : "drop",
      ownerSlug: (to != null ? rosterToSlug.get(to) : rosterToSlug.get(from!)) ?? null,
      fromSlug: isTrade ? (rosterToSlug.get(from!) ?? null) : null,
      toSlug: isTrade ? (rosterToSlug.get(to!) ?? null) : null,
      faabSpent: null,
      timestamp: t.status_updated || t.created,
    };
  });

  return { events, holder, ready: rosters.status === "ready" && txns != null };
}

/** The owner shown on the page — live roster first, committed data as fallback. */
export function LiveOwner({
  playerId,
  leagueId,
  userIdToSlug,
  ownerNames,
  bakedOwnerSlug,
}: {
  playerId: string;
  leagueId: string | null;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  bakedOwnerSlug: string | null;
}) {
  const rosters = useLiveRosters(leagueId);
  const ready = rosters.status === "ready";
  const holding = (rosters.data ?? []).find((r) => r.players.includes(playerId));
  const live = holding?.ownerId ? (userIdToSlug[holding.ownerId] ?? null) : null;
  // Before the fetch lands, the committed value is the best answer available.
  const slug = ready ? live : bakedOwnerSlug;

  if (!slug) {
    return <span className="text-base sm:text-lg">Free agent</span>;
  }
  return (
    <Link href={`/owners/${slug}/`} className="text-base hover:text-accent sm:text-lg">
      {ownerNames[slug] ?? slug}
    </Link>
  );
}

/** A committed-plus-pending transaction list, in one chronological order. */
export function PlayerTransactions({
  playerId,
  baked,
  leagueId,
  season,
  fromWeek,
  userIdToSlug,
  ownerNames,
  trades = {},
  players = {},
  pickOutcomes = {},
}: {
  playerId: string;
  baked: PlayerTransaction[];
  leagueId: string | null;
  season: number;
  fromWeek: number;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  /** Trades this player was in, by id, so a row can open the whole deal. */
  trades?: Record<string, Trade>;
  players?: Record<string, PlayerMeta>;
  pickOutcomes?: Record<string, DraftPickRecord>;
}) {
  const [openTrade, setOpenTrade] = useState<Trade | null>(null);
  const { events: pending } = usePendingTransactions({
    playerId,
    leagueId,
    season,
    fromWeek,
    userIdToSlug,
  });

  const pendingKeys = new Set(pending.map((e) => `${e.season}:${e.week}:${e.action}:${e.ownerSlug}`));
  // Drop any pending event the archive has already caught up on, so a synced
  // move is not listed twice with one copy marked unsynced.
  const merged = [
    ...baked,
    ...pending.filter(
      (e) => !baked.some((b) => `${b.season}:${b.week}:${b.action}:${b.ownerSlug}` === `${e.season}:${e.week}:${e.action}:${e.ownerSlug}`),
    ),
  ];
  const isPending = (t: PlayerTransaction) =>
    pendingKeys.has(`${t.season}:${t.week}:${t.action}:${t.ownerSlug}`) &&
    !baked.some((b) => `${b.season}:${b.week}:${b.action}:${b.ownerSlug}` === `${t.season}:${t.week}:${t.action}:${t.ownerSlug}`);

  // NEWEST FIRST, both between seasons and within one. What a player is doing now
  // is what people open the page for; his 2019 draft slot is history you scroll to.
  // Only the DISPLAY reverses — `player-history.json` stays chronological, because
  // the keeper resolver replays it in order and would break if the file did.
  const seasons = [...new Set(merged.map((h) => h.season))].sort((a, b) => b - a);
  const name = (slug: string | null | undefined) => (slug && ownerNames[slug]) || "—";

  if (!merged.length) {
    return (
      <div className="px-4 py-10 text-center text-sm text-chalk-600 sm:px-5">
        No recorded transactions.
      </div>
    );
  }

  return (
    <div className="divide-y divide-ink-700">
      {openTrade ? (
        <TradeModal
          trade={openTrade}
          players={players}
          ownerNames={ownerNames}
          outcomes={pickOutcomes}
          onClose={() => setOpenTrade(null)}
        />
      ) : null}
      {seasons.map((yr) => (
        <div key={yr}>
          <div className="bg-ink-850 px-4 py-1.5">
            <span className="eyebrow tabular">{yr}</span>
          </div>
          <ol>
            {merged
              .filter((h) => h.season === yr)
              .sort((a, b) => b.week - a.week || b.timestamp - a.timestamp)
              .map((h, i) => (
                <li
                  key={i}
                  className="flex items-stretch gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0"
                >
                  <span
                    className={`w-1 shrink-0 rounded-full ${ACTION_RAIL[h.action] ?? "bg-ink-500"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {h.action === "trade" ? (
                        h.tradeId && trades[h.tradeId] ? (
                          /* The whole deal is one click away. A trade row is the
                             only event where the interesting part — what came
                             back — is not on the row itself. */
                          <button
                            type="button"
                            onClick={() => setOpenTrade(trades[h.tradeId!])}
                            className="group text-left transition-colors hover:text-accent"
                          >
                            <span className="font-medium">Traded</span>{" "}
                            <span className="text-chalk-600">from</span> {name(h.fromSlug)}{" "}
                            <span className="text-chalk-600">to</span> {name(h.toSlug)}
                            <span className="ml-1.5 whitespace-nowrap text-[11px] text-chalk-600 group-hover:text-accent">
                              see deal →
                            </span>
                          </button>
                        ) : (
                          <>
                            <span className="font-medium">Traded</span>{" "}
                            <span className="text-chalk-600">from</span> {name(h.fromSlug)}{" "}
                            <span className="text-chalk-600">to</span> {name(h.toSlug)}
                          </>
                        )
                      ) : (
                        <>
                          <span className="font-medium">
                            {h.action === "draft"
                              ? `Drafted R${h.round} (pick ${h.pickNo})`
                              : h.action === "keep"
                                ? `Kept at R${h.round} (pick ${h.pickNo})`
                                : h.action === "add"
                                  ? "Added"
                                  : "Dropped"}
                          </span>{" "}
                          <span className="text-chalk-600">by</span> {name(h.ownerSlug)}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-chalk-600">
                      <span>
                        {TYPE_LABEL[h.type] ?? h.type}
                        {h.type === "draft"
                          ? ""
                          : ` · ${h.preseason ? "preseason" : `week ${h.week}`}`}
                        {h.faabSpent != null ? ` · $${h.faabSpent} FAAB` : ""}
                      </span>
                      {isPending(h) ? (
                        <Tip
                          className="text-gold"
                          text="Straight from Sleeper. This week has not been scored yet, so it is not in the committed data — it will archive automatically once it is."
                        >
                          ●
                        </Tip>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
