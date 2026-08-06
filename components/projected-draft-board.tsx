"use client";

import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import { EmptyState } from "@/components/ui";
import {
  assignKeeperSlots,
  costRound,
  buildBoard,
  pickLabel,
  type BoardPick,
  type DraftShape,
} from "@/lib/draft-slots";
import { LiveStatus, useLiveDraft, useLiveRosters, useLiveTradedPicks } from "@/lib/sleeper-browser";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The draft as it currently projects: who owns each pick, and which keepers land
 * where.
 *
 * ENTIRELY LIVE. Every input moves right up to the draft — the order is drawn
 * after the keeper deadline, picks trade until the last minute, and keeper
 * selections change hourly. None of it is committed until the draft completes, at
 * which point `derive` writes the real board to `drafts.json` and
 * `/history/<season>/draft/` renders that instead.
 *
 * A keeper occupies a pick, so that pick is GONE for drafting. Showing the board
 * without them would overstate what a team can still do with its picks, which is
 * the whole question this page exists to answer.
 */

export function ProjectedDraftBoard({
  leagueId,
  season,
  contracts,
  players,
  userIdToSlug,
  ownerNames,
  maxKeepers,
  adp,
  draftRounds,
}: {
  leagueId: string | null;
  season: number;
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  maxKeepers: number;
  adp: Record<string, AdpEntry>;
  /** Last round of the draft — the floor an expired contract is revalued to. */
  draftRounds: number;
}) {
  const draft = useLiveDraft(leagueId);
  const traded = useLiveTradedPicks(leagueId);
  const rosters = useLiveRosters(leagueId);

  const loading =
    draft.status === "loading" || traded.status === "loading" || rosters.status === "loading";
  if (loading) {
    return <EmptyState>Loading the draft…</EmptyState>;
  }
  if (draft.status === "error" || !draft.data) {
    return <EmptyState>Sleeper did not return a draft for {season}.</EmptyState>;
  }

  const d = draft.data;

  // Once the draft has run this board is a projection of the past. The real one
  // is derived from the committed picks — `sync` writes them the moment the draft
  // completes, and derive records them without waiting for the season to end.
  if (d.status === "complete") {
    return (
      <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
        <p className="flex items-center justify-center gap-2">
          {d.mocked ? (
            <span
              className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold"
              title="?mockDraft=true — the draft has not actually run."
            >
              Mock
            </span>
          ) : null}
          The {season} draft is done.
        </p>
        <p className="mt-2 text-[11px]">
          <Link href={`/history/${season}/draft/`} className="hover:text-accent">
            See the board as it happened →
          </Link>
          {d.mocked ? (
            <span className="ml-2 text-chalk-600">
              (that page exists once the real picks are committed)
            </span>
          ) : null}
        </p>
      </div>
    );
  }

  // The order is what makes a board possible. Before it is drawn Sleeper still
  // reports a slot map, but it is the identity placeholder — rendering it would
  // claim a running order nobody has drawn.
  if (!d.orderSet) {
    return (
      <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
        <p>The draft order has not been drawn yet.</p>
        <p className="mt-1 text-[11px]">
          Bylaws set it after the keeper deadline. This board fills in as soon as
          Sleeper has it — nothing here needs a redeploy.
        </p>
      </div>
    );
  }

  const shape: DraftShape = {
    rounds: d.rounds,
    teams: d.teams,
    type: d.type,
    slotToRoster: d.slotToRoster,
    reversalRound: d.reversalRound,
  };

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }

  const board = buildBoard(shape, traded.data ?? []);

  // Keepers each team has actually locked in on Sleeper, not every eligible
  // contract — the board should show what is really happening.
  const selectedByRoster = new Map<number, string[]>();
  for (const r of rosters.data ?? []) selectedByRoster.set(r.rosterId, r.keepers ?? []);

  const byId = new Map(contracts.map((c) => [c.playerId, c]));
  const keeperAt = new Map<string, { playerId: string; ownerSlug: string | null }>();
  for (const [rosterId, playerIds] of selectedByRoster) {
    const owned = board.filter((p) => p.ownerRoster === rosterId);
    const picked = playerIds
      .map((id) => byId.get(id))
      .filter((c): c is KeeperContract => Boolean(c))
      .slice(0, maxKeepers)
      // Cost, not the stored round: an expired contract is revalued to ADP and
      // consumes the pick that costs, rather than being left off the board.
      .map((c) => ({ playerId: c.playerId, round: costRound(c, adp[c.playerId], draftRounds) }));
    for (const a of assignKeeperSlots(picked, owned)) {
      if (a.pick) {
        keeperAt.set(`${a.pick.round}:${a.pick.slot}`, {
          playerId: a.playerId,
          ownerSlug: rosterToSlug.get(rosterId) ?? null,
        });
      }
    }
  }

  const slots = Object.keys(shape.slotToRoster)
    .map(Number)
    .sort((a, b) => a - b);
  const totalKept = keeperAt.size;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1 pt-3 text-[11px] text-chalk-600 sm:px-5">
        <span className="flex flex-wrap items-center gap-2">
          {/* A mocked order renders exactly like a real one, so it says so loudly
              — this is the sort of thing that gets screenshotted and believed. */}
          {d.mocked ? (
            <span
              className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold"
              title="?mockDraftOrder=true — a stand-in order, seeded from the draft id. Sleeper has not drawn one."
            >
              Mock order
            </span>
          ) : null}
          <span>
            {shape.rounds} rounds · {shape.teams} teams · {totalKept} keeper
            {totalKept === 1 ? "" : "s"} placed
          </span>
        </span>
        <LiveStatus status={draft.status} />
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-1 p-3 sm:p-4"
          style={{ gridTemplateColumns: `2rem repeat(${slots.length}, minmax(8.5rem, 1fr))` }}
        >
          <div />
          {slots.map((slot) => {
            const slug = rosterToSlug.get(shape.slotToRoster[slot]) ?? null;
            return (
              <div key={`h${slot}`} className="min-w-0 border-b border-ink-600 px-1.5 pb-1.5 text-center">
                <div className="eyebrow text-[10px]">{slot}</div>
                {slug ? (
                  <Link
                    href={`/owners/${slug}/`}
                    className="block truncate text-[11px] font-medium text-chalk-400 transition-colors hover:text-accent"
                  >
                    {ownerNames[slug] ?? slug}
                  </Link>
                ) : (
                  <div className="truncate text-[11px] text-chalk-600">—</div>
                )}
              </div>
            );
          })}

          {Array.from({ length: shape.rounds }, (_, i) => i + 1).map((round) => (
            <Row
              key={round}
              round={round}
              slots={slots}
              shape={shape}
              board={board}
              rosterToSlug={rosterToSlug}
              ownerNames={ownerNames}
              players={players}
              keeperAt={keeperAt}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  round,
  slots,
  shape,
  board,
  rosterToSlug,
  ownerNames,
  players,
  keeperAt,
}: {
  round: number;
  slots: number[];
  shape: DraftShape;
  board: BoardPick[];
  rosterToSlug: Map<number, string>;
  ownerNames: Record<string, string>;
  players: Record<string, PlayerMeta>;
  keeperAt: Map<string, { playerId: string; ownerSlug: string | null }>;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-1">
        <span className="tabular text-[11px] font-semibold text-chalk-600">{round}</span>
      </div>
      {slots.map((slot) => {
        const pick = board.find((p) => p.round === round && p.slot === slot);
        if (!pick) return <div key={slot} className="rounded border border-dashed border-ink-700" />;
        const kept = keeperAt.get(`${round}:${slot}`);
        const meta = kept ? players[kept.playerId] : undefined;
        const ownerSlug = rosterToSlug.get(pick.ownerRoster) ?? null;
        return (
          <div
            key={slot}
            className={`min-w-0 rounded border px-1.5 py-1.5 ${
              kept
                ? "border-accent/40 bg-accent/10"
                : "border-ink-600 bg-ink-850"
            }`}
          >
            <div className="flex items-center gap-1">
              {kept ? <PositionPill position={meta?.position ?? null} /> : null}
              {/* Traded picks name the acquirer, matching the completed board. */}
              {pick.traded ? (
                <span
                  className="min-w-0 shrink truncate rounded border border-sky-400/50 bg-sky-400/10 px-1 text-[10px] font-bold tracking-wide text-sky-300"
                  data-owner={ownerSlug ?? undefined}
                  data-me-exempt
                  title={`Acquired by ${ownerSlug ? (ownerNames[ownerSlug] ?? ownerSlug) : "—"}`}
                >
                  → {ownerSlug ? (ownerNames[ownerSlug] ?? ownerSlug).split(" ")[0] : "—"}
                </span>
              ) : null}
              <span className="tabular ml-auto text-[10px] text-chalk-600">
                {pickLabel(round, slot, shape)}
              </span>
            </div>
            {kept ? (
              <Link
                href={`/players/${kept.playerId}/`}
                className="mt-1 block truncate text-[11px] font-medium leading-tight transition-colors hover:text-accent"
              >
                {meta?.full_name ?? kept.playerId}
              </Link>
            ) : (
              <div className="mt-1 truncate text-[11px] leading-tight text-chalk-600">—</div>
            )}
            <div className="mt-0.5 flex items-center gap-1">
              <span className="min-w-0 truncate text-[10px] text-chalk-600">
                {kept ? (meta?.team ?? "") : ""}
              </span>
              {kept ? (
                <span className="ml-auto shrink-0 text-[9px] font-bold tracking-wide text-accent">
                  KEPT
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
