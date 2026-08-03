import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import { EmptyState } from "@/components/ui";
import type { DraftPickRecord, PlayerMeta } from "@/lib/types";

/**
 * A draft as a grid, and as a list.
 *
 * The grid is the primary view because a draft is remembered spatially — "I had
 * the 4th pick", "they went back-to-back at the turn". Columns are draft slots
 * and rows are rounds, so one team reads top to bottom and the snake shows up as
 * pick numbers running right-to-left on even rounds.
 *
 * ONE horizontal scroll container, not a scroller per row: independently
 * scrolling rows would let the columns fall out of alignment, which destroys the
 * only thing the grid is for. Same reason the bracket is one grid.
 *
 * Slot headers link to the owner and cells link to the player, so both halves of
 * "who took whom" are navigable. The list's owner column is a plain span, so it
 * carries `data-owner` for the viewer-identity rule (see AGENTS.md); the header
 * is a profile link, which that rule already matches.
 *
 * Direction arrows are derived from the ACTUAL next pick, not from "odd rounds go
 * right". That costs nothing and stays correct for a linear draft or a
 * third-round reversal, neither of which follows the odd/even rule.
 */

interface Props {
  picks: DraftPickRecord[];
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
}

const label = (players: Record<string, PlayerMeta>, id: string) =>
  players[id]?.full_name ?? id;

export function DraftBoard({
  picks,
  rounds,
  slots,
  players,
  ownerNames,
}: Props & { rounds: number; slots: number }) {
  const bySlot = new Map<string, DraftPickRecord>();
  for (const p of picks) bySlot.set(`${p.round}:${p.draftSlot}`, p);

  // A column is a SLOT, so it is labelled by the slot's owner. Using the pick's
  // owner would name the column after whoever traded in for the first pick.
  const ownerOfSlot = new Map<number, string | null>();
  for (const p of picks) {
    if (!ownerOfSlot.has(p.draftSlot)) ownerOfSlot.set(p.draftSlot, p.slotOwnerSlug ?? p.ownerSlug);
  }

  // pickNo -> where the draft went next. "turn" is the wrap at the end of a round.
  const order = [...picks].sort((a, b) => a.pickNo - b.pickNo);
  const flow = new Map<number, "right" | "left" | "turn">();
  order.forEach((p, i) => {
    const next = order[i + 1];
    if (!next) return;
    flow.set(
      p.pickNo,
      next.round !== p.round ? "turn" : next.draftSlot > p.draftSlot ? "right" : "left",
    );
  });

  if (!picks.length) return <EmptyState>No picks recorded.</EmptyState>;

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-max gap-1 p-3 sm:p-4"
        style={{ gridTemplateColumns: `2rem repeat(${slots}, minmax(8.5rem, 1fr))` }}
      >
        <div />
        {Array.from({ length: slots }, (_, i) => i + 1).map((slot) => {
          const slug = ownerOfSlot.get(slot) ?? null;
          return (
            <div
              key={`head-${slot}`}
              className="min-w-0 border-b border-ink-600 px-1.5 pb-1.5 text-center"
            >
              <div className="eyebrow text-[10px]">{slot}</div>
              {slug ? (
                <Link
                  href={`/owners/${slug}/`}
                  className="block truncate text-[11px] font-medium text-chalk-400 transition-colors hover:text-accent"
                  title={ownerNames[slug] ?? slug}
                >
                  {ownerNames[slug] ?? slug}
                </Link>
              ) : (
                <div className="truncate text-[11px] text-chalk-600">—</div>
              )}
            </div>
          );
        })}

        {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
          <RoundRow
            key={round}
            round={round}
            slots={slots}
            bySlot={bySlot}
            players={players}
            flow={flow}
            ownerNames={ownerNames}
          />
        ))}
      </div>
    </div>
  );
}

const ARROW = { right: "→", left: "←", turn: "↓" } as const;

