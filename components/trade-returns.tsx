"use client";

import { useState } from "react";

import { Tip } from "@/components/tooltip";
import { fmt } from "@/components/ui";
import type { PlayerMeta, TradeReturn, TradeSeason, TradeStat } from "@/lib/types";

/**
 * How the incoming players actually did, season by season.
 *
 * THE NEAREST THING TO "WHO WON", and deliberately not a verdict. It counts what
 * the players returned and nothing else — a team that traded for a position it
 * was short of may have won a deal it lost on points.
 *
 * A CLIENT COMPONENT ONLY BECAUSE OF THE TOGGLE. The card around it stays a
 * server component, which is what lets the trade lists render without shipping
 * any of this.
 */
export function TradeReturns({
  players,
  ownerNames,
  returns,
  onOpenTrade,
}: {
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  returns: TradeReturn;
  onOpenTrade?: (tradeId: string) => void;
}) {
  /**
   * OFF BY DEFAULT, and that is the important half.
   *
   * A pick is real consideration, so counting what it became is defensible — but
   * one first-rounder swamps the players who were actually named in the deal, and
   * the question people usually bring is player-for-player. Opt in when the picks
   * are the point.
   */
  const [withPicks, setWithPicks] = useState(false);

  const visible = returns.seasons.filter((s) =>
    Object.values(s.byOwner).some(
      (o) => Object.keys(o.byPlayer).length || (withPicks && Object.keys(o.fromPicks).length),
    ),
  );
  const anyPicks = returns.seasons.some((s) =>
    Object.values(s.byOwner).some((o) => Object.keys(o.fromPicks).length),
  );
  if (!visible.length && !anyPicks) return null;

  return (
    <div className="mt-4 border-t-2 border-ink-600 pt-3">
      {anyPicks ? (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-[11px] text-chalk-500">
          <input
            type="checkbox"
            checked={withPicks}
            onChange={(e) => setWithPicks(e.target.checked)}
            className="h-3 w-3 accent-[var(--color-accent)]"
          />
          Include players drafted with the traded picks
        </label>
      ) : null}
      {visible.map((season, i) => (
        <SeasonBlock
          key={season.season}
          season={season}
          order={returns.order}
          players={players}
          ownerNames={ownerNames}
          withPicks={withPicks}
          onOpenTrade={onOpenTrade}
          first={i === 0}
        />
      ))}
    </div>
  );
}

/**
 * One season of the trade's return.
 *
 * A SECTION PER SEASON, for as long as somebody is still being kept. The first is
 * the year of the trade and covers only the weeks after it; each one after that
 * is a full season narrowed to the players still on that roster, because a keep
 * is this trade continuing to pay rather than a new decision.
 */
