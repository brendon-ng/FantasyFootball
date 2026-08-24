"use client";

import { useMemo, useState } from "react";

import { PositionPill } from "@/components/keeper-table";
import { adpIsConsensusOnly, adpTitle, adpValue } from "@/lib/adp-format";
import { SortHeader, compareSort, type SortState } from "@/components/sortable-header";
import { costRound } from "@/lib/draft-slots";
import type { ProjectedPick } from "@/lib/adp-projection";
import { randomOrder, type ScenarioApi } from "@/lib/scenario";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The what-if controls: who each team keeps, and what order the board runs in.
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
  liveOrder,
  projectedPicks,
  releasedPicks,
  onOpenPlayer,
}: {
  teams: EditorTeam[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  draftRounds: number;
  maxKeepers: number;
  api: ScenarioApi;
  /** The live service backing this season — "Sleeper" or "ESPN". */
  providerName: string;
  /**
   * The REAL order, once it has been drawn, so a scenario can start from it.
   *
   * Null until then, and that gate is `orderSet` rather than the mere presence
   * of a slot map — Sleeper ships `slot_to_roster_id` as an identity
   * placeholder from the moment a draft exists, so copying that in would fill
   * the editor with a confident-looking order that is really roster-creation
   * sequence. See lib/draft-slots.
   */
  liveOrder: { slotToRoster: Record<number, number>; mocked: boolean } | null;
  /** Where the draft would take each player. Null before an order exists. */
  projectedPicks: Map<string, ProjectedPick> | null;
  /** Kept players only: where the draft would take them if released. */
  releasedPicks: Map<string, ProjectedPick> | null;
  onOpenPlayer: (playerId: string) => void;
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
        liveOrder={liveOrder}
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
                      projectedPicks={projectedPicks}
                      releasedPicks={releasedPicks}
                      onOpenPlayer={onOpenPlayer}
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

type ContractSort =
  | "player" | "pos" | "adp" | "proj" | "cost" | "vsProj" | "vsMkt" | "keeps";

/**
 * One team's contracts, as the thing you actually choose from.
 *
 * TWO DELTAS, AND THEY DISAGREE ON PURPOSE. `vs mkt` is what he costs against a
 * normal draft; `vs proj` is what he costs against THIS one, after keepers have
 * stripped the board. The second is the one the decision turns on — a player the
 * market takes in round 15 may not last past round 14 here, and paying R11 is a
 * different trade against each.
 *
 * Sorted by cost round by default, cheapest pick last: the decision is always
 * "is he worth this pick", so the expensive obligations belong where the eye
 * lands first.
 */
function ContractList({
  contracts,
  selected,
  players,
  adp,
  projectedPicks,
  releasedPicks,
  onOpenPlayer,
  draftRounds,
  atCap,
  onToggle,
}: {
  contracts: KeeperContract[];
  selected: string[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  /** Where the draft would take each player — see lib/adp-projection.ts. */
  projectedPicks: Map<string, ProjectedPick> | null;
  /** Kept players only: where he would go if you let him go. */
  releasedPicks: Map<string, ProjectedPick> | null;
  onOpenPlayer: (playerId: string) => void;
  draftRounds: number;
  atCap: boolean;
  onToggle: (playerId: string) => void;
}) {
  const [sort, setSort] = useState<SortState<ContractSort>>({ key: "cost", dir: "asc" });

  const row = (c: KeeperContract) => {
    const entry = adp[c.playerId];
    const cost = costRound(c, entry, draftRounds);
    const pick = projectedPicks?.get(c.playerId) ?? null;
    // THE BASELINE FOR A KEPT PLAYER IS THE COUNTERFACTUAL. He occupies the pick
    // he costs, so comparing against that says nothing; what you want to know is
    // the pick you would have had to spend to get him in the draft instead.
    const against = pick?.kept ? (releasedPicks?.get(c.playerId) ?? null) : pick;
    const market = entry?.round ?? null;
    // costRound - theirRound. POSITIVE means you pay a later pick than they
    // would cost, i.e. a bargain. Rounds count up as value counts down.
    return {
      c,
      entry,
      cost,
      pick,
      market,
      meta: players[c.playerId],
      against,
      vsProj: against ? cost - against.round : null,
      vsMkt: market != null ? cost - market : null,
    };
  };

  const value = (r: ReturnType<typeof row>): number | string | null => {
    switch (sort.key) {
      case "player": return (r.meta?.full_name ?? r.c.playerId).toLowerCase();
      case "pos": return r.meta?.position ?? "";
      case "adp": return r.entry?.sleeper ?? r.entry?.consensus ?? null;
      case "proj": return r.pick?.overall ?? null;
      case "cost": return r.cost;
      case "vsProj": return r.vsProj;
      case "vsMkt": return r.vsMkt;
      case "keeps": return r.c.keepsRemaining;
    }
  };

  const rows = contracts.map(row).sort((a, b) => {
    // Ties fall back to cost so the list never reshuffles between renders.
    return compareSort(value(a), value(b), sort.dir) || a.cost - b.cost;
  });


  return (
    <>
      <div className="flex items-center gap-2 border-b border-ink-700 px-1.5 pb-1 text-[9px] text-chalk-600">
        <span className="w-3 shrink-0" />
        <SortHeader state={sort} onSort={setSort} k="pos" first="asc" w="w-8" t="Position" align="left">Pos</SortHeader>
        <SortHeader state={sort} onSort={setSort} k="player" first="asc" w="min-w-0 flex-1" t="Player name" align="left">Player</SortHeader>
        <SortHeader state={sort} onSort={setSort} k="keeps" first="asc" w="w-7" t="Keeps left on the contract">Kp</SortHeader>
        <SortHeader state={sort} onSort={setSort}
          k="adp"
          first="asc"
          w="w-14"
          t="Average draft position as a decimal pick number. Sleeper's where it exists, consensus (marked °) otherwise."
        >
          ADP
        </SortHeader>
        <SortHeader state={sort} onSort={setSort}
          k="proj"
          first="asc"
          w="w-12"
          t="Where the draft would take him given these keeper selections, if every pick went in ADP order"
        >
          Proj
        </SortHeader>
        <SortHeader state={sort} onSort={setSort} k="cost" first="asc" w="w-7" t="The pick keeping him costs you">Cost</SortHeader>
        <SortHeader state={sort} onSort={setSort}
          k="vsProj"
          first="desc"
          w="w-9"
          t="Cost round minus his projected round in THIS draft — positive is a bargain"
        >
          vs prj
        </SortHeader>
        <SortHeader state={sort} onSort={setSort}
          k="vsMkt"
          first="desc"
          w="w-9"
          t="Cost round minus his market round by ADP — positive is a bargain"
        >
          vs mkt
        </SortHeader>
      </div>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto pt-0.5">
        {rows.map(({ c, entry, cost, pick, against, market, meta, vsProj, vsMkt }) => {
          const on = selected.includes(c.playerId);
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
                <span className="w-8 shrink-0">
                  <PositionPill position={meta?.position ?? null} />
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  {/* INSIDE A <label>, so a bare click would toggle the checkbox
                      as well as open the modal. preventDefault stops the label
                      activating its control; stopPropagation stops the row
                      handler. Both are needed — either alone still toggles. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenPlayer(c.playerId);
                    }}
                    className="min-w-0 truncate text-left text-chalk-200 transition-colors hover:text-accent"
                    title="Contract, market, projection and his team's depth chart"
                  >
                    {meta?.full_name ?? c.playerId}
                  </button>
                  {c.keepsRemaining === 1 ? (
                    <span
                      className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gold"
                      title="Final keep year — this contract is revalued to ADP next offseason."
                    >
                      last
                    </span>
                  ) : null}
                </span>
                <span className="tabular w-7 shrink-0 text-right text-chalk-500">
                  {c.keepsRemaining}
                </span>
                {/* THE DECIMAL ADP, not the list rank. "15.4" says he goes late in
                    round 2 of a ten-team draft, which "#15" does not. */}
                <span
                  className="tabular w-14 shrink-0 text-right text-chalk-400"
                  title={adpTitle(entry)}
                >
                  {adpValue(entry) ?? "—"}
                  {adpIsConsensusOnly(entry) ? <span className="text-chalk-600">°</span> : null}
                </span>
                <span
                  className={`tabular w-12 shrink-0 text-right ${
                    pick?.kept ? "text-accent/80" : "text-chalk-400"
                  }`}
                  title={
                    pick
                      ? `${pick.kept ? "Kept — consumes" : "Projected to go at"} ${pick.label}, ${pick.overall} overall`
                      : projectedPicks
                        ? "Not in the ADP pool"
                        : "Needs a draft order — randomise one above"
                  }
                >
                  {pick ? pick.label : "—"}
                </span>
                <span
                  className="tabular w-7 shrink-0 text-right font-medium text-chalk-300"
                  title={`Keeping him costs your round ${cost} pick`}
                >
                  R{cost}
                </span>
                <Delta
                  v={vsProj}
                  w="w-9"
                  t={
                    against
                      ? pick?.kept
                        ? `vs R${against.round} — where the draft would take him (${against.label}) if you let him go`
                        : `vs projected R${against.round}`
                      : "No projected pick"
                  }
                />
                <Delta v={vsMkt} w="w-9" t={market != null ? `vs market R${market}` : "No ADP"} />
              </label>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A signed round delta: positive is a bargain. */
function Delta({ v, w, t }: { v: number | null; w: string; t: string }) {
  return (
    <span
      className={`tabular ${w} shrink-0 text-right ${
        v == null ? "text-chalk-600" : v > 0 ? "text-accent" : v < 0 ? "text-loss" : "text-chalk-600"
      }`}
      title={t}
    >
      {v == null ? "—" : v > 0 ? `+${v}` : v}
    </span>
  );
}

/** Draft order: one row per slot, each a team picker. */
function OrderEditor({
  order,
  liveOrder,
  rosterIds,
  nameOf,
  onChange,
  providerName,
}: {
  order: Record<number, number> | null;
  liveOrder: { slotToRoster: Record<number, number>; mocked: boolean } | null;
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
          {/* ONLY ONCE THE ORDER IS REAL. There is nothing to copy before it is
              drawn, and a permanently disabled button through the weeks that
              bylaw 1.7 leaves the order undrawn is noise — the empty state
              below already explains why there is no order.

              WHAT IT IS FOR is editing, not viewing: with no scenario the board
              ALREADY follows the live order, so this exists to materialise that
              order as something you can then change one slot of. */}
          {liveOrder ? (
            <Btn
              onClick={() => onChange({ ...liveOrder.slotToRoster })}
              title={
                liveOrder.mocked
                  ? `Copy in the MOCKED order currently standing in for ${providerName}'s, so you can edit it. It will stay in the scenario after the mock flag is gone.`
                  : `Copy in ${providerName}'s real order, so you can edit it.`
              }
            >
              {/* Named for where it came from, and marked when it is a stand-in:
                  a mocked order copied into a scenario cannot go quiet the way
                  the mock itself does, so the label has to admit it. */}
              {liveOrder.mocked ? `Use mock order` : `Use ${providerName}'s`}
            </Btn>
          ) : null}
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
          {liveOrder ? (
            <>
              Following {providerName}&rsquo;s real order — the board above is already
              using it. Copy it in to change a slot, or randomise for a different draw.
            </>
          ) : (
            <>
              Following {providerName}. Bylaw 1.7 draws the order after the keeper deadline, so
              this is empty until then — randomise to see where your slot could land.
            </>
          )}
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
