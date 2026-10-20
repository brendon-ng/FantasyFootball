"use client";

import Link from "next/link";
import { useState } from "react";

import { Sheet } from "@/components/sheet";
import type { Lineup, LineupSlot } from "@/lib/lineup";
import { winChance } from "@/lib/trade-sim";
import type { LiveTeam } from "@/lib/types";

export interface WeekDetail {
  week: number;
  playoff: boolean;
  team: LiveTeam;
  opponent: LiveTeam | null;
  before: Lineup;
  after: Lineup;
  oppBefore: number | null;
  oppAfter: number | null;
  /** Players this team receives in the trade, marked in the after column. */
  incoming: Set<string>;
  /** Players this team gives up, marked in the before column. */
  outgoing: Set<string>;
  /** Everyone rostered but not starting, best projection first. */
  benchBefore: Array<{ id: string; points: number }>;
  benchAfter: Array<{ id: string; points: number }>;
  /** Players whose projection this week is the reader's override, not Sleeper's. */
  overridden: Set<string>;
  /** Players whose NFL team is idle this week — this team's and the opponent's. */
  onBye: Set<string>;
  /** The opponent's lineup AFTER the trade, shown on request. Null in the playoffs. */
  oppLineup: {
    lineup: Lineup;
    bench: Array<{ id: string; points: number }>;
    /** What the opponent receives, when it is the other side of the trade. */
    incoming: Set<string>;
  } | null;
}

/**
 * One team's week, before and after the trade, slot by slot.
 *
 * A ROW IS MARKED ONLY WHEN THE PLAYER IS NEW, not whenever the slot changed
 * hands. The optimiser is free to shuffle the same eleven people between the
 * flex and the fixed slots, and highlighting every such shuffle would bury the
 * one row that actually says what the trade did.
 */
