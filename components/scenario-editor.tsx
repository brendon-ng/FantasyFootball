"use client";

import { useMemo, useState } from "react";

import { PositionPill } from "@/components/keeper-table";
import { adpIsConsensusOnly, adpTitle, adpValue } from "@/lib/adp-format";
import { costRound } from "@/lib/draft-slots";
import { randomOrder, type ScenarioApi } from "@/lib/scenario";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The what-if controls: who each team keeps, and what order the board runs in.
 *
 * EXPERIMENTAL, strategy-lab branch only.
 *
 * Every team is editable, not just yours. The interesting questions are all about
 * other people's choices — whether Cassidy passes on a marginal first-rounder,
 * whether Jaymie values his quarterback correctly — because those decide what
 * reaches the board for everyone else.
 *
 * A roster you have not touched is UNTOUCHED, and follows the live provider. That
 * keeps a
 * scenario minimal: change one team, leave nine real, and the diff on the board
 * is attributable to exactly the thing you changed.
 */

export interface EditorTeam {
  rosterId: number;
  slug: string | null;
  name: string;
  contracts: KeeperContract[];
  /** What the live provider currently has locked in — the "unedited" baseline. */
  live: string[];
}

export function ScenarioEditor({
  teams,
  players,
  adp,
  draftRounds,
  maxKeepers,
  api,
  providerName,
}: {
  teams: EditorTeam[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  draftRounds: number;
  maxKeepers: number;
  api: ScenarioApi;
  /** The live service backing this season — "Sleeper" or "ESPN". */
  providerName: string;
}) {
  const { scenario, setKeepers, clearRoster, setOrder, reset, seed } = api;
  const [open, setOpen] = useState<number | null>(null);

  const rosterIds = useMemo(() => teams.map((t) => t.rosterId), [teams]);
  const nameOf = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.rosterId, t.name])),
    [teams],
  );

  const selectionFor = (t: EditorTeam): string[] => scenario.keepers[t.rosterId] ?? t.live;
  const isOverridden = (t: EditorTeam): boolean => t.rosterId in scenario.keepers;

  const toggle = (t: EditorTeam, playerId: string) => {
    const cur = selectionFor(t);
    const next = cur.includes(playerId)
      ? cur.filter((id) => id !== playerId)
      : [...cur, playerId].slice(-maxKeepers);
    setKeepers(t.rosterId, next);
  };

  return (
    <div className="space-y-4">
      <OrderEditor
        order={scenario.order}
        rosterIds={rosterIds}
        nameOf={nameOf}
        onChange={setOrder}
        providerName={providerName}
      />

      <div className="rounded-lg border border-ink-600 bg-ink-850">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-chalk-300">
            Keeper selections
          </h3>
          <div className="flex gap-1.5">
            <Btn
              onClick={() =>
                seed(Object.fromEntries(teams.map((t) => [t.rosterId, t.live])))
              }
              title={`Copy every team's current ${providerName} selections in, so you can edit from there.`}
            >
              Seed from {providerName}
            </Btn>
            <Btn onClick={reset} title={`Drop the whole scenario and follow ${providerName} again.`}>
              Reset all
            </Btn>
          </div>
        </div>

        <div className="divide-y divide-ink-700">
          {teams.map((t) => {
            const sel = selectionFor(t);
            const over = isOverridden(t);
            const expanded = open === t.rosterId;
            return (
              <div key={t.rosterId}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : t.rosterId)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-800"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-chalk-100"
                    data-owner={t.slug ?? undefined}
                  >
                    {t.name}
                  </span>
                  {over ? (
                    <span className="shrink-0 rounded border border-loss/60 bg-loss/15 px-1 text-[9px] font-bold uppercase tracking-wide text-loss">
                      edited
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-chalk-600">follows {providerName}</span>
                  )}
                  <span className="tabular shrink-0 text-[11px] text-chalk-500">
                    {sel.length}/{maxKeepers}
                  </span>
                  <span className="shrink-0 text-[10px] text-chalk-600">
                    {expanded ? "▾" : "▸"}
                  </span>
                </button>

                {sel.length > 0 && !expanded ? (
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    {sel.map((id) => (
                      <span
                        key={id}
                        className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-chalk-300"
                      >
                        {players[id]?.full_name ?? id}
                        <span className="ml-1 text-chalk-600">
                          R{roundFor(t.contracts, id, adp, draftRounds)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {expanded ? (
                  <div className="px-3 pb-3">
                    {over ? (
                      <button
                        type="button"
                        onClick={() => clearRoster(t.rosterId)}
                        className="mb-2 text-[10px] text-chalk-500 underline underline-offset-2 hover:text-accent"
                      >
                        revert this team to {providerName}
                      </button>
                    ) : null}
                    <ContractList
                      contracts={t.contracts}
                      selected={sel}
                      players={players}
                      adp={adp}
                      draftRounds={draftRounds}
                      atCap={sel.length >= maxKeepers}
                      onToggle={(id) => toggle(t, id)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * A contract list sorted by what it costs, cheapest pick last.
 *
 * Sorted by COST ROUND rather than player quality, because the decision is
 * always "is he worth this pick" — putting the expensive obligations at the top
 * puts the real choices where the eye lands.
 */
function ContractList({
  contracts,
  selected,
  players,
  adp,
  draftRounds,
  atCap,
  onToggle,
}: {
  contracts: KeeperContract[];
  selected: string[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  draftRounds: number;
  atCap: boolean;
  onToggle: (playerId: string) => void;
}) {
  const rows = [...contracts].sort(
    (a, b) =>
      costRound(a, adp[a.playerId], draftRounds) - costRound(b, adp[b.playerId], draftRounds),
  );

  return (
    <>
      <div className="flex items-center gap-2 border-b border-ink-700 px-1.5 pb-1 text-[9px] uppercase tracking-wide text-chalk-600">
        <span className="w-3 shrink-0" />
        <span className="flex-1">Player</span>
        <span
          className="w-14 shrink-0 text-right"
          title="Average draft position as a decimal pick number. Sleeper's where it exists, consensus (marked °) otherwise."
        >
          ADP
        </span>
        <span className="w-7 shrink-0 text-right" title="The pick keeping him costs you">
          Cost
        </span>
        <span className="w-8 shrink-0 text-right" title="Cost round minus market round — positive is a bargain">
          +/−
        </span>
      </div>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto pt-0.5">
        {rows.map((c) => {
        const on = selected.includes(c.playerId);
        const entry = adp[c.playerId];
        const cost = costRound(c, adp[c.playerId], draftRounds);
        const market = entry?.round ?? null;
        const meta = players[c.playerId];
        // costRound - adpRound: positive means the pick is later than the market
        // asks, i.e. a bargain. Mind the direction — rounds count up as value
        // counts down.
        const surplus = market != null ? cost - market : null;
        return (
          <li key={c.playerId}>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] transition-colors ${
                on ? "bg-accent/10" : "hover:bg-ink-800"
              } ${!on && atCap ? "opacity-40" : ""}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(c.playerId)}
                className="h-3 w-3 shrink-0 accent-[#00e5a0]"
              />
              <PositionPill position={meta?.position ?? null} />
              <span className="min-w-0 flex-1 truncate text-chalk-200">
                {meta?.full_name ?? c.playerId}
              </span>
              {c.keepsRemaining === 1 ? (
                <span
                  className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gold"
                  title="Final keep year — this contract is revalued to ADP next offseason."
                >
                  last
                </span>
              ) : null}
              {/* THE DECIMAL ADP, not the list rank. "15.4" is an average draft
                  position — it says he goes late in round 2 of a ten-team draft,
                  which a rank of "#15" does not. Sleeper's own number where there
                  is one, consensus otherwise; the two are not interchangeable, so
                  a consensus-only figure is marked with a degree sign. */}
              <span
                className="tabular w-14 shrink-0 text-right text-chalk-400"
                title={adpTitle(entry)}
              >
                {adpValue(entry) ?? "—"}
                {adpIsConsensusOnly(entry) ? <span className="text-chalk-600">°</span> : null}
              </span>
              <span
                className="tabular w-7 shrink-0 text-right font-medium text-chalk-300"
                title={`Keeping him costs your round ${cost} pick`}
              >
                R{cost}
              </span>
              <span
                className={`tabular w-8 shrink-0 text-right ${
                  surplus == null
                    ? "text-chalk-600"
                    : surplus > 0
                      ? "text-accent"
                      : surplus < 0
                        ? "text-loss"
                        : "text-chalk-600"
                }`}
                title={market != null ? `Market has him in round ${market}` : "No ADP"}
              >
                {surplus == null ? "—" : surplus > 0 ? `+${surplus}` : surplus}
              </span>
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Draft order: one row per slot, each a team picker. */
function OrderEditor({
  order,
  rosterIds,
  nameOf,
  onChange,
  providerName,
}: {
  order: Record<number, number> | null;
  rosterIds: number[];
  nameOf: Record<number, string>;
  onChange: (next: Record<number, number> | null) => void;
  providerName: string;
}) {
  const slots = rosterIds.map((_, i) => i + 1);
  const current = order ?? {};

  // Two teams in one slot makes the board silently wrong rather than obviously
  // wrong, so it is called out rather than prevented — mid-edit you often have a
  // duplicate on the way to the arrangement you want.
  const counts = new Map<number, number>();
  for (const r of Object.values(current)) counts.set(r, (counts.get(r) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([r]) => nameOf[r]);
  const missing = order ? rosterIds.filter((r) => !Object.values(current).includes(r)) : [];

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-chalk-300">
          Draft order
        </h3>
        <div className="flex gap-1.5">
          <Btn onClick={() => onChange(randomOrder(rosterIds))} title="Draw a random order.">
            Randomise
          </Btn>
          <Btn
            onClick={() => onChange(null)}
            title={`Follow ${providerName}. Before the order is drawn the board will say so instead of guessing.`}
          >
            Clear
          </Btn>
        </div>
      </div>

      {order === null ? (
        <p className="px-3 py-3 text-[11px] text-chalk-600">
          Following {providerName}. Bylaw 1.7 draws the order after the keeper deadline, so this is
          empty until then — randomise to see where your slot could land.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 lg:grid-cols-5">
            {slots.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5">
                <span className="tabular w-4 shrink-0 text-[10px] text-chalk-600">{slot}</span>
                <select
                  value={current[slot] ?? ""}
                  onChange={(e) =>
                    onChange({ ...current, [slot]: Number(e.target.value) })
                  }
                  className="min-w-0 flex-1 rounded border border-ink-500 bg-ink-800 px-1.5 py-1 text-[11px] text-chalk-200"
                >
                  <option value="">—</option>
                  {rosterIds.map((r) => (
                    <option key={r} value={r}>
                      {nameOf[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {dupes.length || missing.length ? (
            <p className="border-t border-ink-700 px-3 py-2 text-[10px] text-loss">
              {dupes.length ? `Duplicated: ${dupes.join(", ")}. ` : ""}
              {missing.length
                ? `Unplaced: ${missing.map((r) => nameOf[r]).join(", ")}.`
                : ""}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Btn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded border border-ink-500 px-2 py-1 text-[10px] font-medium text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
    >
      {children}
    </button>
  );
}

const roundFor = (
  contracts: KeeperContract[],
  playerId: string,
  adp: Record<string, AdpEntry>,
  draftRounds: number,
): number | string => {
  const c = contracts.find((x) => x.playerId === playerId);
  return c ? costRound(c, adp[playerId], draftRounds) : "?";
};