function RoundRow({
  round,
  slots,
  bySlot,
  players,
  flow,
  ownerNames,
}: {
  round: number;
  slots: number;
  bySlot: Map<string, DraftPickRecord>;
  players: Record<string, PlayerMeta>;
  flow: Map<number, "right" | "left" | "turn">;
  ownerNames: Record<string, string>;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-1">
        <span className="tabular text-[11px] font-semibold text-chalk-600">{round}</span>
      </div>
      {Array.from({ length: slots }, (_, i) => i + 1).map((slot) => {
        const pick = bySlot.get(`${round}:${slot}`);
        if (!pick) {
          return (
            <div
              key={`${round}-${slot}`}
              className="rounded border border-dashed border-ink-700 bg-ink-850/40"
            />
          );
        }
        const meta = players[pick.playerId];
        const arrow = flow.get(pick.pickNo);
        // Traded picks name the acquirer, matching how Sleeper's board reads.
        const acquired =
          pick.slotOwnerSlug && pick.ownerSlug && pick.ownerSlug !== pick.slotOwnerSlug
            ? pick.ownerSlug
            : null;
        return (
          <Link
            key={`${round}-${slot}`}
            href={`/players/${pick.playerId}/`}
            className={`group min-w-0 rounded border px-1.5 py-1.5 transition-colors ${
              pick.isKeeper
                ? "border-accent/40 bg-accent/10 hover:bg-accent/20"
                : "border-ink-600 bg-ink-850 hover:border-ink-500 hover:bg-ink-700/50"
            }`}
          >
            {/* Trade marker rides the top row between the position and the pick
                number, so a traded cell is exactly as tall as an untraded one and
                the grid rows stay aligned. */}
            <div className="flex items-center gap-1">
              <PositionPill position={meta?.position ?? null} />
              {acquired ? (
                <span
                  className="min-w-0 shrink truncate rounded border border-sky-400/50 bg-sky-400/10 px-1 text-[10px] font-bold leading-tight tracking-wide text-sky-300"
                  data-owner={acquired}
                  data-me-exempt
                  title={`Pick acquired by ${ownerNames[acquired] ?? acquired}`}
                >
                  → {ownerNames[acquired]?.split(" ")[0] ?? acquired}
                </span>
              ) : null}
              <span className="tabular ml-auto text-[10px] text-chalk-600">{pick.pickNo}</span>
            </div>
            <div className="mt-1 truncate text-[11px] font-medium leading-tight transition-colors group-hover:text-accent">
              {label(players, pick.playerId)}
            </div>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="min-w-0 truncate text-[10px] text-chalk-600">
                {meta?.team ?? "—"}
              </span>
              {pick.isKeeper ? (
                <span className="ml-auto shrink-0 text-[9px] font-bold tracking-wide text-accent">
                  KEPT
                </span>
              ) : null}
              {arrow ? (
                <span
                  aria-hidden
                  className={`shrink-0 text-[10px] leading-none text-chalk-600 ${pick.isKeeper ? "" : "ml-auto"}`}
                >
                  {ARROW[arrow]}
                </span>
              ) : null}
            </div>
          </Link>
        );
      })}
    </>
  );
}

export function DraftList({ picks, players, ownerNames }: Props) {
  if (!picks.length) return <EmptyState>No picks recorded.</EmptyState>;
  const ordered = [...picks].sort((a, b) => a.pickNo - b.pickNo);

  return (
    <ol className="divide-y divide-ink-700">
      {ordered.map((p) => (
        <li key={p.pickNo} className="flex items-center gap-3 px-4 py-2 sm:px-5">
          <span className="tabular w-8 shrink-0 text-right text-[11px] text-chalk-600">
            {p.pickNo}
          </span>
          <span className="tabular w-12 shrink-0 text-[11px] text-chalk-500">
            {p.round}.{String(p.draftSlot).padStart(2, "0")}
          </span>
          <PositionPill position={players[p.playerId]?.position ?? null} />
          <Link
            href={`/players/${p.playerId}/`}
            className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
          >
            {label(players, p.playerId)}
          </Link>
          {/* Badge sits OUTSIDE the truncating span, or overflow-hidden clips it. */}
          {p.isKeeper ? (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent">
              KEPT
            </span>
          ) : null}
          {/* A traded pick names both ends, so the list explains itself without
              cross-referencing the board. */}
          {p.slotOwnerSlug && p.ownerSlug && p.ownerSlug !== p.slotOwnerSlug ? (
            <span
              className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200"
              title={`Pick acquired from ${ownerNames[p.slotOwnerSlug] ?? p.slotOwnerSlug}`}
              data-me-exempt
            >
              via {ownerNames[p.slotOwnerSlug]?.split(" ")[0] ?? p.slotOwnerSlug}
            </span>
          ) : null}
          <span
            className="hidden w-36 shrink-0 truncate text-right text-xs text-chalk-500 sm:block"
            data-owner={p.ownerSlug ?? undefined}
          >
            {p.ownerSlug ? (ownerNames[p.ownerSlug] ?? p.ownerSlug) : "—"}
          </span>
        </li>
      ))}
    </ol>
  );
}
