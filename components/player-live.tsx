"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useLiveRosters } from "@/lib/sleeper-browser";

/**
 * Transactions Sleeper knows about but the committed data does not yet.
 *
 * `sync.ts` only persists a week once Sleeper has scored it, so a preseason drop
 * or trade is absent from `player-history.json` until week 1 finalises. On a
 * player page that reads as "nothing happened", which is worse than a gap — it
 * is a confident wrong answer about who owns them.
 *
 * Rendered as a separate, clearly-labelled block rather than merged into the
 * baked list, so provisional events are never mistaken for archived history.
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
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

export function PlayerLiveActivity({
  playerId,
  leagueId,
  season,
  fromWeek,
  userIdToSlug,
  ownerNames,
  bakedOwnerSlug,
}: {
  playerId: string;
  leagueId: string | null;
  season: number;
  /** First week not yet baked into the derived data. */
  fromWeek: number;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  /** Owner according to the committed data, for comparison. */
  bakedOwnerSlug: string | null;
}) {
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
  const holder = (() => {
    for (const r of rosters.data ?? []) {
      const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
      if (!slug) continue;
      rosterToSlug.set(r.rosterId, slug);
    }
    for (const r of rosters.data ?? []) {
      if (r.players.includes(playerId)) {
        return r.ownerId ? (userIdToSlug[r.ownerId] ?? null) : null;
      }
    }
    return null;
  })();

  const ready = rosters.status === "ready" && txns != null;
  const ownerChanged = ready && holder !== bakedOwnerSlug;
  const events = txns ?? [];

  if (!ready || (!events.length && !ownerChanged)) return null;

  const name = (slug: string | null) => (slug && ownerNames[slug]) || "nobody";

  return (
    <div className="rounded-xl border border-gold/35 bg-gold/[0.06] px-4 py-3 sm:px-5">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-gold">
          Since the last sync
        </span>
        <span className="text-[11px] text-chalk-600">
          live from Sleeper · not yet in the committed history below
        </span>
      </div>

      {ownerChanged ? (
        <p className="mb-1.5 text-[13px] text-chalk-300">
          Now held by{" "}
          {holder ? (
            <Link href={`/owners/${holder}/`} className="font-semibold text-gold hover:underline">
              {name(holder)}
            </Link>
          ) : (
            <span className="font-semibold text-gold">nobody — free agent</span>
          )}
          <span className="text-chalk-600"> (committed data says {name(bakedOwnerSlug)})</span>
        </p>
      ) : null}

      <ul className="space-y-0.5">
        {events
          .slice()
          .sort((a, b) => (a.status_updated || a.created) - (b.status_updated || b.created))
          .map((t, i) => {
            const addedTo = t.adds?.[playerId];
            const droppedFrom = t.drops?.[playerId];
            return (
              <li key={i} className="text-[13px] text-chalk-300">
                <span className="font-medium">
                  {addedTo != null && droppedFrom != null
                    ? `Traded to ${name(rosterToSlug.get(addedTo) ?? null)}`
                    : addedTo != null
                      ? `Added by ${name(rosterToSlug.get(addedTo) ?? null)}`
                      : `Dropped by ${name(rosterToSlug.get(droppedFrom!) ?? null)}`}
                </span>
                <span className="ml-2 text-[11px] text-chalk-600">
                  {TYPE_LABEL[t.type] ?? t.type} · {season} preseason or week {t.leg}
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