function SeasonBlock({
  season,
  order,
  players,
  ownerNames,
  withPicks,
  onOpenTrade,
  first,
}: {
  season: TradeSeason;
  /** Every party to the trade, in the order the columns above use. */
  order: string[];
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  withPicks: boolean;
  onOpenTrade?: (tradeId: string) => void;
  first: boolean;
}) {
  /** The rows a side is showing, which the toggle decides. */
  const rowsFor = (slug: string): Array<[string, TradeStat, boolean]> => {
    const side = season.byOwner[slug];
    if (!side) return [];
    return [
      ...Object.entries(side.byPlayer).map(([id, st]) => [id, st, false] as [string, TradeStat, boolean]),
      ...(withPicks
        ? Object.entries(side.fromPicks).map(([id, st]) => [id, st, true] as [string, TradeStat, boolean])
        : []),
    ];
  };
  const totalFor = (slug: string) =>
    withPicks ? season.byOwner[slug]?.totalWithPicks : season.byOwner[slug]?.total;

  // Sides WITH data, for the padding and the best-of comparison.
  const sides = order.filter((s) => rowsFor(s).length);
  if (!sides.length) return null;
  const cell = "tabular w-9 shrink-0 text-right";
  // Padded to the longest side so the Total rows sit on the same line. Comparing
  // two totals three rows apart is the thing this table exists to make easy.
  const rows = Math.max(...sides.map((s) => rowsFor(s).length));

  const totals = sides.map((s) => statCells(totalFor(s)!));
  const best = COLUMNS.map((_, i) => {
    const values = totals.map((t) => t[i].value).filter((v): v is number => v !== null);
    return values.length < 2 ? null : Math.max(...values);
  });

  return (
    <div className={first ? "" : "mt-4 border-t border-ink-700 pt-3"}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="eyebrow text-[10px]">
          {season.partial ? `Rest of ${season.season}` : season.season}
        </span>
        <span className="text-[10px] text-chalk-600">
          {season.partial ? "while still on that roster" : "kept, and still on that roster"}
        </span>
      </div>
      {/* COLUMNS FOLLOW THE TRADE, not the data. In a keeper year usually only one
          side still holds anybody, and letting that table span both columns put
          it under the wrong owner — it belongs beneath the side it describes,
          with the other column simply empty. */}
      <div className={order.length === 2 ? "grid gap-x-3 gap-y-3 sm:grid-cols-2" : "space-y-3"}>
        {order.map((slug) => {
          const entries = rowsFor(slug);
          if (!entries.length) return <div key={slug} aria-hidden />;
          return (
            <div key={slug} className="min-w-0 overflow-x-auto">
              <div className="min-w-max text-[11px]">
                <div className="mb-0.5 text-[11px] font-semibold text-chalk-300">
                  {ownerNames[slug] ?? slug}
                </div>
                <div className="flex items-center gap-1 border-b border-ink-700 pb-1 text-[9px] font-bold uppercase tracking-wide text-chalk-600">
                  <span className="min-w-[4.5rem] flex-1">Player</span>
                  {/* `px-1` to match the padding the body cells carry on their
                      inner span, or every heading sits a quarter-rem right of the
                      column it labels. */}
                  {COLUMNS.map((c) => (
                    <span key={c.label} className={`${cell} px-1`} title={c.hint}>
                      {c.label}
                    </span>
                  ))}
                </div>
                {entries.map(([pid, stat, viaPick]) => (
                  <Row
                    key={pid}
                    label={players[pid]?.full_name ?? pid}
                    stat={stat}
                    cell={cell}
                    viaPick={viaPick}
                    onOpenTrade={onOpenTrade}
                  />
                ))}
                {Array.from({ length: rows - entries.length }, (_, i) => (
                  <div key={`pad-${i}`} className="py-0.5 text-[11px]" aria-hidden>
                    &nbsp;
                  </div>
                ))}
                <Row label="Total" stat={totalFor(slug)!} cell={cell} best={best} bold />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Column order, and which direction counts as better. */
const COLUMNS: ReadonlyArray<{ label: string; hint: string }> = [
  { label: "G", hint: "Games rostered, bench included" },
  { label: "GS", hint: "Games started" },
  { label: "Pts", hint: "Every point scored on this roster, started or benched" },
  { label: "Start", hint: "Points scored while started — points that counted" },
  { label: "/GS", hint: "Points per game started" },
  { label: "Bn/G", hint: "Points per game benched — what he scored while sitting" },
  { label: "Pts/G", hint: "Every point scored, per game rostered" },
];

/** The seven figures for one row, in column order. `null` where there is none. */
function statCells(stat: TradeStat): Array<{ value: number | null; text: string }> {
  const benched = stat.games - stat.started;
  const all = stat.startPoints + stat.benchPoints;
  const rate = (points: number, n: number) =>
    n ? { value: points / n, text: fmt.pts1(points / n) } : { value: null, text: "—" };
  return [
    { value: stat.games, text: String(stat.games) },
    { value: stat.started, text: String(stat.started) },
    { value: all, text: fmt.pts1(all) },
    { value: stat.startPoints, text: fmt.pts1(stat.startPoints) },
    rate(stat.startPoints, stat.started),
    rate(stat.benchPoints, benched),
    rate(all, stat.games),
  ];
}

/** Colour per column, so a row reads the same wherever it appears. */
const TONE = [
  "text-chalk-500",
  "text-chalk-400",
  "text-chalk-400",
  "text-chalk-100",
  "text-accent",
  "text-loss",
  "text-chalk-400",
];

function Row({
  label,
  stat,
  cell,
  best,
  viaPick = false,
  onOpenTrade,
  bold = false,
}: {
  label: string;
  stat: TradeStat;
  cell: string;
  /** Drafted with a pick from this trade rather than received in it. */
  viaPick?: boolean;
  onOpenTrade?: (tradeId: string) => void;
  /** Best value per column across sides. Totals rows only. */
  best?: Array<number | null>;
  bold?: boolean;
}) {
  const cells = statCells(stat);
  return (
    <div className={`flex items-center gap-1 py-0.5 ${bold ? "border-t border-ink-700" : ""}`}>
      <span
        className={`flex min-w-[4.5rem] flex-1 items-baseline gap-1 truncate ${
          bold ? "text-chalk-300" : "text-chalk-400"
        }`}
      >
        <span className="truncate">{label}</span>
        {viaPick ? (
          <Tip
            text="Drafted with a pick received in this trade"
            className="shrink-0 text-[9px] font-bold text-trade"
          >
            P
          </Tip>
        ) : null}
        {/* One glyph, because the name column is narrow and this is context
            rather than a finding. A modest return reads differently once you know
            he was cut in week 4. */}
        {stat.kept ? (
          // The ROUND is on the glyph, not hidden in the tooltip: "K12" says what
          // the contract cost, which is the whole point of noting the keep.
          <Tip
            text={`Kept in ${stat.kept.season} at round ${stat.kept.round}`}
            className="shrink-0 text-[9px] font-bold text-accent"
          >
            K{stat.kept.round}
          </Tip>
        ) : null}
        {stat.exit?.kind === "traded" && stat.exit.tradeId && onOpenTrade ? (
          // A traded-away player leads straight to another deal, so the glyph is
          // the way into it rather than just a label.
          <button
            type="button"
            onClick={() => onOpenTrade(stat.exit!.tradeId!)}
            title={`Traded away in week ${stat.exit.week} — see that trade`}
            className="shrink-0 text-[9px] text-trade transition-colors hover:text-chalk-100"
          >
            &#8644;
          </button>
        ) : stat.exit ? (
          // `Tip`, not a `title`: native tooltips take a second to appear and do
          // nothing at all on touch, and a glyph nobody can decode is worse than
          // no glyph. This one opens on hover, focus and tap.
          <Tip
            text={`${
              stat.exit.kind === "dropped" ? "Dropped" : "Traded away"
            } in week ${stat.exit.week}`}
            className={`shrink-0 text-[9px] ${
              stat.exit.kind === "dropped" ? "text-loss" : "text-trade"
            }`}
          >
            {stat.exit.kind === "dropped" ? "\u2717" : "\u21c4"}
          </Tip>
        ) : null}
      </span>
      {cells.map((c, i) => {
        // The colour stays on the cell and the highlight sits BEHIND THE TEXT
        // only, on an inner span — so the column keeps its meaning, the numbers
        // stay on their baseline, and the cell does not change width.
        const won = best?.[i] != null && c.value !== null && Math.abs(c.value - best[i]!) < 0.005;
        return (
          <span key={COLUMNS[i].label} className={`${cell} ${TONE[i]}`}>
            {/* EVERY cell carries the padding, not just the highlighted one.
                With it applied only to the winner, that number sat a quarter-rem
                left of the rest of its column — a small shift, but a column of
                right-aligned figures is exactly where it shows. */}
            <span className={`rounded-sm px-1 py-px ${won ? "bg-chalk-100/15" : ""}`}>
              {c.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}