export function TradeWeekSheet({
  detail,
  label,
  nameOf,
  positionOf,
  canLink,
  onClose,
}: {
  detail: WeekDetail;
  label: (t: LiveTeam | null | undefined) => string;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
  onClose: () => void;
}) {
  const {
    week,
    playoff,
    team,
    opponent,
    before,
    after,
    oppBefore,
    oppAfter,
    incoming,
    outgoing,
    benchBefore,
    benchAfter,
    overridden,
    onBye,
    oppLineup,
  } = detail;
  /**
   * COLLAPSED BY DEFAULT. The sheet is about this team's week; the opponent's
   * side is context someone asks for, and opening with two full lineups would
   * push the one that changed below the fold on a phone.
   */
  const [showOpp, setShowOpp] = useState(false);
  const winBefore = oppBefore != null ? winChance(before.total, oppBefore) : null;
  const winAfter = oppAfter != null ? winChance(after.total, oppAfter) : null;

  return (
    <Sheet
      label={`Week ${week} lineups`}
      onClose={onClose}
      panelClassName="max-h-[85dvh] max-w-[44rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-800 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="eyebrow text-[10px]">
                Week {week}
                {playoff ? " · Playoffs" : ""}
              </div>
              <div className="truncate text-sm font-semibold">
                <span data-owner={team.ownerSlug}>{label(team)}</span>
                {opponent ? (
                  <span className="font-normal text-chalk-500">
                    {" "}
                    vs <span data-owner={opponent.ownerSlug}>{label(opponent)}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close"
              className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-ink-600 bg-ink-600 sm:grid-cols-4">
            <Figure label="Projected">
              {before.total.toFixed(1)} → {after.total.toFixed(1)}
              <div className="mt-0.5 text-[12px]">
                <Delta n={after.total - before.total} />
              </div>
            </Figure>
            <Figure label="Opponent">
              {oppBefore != null && oppAfter != null ? (
                <>
                  {oppBefore.toFixed(1)} → {oppAfter.toFixed(1)}
                </>
              ) : (
                "—"
              )}
            </Figure>
            <Figure label="Margin">
              {oppBefore != null && oppAfter != null ? (
                <>
                  {signed(before.total - oppBefore)} → {signed(after.total - oppAfter)}
                </>
              ) : (
                "—"
              )}
            </Figure>
            <Figure label="Win chance">
              {winBefore != null && winAfter != null ? (
                <>
                  {pct(winBefore)} → {pct(winAfter)}
                  <div className="mt-0.5 text-[12px]">
                    <Delta n={(winAfter - winBefore) * 100} />
                    <span className="text-chalk-600"> pts</span>
                  </div>
                </>
              ) : (
                "—"
              )}
            </Figure>
          </div>

          <div className="pb-6 sm:pb-1">
            <LineupCompare
              before={before}
              after={after}
              benchBefore={benchBefore}
              benchAfter={benchAfter}
              incoming={incoming}
              outgoing={outgoing}
              overridden={overridden}
              onBye={onBye}
              nameOf={nameOf}
              positionOf={positionOf}
              canLink={canLink}
            />
            {oppLineup && opponent ? (
              <div className="mt-3 border-t border-ink-600">
                <button
                  type="button"
                  onClick={() => setShowOpp((v) => !v)}
                  aria-expanded={showOpp}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] text-chalk-400 transition-colors hover:bg-ink-700 hover:text-chalk-200 sm:px-5"
                >
                  <span>
                    {showOpp ? "Hide" : "Show"}{" "}
                    <span data-owner={opponent.ownerSlug}>{label(opponent)}</span>&rsquo;s lineup
                    <span className="text-chalk-600"> · after the trade</span>
                  </span>
                  <span className="tabular text-chalk-500">
                    {oppLineup.lineup.total.toFixed(1)} <span aria-hidden>{showOpp ? "▴" : "▾"}</span>
                  </span>
                </button>
                {showOpp ? (
                  <LineupSingle
                    lineup={oppLineup.lineup}
                    bench={oppLineup.bench}
                    incoming={oppLineup.incoming}
                    overridden={overridden}
                    onBye={onBye}
                    nameOf={nameOf}
                    positionOf={positionOf}
                    canLink={canLink}
                  />
                ) : null}
              </div>
            ) : null}
            <LineupLegend />
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Two lineups and their benches side by side, before and after the trade.
 *
 * ONE RENDERER FOR BOTH VIEWS — a single week in the sheet and the average
 * lineup on the page — so the two cannot drift on what a marker means.
 *
 * A ROW IS MARKED ONLY WHEN THE PLAYER IS NEW, not whenever the slot changed
 * hands: the optimiser shuffles the same people between flex and fixed slots,
 * and highlighting every shuffle would bury the row that says what changed.
 */
export function LineupCompare({
  before,
  after,
  benchBefore,
  benchAfter,
  incoming,
  outgoing,
  overridden,
  onBye,
  nameOf,
  positionOf,
  canLink,
}: {
  before: Lineup;
  after: Lineup;
  benchBefore: Array<{ id: string; points: number }>;
  benchAfter: Array<{ id: string; points: number }>;
  incoming: Set<string>;
  outgoing: Set<string>;
  overridden: Set<string>;
  onBye: Set<string>;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
}) {
  const benchRows = Math.max(benchBefore.length, benchAfter.length);
  const asSlot = (p: { id: string; points: number } | undefined): LineupSlot | undefined =>
    p ? { slot: "BN", id: p.id, points: p.points, freeAgent: false } : undefined;
  const beforeIds = new Set(before.slots.map((s) => s.id).filter(Boolean));
  const afterIds = new Set(after.slots.map((s) => s.id).filter(Boolean));
  return (
    <>
      <div className="flex items-center gap-2 border-b border-ink-600 bg-ink-850/60 px-4 py-1.5 sm:px-5">
        <span className="eyebrow w-14 shrink-0 text-[10px]">Slot</span>
        <span className="eyebrow min-w-0 flex-1 text-[10px]">Before</span>
        <span className="eyebrow min-w-0 flex-1 text-[10px]">After</span>
      </div>
      <ul className="divide-y divide-ink-700">
        {after.slots.map((a, i) => {
          const b = before.slots[i];
          return (
            <li key={i} className="flex items-center gap-2 px-4 py-1.5 text-[13px] sm:px-5">
              <span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
                {slotLabel(a.slot)}
              </span>
              <Cell
                slot={b}
                faded={Boolean(b?.id && !afterIds.has(b.id))}
                out={Boolean(b?.id && outgoing.has(b.id))}
                nameOf={nameOf}
                positionOf={positionOf}
                canLink={canLink}
                overridden={overridden}
                onBye={onBye}
              />
              <Cell
                slot={a}
                fresh={Boolean(a.id && !beforeIds.has(a.id))}
                traded={Boolean(a.id && incoming.has(a.id))}
                nameOf={nameOf}
                positionOf={positionOf}
                canLink={canLink}
                overridden={overridden}
                onBye={onBye}
              />
            </li>
          );
        })}
        <li className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold sm:px-5">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-chalk-500">Total</span>
          <span className="min-w-0 flex-1 text-right tabular text-chalk-400">{before.total.toFixed(2)}</span>
          <span className="min-w-0 flex-1 text-right tabular text-chalk-100">{after.total.toFixed(2)}</span>
        </li>
      </ul>
      {/* THE BENCH, so a row that left the lineup can be found again — and
          so it is visible who the trade pushed out of a start rather than
          off the roster. Paired by rank, not by player: the two benches are
          different lists of people. */}
      {benchRows ? (
        <>
          <div className="flex items-center gap-2 border-y border-ink-600 bg-ink-850/60 px-4 py-1.5 sm:px-5">
            <span className="eyebrow text-[10px]">Bench</span>
          </div>
          <ul className="divide-y divide-ink-700">
            {Array.from({ length: benchRows }, (_, i) => {
              const b = asSlot(benchBefore[i]);
              const a = asSlot(benchAfter[i]);
              return (
                <li key={i} className="flex items-center gap-2 px-4 py-1.5 text-[13px] sm:px-5">
                  <span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">BN</span>
                  {b ? (
                    <Cell
                      slot={b}
                      out={Boolean(b.id && outgoing.has(b.id))}
                      nameOf={nameOf}
                      positionOf={positionOf}
                      canLink={canLink}
                      overridden={overridden}
                onBye={onBye}
                    />
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  {a ? (
                    <Cell
                      slot={a}
                      traded={Boolean(a.id && incoming.has(a.id))}
                      nameOf={nameOf}
                      positionOf={positionOf}
                      canLink={canLink}
                      overridden={overridden}
                onBye={onBye}
                    />
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </>
  );
}

/**
 * One lineup and its bench, for the opponent's side of a week — after the trade
 * only, so a single column. Same `Cell`, so the markers mean the same thing.
 */
function LineupSingle({
  lineup,
  bench,
  incoming,
  overridden,
  onBye,
  nameOf,
  positionOf,
  canLink,
}: {
  lineup: Lineup;
  bench: Array<{ id: string; points: number }>;
  incoming: Set<string>;
  overridden: Set<string>;
  onBye: Set<string>;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
}) {
  const rows: Array<{ label: string; slot: LineupSlot }> = [
    ...lineup.slots.map((s) => ({ label: slotLabel(s.slot), slot: s })),
    ...bench.map((p) => ({
      label: "BN",
      slot: { slot: "BN", id: p.id, points: p.points, freeAgent: false } as LineupSlot,
    })),
  ];
  return (
    <ul className="divide-y divide-ink-700 border-t border-ink-700">
      {rows.map((r, i) => (
        <li
          key={i}
          className={`flex items-center gap-2 px-4 py-1.5 text-[13px] sm:px-5 ${
            i === lineup.slots.length ? "border-t border-ink-500" : ""
          }`}
        >
          <span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">{r.label}</span>
          <Cell
            slot={r.slot}
            traded={Boolean(r.slot.id && incoming.has(r.slot.id))}
            nameOf={nameOf}
            positionOf={positionOf}
            canLink={canLink}
            overridden={overridden}
            onBye={onBye}
          />
        </li>
      ))}
      <li className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold sm:px-5">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-chalk-500">Total</span>
        <span className="min-w-0 flex-1 text-right tabular text-chalk-100">{lineup.total.toFixed(2)}</span>
      </li>
    </ul>
  );
}

/** What the markers in `LineupCompare` mean. `byes` off where none can appear. */
export function LineupLegend({ byes = true }: { byes?: boolean }) {
  return (
    <p className="px-4 pt-3 text-[11px] text-chalk-600 sm:px-5">
      <Badge tone="trade">TRADE</Badge> arrives in the deal · <Badge tone="out">OUT</Badge> leaves in it ·{" "}
      <Badge tone="fa">FA</Badge> picked up off waivers ·{" "}
      {byes ? (
        <>
          <Badge tone="bye">BYE</Badge> his team is idle ·{" "}
        </>
      ) : null}
      struck through: no longer starts. Bench players show their position;{" "}
      <span className="text-caution">amber</span> points are your overrides.
    </p>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink-850 px-4 py-3 sm:px-5">
      <div className="eyebrow mb-1 text-[10px]">{label}</div>
      <div className="tabular text-sm text-chalk-100">{children}</div>
    </div>
  );
}

function Cell({
  slot,
  fresh = false,
  faded = false,
  traded = false,
  out = false,
  nameOf,
  positionOf,
  canLink,
  overridden,
  onBye,
}: {
  slot: LineupSlot | undefined;
  fresh?: boolean;
  faded?: boolean;
  traded?: boolean;
  out?: boolean;
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  canLink: Set<string>;
  overridden: Set<string>;
  onBye: Set<string>;
}) {
  if (!slot?.id) return <span className="min-w-0 flex-1 text-chalk-600">Empty</span>;
  return (
    <span
      className={`flex min-w-0 flex-1 items-baseline gap-1.5 ${
        fresh ? "text-chalk-100" : faded ? "text-chalk-600 line-through" : "text-chalk-400"
      }`}
    >
      <PlayerName id={slot.id} name={nameOf(slot.id)} canLink={canLink} />
      {traded ? <Badge tone="trade">TRADE</Badge> : null}
      {out ? <Badge tone="out">OUT</Badge> : null}
      {onBye.has(slot.id) ? <Badge tone="bye">BYE</Badge> : null}
      {slot.freeAgent ? <Badge tone="fa">FA</Badge> : null}
      <span className="ml-auto shrink-0 pl-1 tabular text-[12px] text-chalk-500 no-underline">
        {positionOf(slot.id) && slot.slot !== positionOf(slot.id) ? (
          <span className="mr-1 text-[10px] text-chalk-600">{positionOf(slot.id)}</span>
        ) : null}
        <span
          className={overridden.has(slot.id) ? "text-caution" : undefined}
          title={overridden.has(slot.id) ? "Your override, not Sleeper's projection" : undefined}
        >
          {slot.points.toFixed(1)}
        </span>
      </span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "trade" | "out" | "fa" | "bye"; children: React.ReactNode }) {
  const cls =
    tone === "trade"
      ? "border-trade/50 text-trade"
      : tone === "out"
        ? "border-loss/50 text-loss"
        : tone === "bye"
          ? "border-ink-400 text-chalk-500"
          : "border-caution/50 text-caution";
  return (
    <span className={`shrink-0 rounded border px-1 text-[9px] font-bold tracking-wide no-underline ${cls}`}>
      {children}
    </span>
  );
}

const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SFLX",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
};
const slotLabel = (s: string) => SLOT_LABELS[s] ?? s;

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

export function PlayerName({ id, name, canLink }: { id: string; name: string; canLink: Set<string> }) {
  return canLink.has(id) ? (
    <Link href={`/players/${id}/`} className="min-w-0 truncate transition-colors hover:text-accent">
      {name}
    </Link>
  ) : (
    <span className="min-w-0 truncate">{name}</span>
  );
}

/** A signed points figure, green up and red down. */
export function Delta({ n, digits = 1 }: { n: number; digits?: number }) {
  const r = Number(n.toFixed(digits));
  const cls = r > 0 ? "text-win" : r < 0 ? "text-loss" : "text-chalk-500";
  return (
    <span data-me-exempt="" className={cls}>
      {r > 0 ? "+" : r < 0 ? "−" : "±"}
      {Math.abs(r).toFixed(digits)}
    </span>
  );
}
