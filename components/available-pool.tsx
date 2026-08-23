"use client";

import { Fragment, useMemo, useState } from "react";

import { PositionPill } from "@/components/keeper-table";
import { SortHeader, compareSort, type SortState } from "@/components/sortable-header";
import { adpIsConsensusOnly, adpSortKey, adpTitle, adpValue } from "@/lib/adp-format";
import { costRound } from "@/lib/draft-slots";
import { NFL_GAMES } from "@/lib/projection-format";
import type { AdpEntry, Projection } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * Everyone the draft can still take, in market order.
 *
 * The board answers "what does each pick get"; this answers "who is left", which
 * is the other half of the same question and the one you actually scan when
 * deciding whether to pass on a keeper. It reacts to the scenario, so ticking a
 * player as kept removes him here immediately.
 *
 * THE RELEASED COLUMN IS THE POINT. A player under contract who is not being
 * kept goes back into the pool, and that is exactly the thing that is invisible
 * on Sleeper and hard to hold in your head across ten teams. Seeing "Jeanty —
 * Brendon R1" sitting at the top of the available list is the whole argument for
 * passing on him.
 */

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;


type PosFilter = (typeof POSITIONS)[number];

export function AvailablePool({
  adp,
  keptBy,
  livePicksByRound,
  starred,
  onToggleStar,
  onClearStars,
  onOpenPlayer,
  projections,
  contracts,
  players,
  ownerNames,
  draftRounds,
}: {
  adp: Record<string, AdpEntry>;
  /** playerId -> owner slug keeping him in this scenario. */
  keptBy: Map<string, string>;
  /**
   * Live picks per round, indexed 1..rounds — from the same placement the board
   * uses. Null when no order exists yet, in which case the list renders flat
   * rather than inventing round breaks.
   */
  livePicksByRound: number[] | null;
  /** Starred player ids — a personal watchlist, persisted in localStorage. */
  starred: Set<string>;
  onToggleStar: (playerId: string) => void;
  onClearStars: () => void;
  onOpenPlayer: (playerId: string) => void;
  /** Sleeper season projections, keyed by player id. Empty if never imported. */
  projections: Record<string, Projection>;
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  draftRounds: number;
}) {
  const [pos, setPos] = useState<PosFilter>("ALL");
  const [q, setQ] = useState("");
  const [starsOnly, setStarsOnly] = useState(false);
  const [showKept, setShowKept] = useState(false);
  /**
   * ADP ASCENDING IS THE DEFAULT AND IT IS NOT ARBITRARY: it is the order the
   * draft actually happens in, which is what makes the round breaks meaningful.
   * Every other sort is a lens on the same pool.
   */
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "adp", dir: "asc" });

  const contractBy = useMemo(
    () => new Map(contracts.map((c) => [c.playerId, c])),
    [contracts],
  );

  // Sorted on the DECIMAL BEING SHOWN, not on `rank`. The two orderings disagree
  // — rank is beatadp's consensus — and sorting by an invisible key makes the ADP
  // column look scrambled. `adpSortKey` applies the same consensus fallback the
  // display does, so the column reads top to bottom.
  const all = useMemo(
    () =>
      Object.values(adp)
        .filter((e) => e.playerId)
        .sort((a, b) => adpSortKey(a) - adpSortKey(b) || a.rank - b.rank),
    [adp],
  );
  const undraftedCount = all.filter((e) => !keptBy.has(e.playerId as string)).length;

  const sortValue = (e: AdpEntry): number | string | null => {
    const id = e.playerId as string;
    const pr = projections[id];
    switch (sort.key) {
      case "rk": return projections[e.playerId as string]?.rank ?? null;
      case "adp": return adpSortKey(e);
      case "round": return e.round;
      case "pos": return e.position ?? "";
      case "name": return (players[id]?.full_name ?? e.name).toLowerCase();
      case "pts":
      case "ppg": return pr?.pts_ppr ?? null;   // PPG is PTS/17, so the order is identical
      case "rush_att": return pr?.rush_att ?? null;
      case "rush_yd": return pr?.rush_yd ?? null;
      case "rush_td": return pr?.rush_td ?? null;
      case "rec": return pr?.rec ?? null;
      case "rec_yd": return pr?.rec_yd ?? null;
      case "rec_td": return pr?.rec_td ?? null;
      case "pass_yd": return pr?.pass_yd ?? null;
      case "pass_td": return pr?.pass_td ?? null;
      case "pass_int": return pr?.pass_int ?? null;
    }
  };

  const needle = q.trim().toLowerCase();
  // `showKept` counts as filtering for the purpose of the round breaks: those
  // describe consumption of the DRAFT POOL, and once unavailable players are
  // interleaved the positions they mark are no longer pool positions.
  // Round breaks assume the list IS the draft order. Any other sort, and the
  // position a player sits at stops meaning "this is when he goes".
  const filtered =
    pos !== "ALL" ||
    needle !== "" ||
    starsOnly ||
    showKept ||
    sort.key !== "adp" ||
    sort.dir !== "asc";

  /**
   * KEPT PLAYERS ARE REACHABLE BUT NOT LISTED.
   *
   * The default list is the draft pool, and a kept player is not in it — putting
   * him there would overstate what the draft can return. But you still need to
   * find him to star him, so a SEARCH or the star filter reaches the whole
   * universe. Anything that surfaces one is a deliberate act; idle scrolling
   * never does.
   */
  const includeKept = showKept || needle !== "" || starsOnly;
  const rows = all.filter((e) => {
    const id = e.playerId as string;
    if (keptBy.has(id) && !includeKept) return false;
    return (
      (pos === "ALL" || e.position === pos) &&
      (!starsOnly || starred.has(id)) &&
      (!needle || e.name.toLowerCase().includes(needle))
    );
  });

  /**
   * Sorted after filtering, and NULLS ALWAYS SINK.
   *
   * A blank is "this position does not do that", not a zero: sorting passing
   * yards ascending must not open with three hundred receivers before the first
   * quarterback. So missing values go last in BOTH directions and only the
   * present ones reverse.
   */
  rows.sort((a, b) => {
    // Ties fall back to market order, so the list never reshuffles arbitrarily.
    return compareSort(sortValue(a), sortValue(b), sort.dir) || adpSortKey(a) - adpSortKey(b);
  });

  /**
   * Where each round STARTS, as an index into the list.
   *
   * THIS IS THE DILUTION, DRAWN. Round 1 does not take the top ten players — it
   * takes as many as there are live picks, because the rest of the round is
   * already spent on keepers. So with six teams keeping in round 1, only four
   * names sit under that heading, and everything below is a round later than a
   * normal draft would put it.
   *
   * Heads the group rather than closing it: you scan down looking for where your
   * pick lands, and a heading answers "which round am I in" at the point you are
   * looking, where an "end of round" line answers it one row too late.
   *
   * A round with no live picks is skipped — every one of its picks went to a
   * keeper, so there is no group of players to head.
   *
   * SUPPRESSED WHEN FILTERED. The counts describe consumption of the whole pool;
   * drawn over a position-filtered list they would claim that four RECEIVERS go
   * in round 1, which is not what the number means.
   */
  const roundStartsAt = new Map<number, { round: number; picks: number }>();
  if (livePicksByRound && !filtered) {
    let at = 0;
    for (let r = 1; r < livePicksByRound.length && at < rows.length; r++) {
      const picks = livePicksByRound[r];
      if (picks <= 0) continue;
      roundStartsAt.set(at, { round: r, picks });
      at += picks;
    }
  }

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-600 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-chalk-300">
          Available pool{" "}
          <span className="ml-1 font-normal normal-case tracking-normal text-chalk-600">
            {rows.length} shown · {undraftedCount} undrafted
            {includeKept ? (
              <span className="ml-1 text-accent">· including kept</span>
            ) : null}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPos(p)}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                pos === p
                  ? "border-accent-dim bg-accent/10 text-accent"
                  : "border-ink-500 text-chalk-500 hover:text-chalk-300"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowKept((v) => !v)}
            title={
              showKept
                ? "Hide players already kept — back to the draft pool only"
                : "Show players kept in this scenario. They are not draftable; they appear dimmed, with who holds them."
            }
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              showKept
                ? "border-accent-dim bg-accent/10 text-accent"
                : "border-ink-500 text-chalk-500 hover:text-chalk-300"
            }`}
          >
            kept
          </button>
          <button
            type="button"
            onClick={() => setStarsOnly((v) => !v)}
            onDoubleClick={onClearStars}
            title={`${starsOnly ? "Showing starred only" : "Show starred only"} — ${starred.size} starred. Double-click to clear them all.`}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              starsOnly
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-ink-500 text-chalk-500 hover:text-gold"
            }`}
          >
            {"\u2605"} {starred.size}
          </button>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search"
            className="w-24 rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-[11px] text-chalk-200 placeholder:text-chalk-600"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-max">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-1 text-[9px] uppercase tracking-wide text-chalk-600">
        <span className="w-4 shrink-0" />
        <span className="w-6 shrink-0 text-right" title="Position in this list, after filtering and sorting">
          #
        </span>
        <SortHeader
          k="rk"
          first="asc"
          w="w-8"
          t="Sleeper's own draft-board rank — the RK column on its board, taken from its ranking rather than derived here"
          state={sort}
          onSort={setSort}
        >
          RK
        </SortHeader>
        <SortHeader k="adp" first="asc" w="w-12" t="Average draft position as a decimal pick number. Sleeper's where it exists, consensus (°) otherwise." state={sort} onSort={setSort}>ADP</SortHeader>
        <SortHeader k="round" first="asc" w="w-7" t="Round that ADP converts to for this league" state={sort} onSort={setSort}>Rd</SortHeader>
        <SortHeader k="pos" first="asc" w="w-8" align="left" t="Position" state={sort} onSort={setSort}>Pos</SortHeader>
        <SortHeader k="name" first="asc" w="min-w-[9rem] flex-1" align="left" t="Player name" state={sort} onSort={setSort}>Player</SortHeader>
        <SortHeader k="pts" first="desc" w="w-12" t="Projected PPR points for the full NFL regular season" state={sort} onSort={setSort}>PTS</SortHeader>
        <SortHeader k="ppg" first="desc" w="w-11" t={`Projected PPR points per game — season total over ${NFL_GAMES} games`} state={sort} onSort={setSort}>PPG</SortHeader>
        <SortHeader k="rush_att" first="desc" w="w-10" t="Projected rushing attempts" state={sort} onSort={setSort}>Att</SortHeader>
        <SortHeader k="rush_yd" first="desc" w="w-12" t="Projected rushing yards" state={sort} onSort={setSort}>Ru Yd</SortHeader>
        <SortHeader k="rush_td" first="desc" w="w-9" t="Projected rushing touchdowns" state={sort} onSort={setSort}>Ru TD</SortHeader>
        <SortHeader k="rec" first="desc" w="w-10" t="Projected receptions" state={sort} onSort={setSort}>Rec</SortHeader>
        <SortHeader k="rec_yd" first="desc" w="w-12" t="Projected receiving yards" state={sort} onSort={setSort}>Re Yd</SortHeader>
        <SortHeader k="rec_td" first="desc" w="w-9" t="Projected receiving touchdowns" state={sort} onSort={setSort}>Re TD</SortHeader>
        <SortHeader k="pass_yd" first="desc" w="w-12" t="Projected passing yards" state={sort} onSort={setSort}>Pa Yd</SortHeader>
        <SortHeader k="pass_td" first="desc" w="w-9" t="Projected passing touchdowns" state={sort} onSort={setSort}>Pa TD</SortHeader>
        <SortHeader k="pass_int" first="desc" w="w-9" t="Projected interceptions thrown" state={sort} onSort={setSort}>Int</SortHeader>
      </div>

      <ul className="max-h-[32rem] overflow-y-auto">
        {rows.map((e, i) => {
          const id = e.playerId as string;
          const c = contractBy.get(id);
          const meta = players[id];
          const head = roundStartsAt.get(i);
          const isStar = starred.has(id);
          const heldBy = keptBy.get(id);
          return (
            <Fragment key={id}>
            {head ? (
              <li
                className="flex items-center gap-2 px-3 pb-0.5 pt-2"
                title={`Round ${head.round} has ${head.picks} live pick${
                  head.picks === 1 ? "" : "s"
                } once keepers are removed, so it absorbs the next ${head.picks} of these players.`}
              >
                <span className="h-px flex-1 bg-accent-dim/40" />
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-accent-dim">
                  Round {head.round} · {head.picks} live pick{head.picks === 1 ? "" : "s"}
                </span>
                <span className="h-px flex-1 bg-accent-dim/40" />
              </li>
            ) : null}
            <li
              className={`flex items-center gap-2 px-3 py-1 text-[11px] hover:bg-ink-800/50 ${
                heldBy ? "opacity-50" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onToggleStar(id)}
                aria-pressed={isStar}
                title={isStar ? "Starred — click to remove" : "Star this player"}
                className={`w-4 shrink-0 text-left text-[11px] leading-none transition-colors ${
                  isStar ? "text-gold" : "text-ink-400 hover:text-gold"
                }`}
              >
                {isStar ? "\u2605" : "\u2606"}
              </button>
              {/* Counts the FILTERED list, so switching to RB gives you RB1,
                  RB2, RB3 — which is the ordering you actually reason in. The
                  unfiltered market position is the ADP beside it. */}
              <span className="tabular w-6 shrink-0 text-right text-chalk-600">{i + 1}</span>
              <span
                className="tabular w-8 shrink-0 text-right text-chalk-500"
                title={
                  projections[id]?.rank != null
                    ? `Sleeper's board has him ${projections[id].rank} overall`
                    : "Sleeper does not price him, so its board gives him no rank"
                }
              >
                {projections[id]?.rank ?? "—"}
              </span>
              <span
                className="tabular w-12 shrink-0 text-right text-chalk-300"
                title={adpTitle(e)}
              >
                {adpValue(e) ?? "—"}
                {adpIsConsensusOnly(e) ? <span className="text-chalk-600">°</span> : null}
              </span>
              <span className="tabular w-7 shrink-0 text-right text-chalk-600">
                {e.round != null ? `R${e.round}` : "—"}
              </span>
              <span className="w-8 shrink-0">
                <PositionPill position={e.position ?? meta?.position ?? null} />
              </span>
              <button
                type="button"
                onClick={() => onOpenPlayer(id)}
                className="min-w-0 flex-1 truncate text-left text-chalk-200 transition-colors hover:text-accent"
                title="Contract, market and his team's depth chart"
              >
                {meta?.full_name ?? e.name}
                {e.team ? <span className="ml-1.5 text-chalk-600">{e.team}</span> : null}
                {/* The released-by column is gone, but not the fact — it is the
                    reason a good player is in this list at all. Demoted to a
                    suffix rather than dropped. */}
                {heldBy ? (
                  <span className="ml-1.5 text-[10px] text-accent">kept · {ownerNames[heldBy] ?? heldBy}</span>
                ) : c?.ownerSlug ? (
                  <span className="ml-1.5 text-[10px] text-loss">
                    {ownerNames[c.ownerSlug] ?? c.ownerSlug} R{costRound(c, e, draftRounds)}
                  </span>
                ) : null}
              </button>
              {(() => {
                const pr = projections[id];
                const pts = pr?.pts_ppr ?? null;
                return (
                  <>
                    <span className="tabular w-12 shrink-0 text-right font-medium text-chalk-200">
                      {pts != null ? pts.toFixed(0) : "—"}
                    </span>
                    <span className="tabular w-11 shrink-0 text-right text-chalk-400">
                      {pts != null ? (pts / NFL_GAMES).toFixed(1) : "—"}
                    </span>
                    {/* Blank, not a dash, where a position simply does not do the
                        thing. Nine columns of "—" across every receiver turns a
                        scannable table into a field of punctuation. */}
                    <Num w="w-10" v={pr?.rush_att} />
                    <Num w="w-12" v={pr?.rush_yd} />
                    <Num w="w-9" v={pr?.rush_td} d={1} />
                    <Num w="w-10" v={pr?.rec} />
                    <Num w="w-12" v={pr?.rec_yd} />
                    <Num w="w-9" v={pr?.rec_td} d={1} />
                    <Num w="w-12" v={pr?.pass_yd} />
                    <Num w="w-9" v={pr?.pass_td} d={1} />
                    <Num w="w-9" v={pr?.pass_int} d={1} />
                  </>
                );
              })()}
            </li>
            </Fragment>
          );
        })}        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-[11px] text-chalk-600">
            Nobody matches that filter.
          </li>
        ) : null}
      </ul>
        </div>
      </div>
    </div>
  );
}

export type SortKey =
  | "rk" | "adp" | "round" | "pos" | "name" | "pts" | "ppg"
  | "rush_att" | "rush_yd" | "rush_td"
  | "rec" | "rec_yd" | "rec_td"
  | "pass_yd" | "pass_td" | "pass_int";


/** A projected stat, blank when the position does not produce it. */
function Num({ w, v, d = 0 }: { w: string; v?: number | null; d?: number }) {
  return (
    <span className={`tabular ${w} shrink-0 text-right text-chalk-500`}>
      {v ? v.toFixed(d) : ""}
    </span>
  );
}
