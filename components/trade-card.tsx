import Link from "next/link";

import { fmt } from "@/components/ui";
import type {
  DraftPickRecord,
  PlayerMeta,
  Trade,
  TradeLeg,
  TradeReturn,
  TradeStat,
} from "@/lib/types";

/**
 * One trade, grouped by who RECEIVED what.
 *
 * BY RECIPIENT, NOT BY SENDER. "What did I get" is the question people actually
 * ask, and it is the only framing that survives a three-team deal: Den Ops has
 * one where David sends picks to two different owners while receiving a player
 * from a third, which no "A gave X for Y" layout can state without lying.
 *
 * A column per party, so a two-team trade reads as the familiar two sides and a
 * three-team trade simply has three columns rather than a different component.
 */
export function TradeCard({
  trade,
  players,
  ownerNames,
  outcomes = {},
  returns,
  showSeason = true,
  onOpen,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  /** What each traded pick became, keyed `season:round:originalOwner`. */
  outcomes?: Record<string, DraftPickRecord>;
  /** What each side got for the rest of that season, by owner slug. */
  returns?: Record<string, TradeReturn>;
  showSeason?: boolean;
  /** Set in a list, where the detail lives behind a click rather than inline. */
  onOpen?: () => void;
}) {
  const name = (slug: string | null) => (slug && ownerNames[slug]) || "—";

  // Every party gets a column even if they only sent — a team that received
  // nothing still took part, and omitting them makes the trade unreadable.
  const received = new Map<string, TradeLeg[]>(trade.ownerSlugs.map((s) => [s, []]));
  for (const leg of trade.legs) {
    if (leg.toSlug && received.has(leg.toSlug)) received.get(leg.toSlug)!.push(leg);
  }

  return (
    <div
      className={`border-b border-ink-700 px-4 py-3 last:border-0 sm:px-5 ${
        // Dimmed, because none of it happened. Still legible — it is a real thing
        // the league did and then undid — but it must not read as a result.
        trade.vetoed ? "opacity-60" : ""
      }`}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] text-chalk-600">
        {showSeason ? (
          <Link
            href={`/history/${trade.season}/`}
            className="font-semibold text-chalk-400 transition-colors hover:text-accent"
          >
            {trade.season}
          </Link>
        ) : null}
        <span>{trade.preseason ? "Preseason" : `Week ${trade.week}`}</span>
        {trade.vetoed ? (
          <span className="rounded border border-loss/60 bg-loss/10 px-1 text-[9px] font-bold uppercase tracking-wide text-loss">
            Vetoed
          </span>
        ) : null}
        {trade.ownerSlugs.length > 2 ? (
          <span className="rounded border border-me-dim px-1 text-[9px] font-bold uppercase tracking-wide text-me">
            {trade.ownerSlugs.length}-team
          </span>
        ) : null}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="ml-auto shrink-0 text-[11px] text-chalk-500 transition-colors hover:text-accent"
          >
            Details <span aria-hidden>→</span>
          </button>
        ) : null}
      </div>

      <div
        className="grid gap-2.5 sm:gap-4"
        style={{
          // A column per party. Inline because the count is dynamic, and a
          // `repeat(var(--n), …)` template is invalid — browsers reject a var()
          // as a repeat count and drop the whole declaration.
          gridTemplateColumns: `repeat(${Math.min(trade.ownerSlugs.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {trade.ownerSlugs.map((slug) => (
          <div key={slug} className="min-w-0">
            <Link
              href={`/owners/${slug}/`}
              data-owner={slug}
              className="block truncate text-sm font-semibold transition-colors hover:text-accent"
            >
              {name(slug)}
            </Link>
            <ul className="mt-1 space-y-0.5">
              {received.get(slug)!.length ? (
                received.get(slug)!.map((leg, i) => (
                  <li key={i} className="text-[13px] leading-snug text-chalk-300">
                    <LegText
                      leg={leg}
                      players={players}
                      ownerNames={ownerNames}
                      outcomes={outcomes}
                    />
                  </li>
                ))
              ) : (
                <li className="text-[13px] text-chalk-600">nothing</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      {returns ? <RestOfSeason trade={trade} players={players} ownerNames={ownerNames} returns={returns} /> : null}
    </div>
  );
}

/**
 * How the incoming players actually did, for the rest of that season.
 *
 * THE NEAREST THING TO "WHO WON", and deliberately not a verdict. It counts what
 * the players returned and nothing else: a pick pays off in a different season,
 * and a team that traded for a position it was short of may have won a deal it
 * lost on points.
 *
 * A TABLE AT THE FOOT rather than a line under each player. Hung off the legs it
 * doubled the height of every row and buried the deal itself.
 *
 * SIDE BY SIDE FOR A TWO-TEAM TRADE, under the columns the players are listed in,
 * so each side's return sits beneath that side. Three or more parties STACK: a
 * third column leaves nothing for the names, and a three-way is read one leg at a
 * time anyway.
 *
 * Per player AND totalled: a two-for-two where one player carried the whole
 * return is a different deal from one where both did, and a total hides that.
 */
function RestOfSeason({
  trade,
  players,
  ownerNames,
  returns,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  returns: Record<string, TradeReturn>;
}) {
  const sides = trade.ownerSlugs.filter((s) => Object.keys(returns[s]?.byPlayer ?? {}).length);
  if (!sides.length) return null;

  const cell = "tabular w-9 shrink-0 text-right";
  // Padded to the longest side so the Total rows sit on the same line. Comparing
  // two totals that are three rows apart vertically is the thing this table
  // exists to make easy, and ragged columns undo it.
  const rows = Math.max(...sides.map((s) => Object.keys(returns[s].byPlayer).length));

  /**
   * The highest figure in each column across the sides, for the TOTALS only.
   *
   * Greater wins in every column, bench rate included. It is tempting to invert
   * that one as a cost, but a high bench rate here means the player was scoring
   * while he sat — which is the owner's usage, not the trade's return, and this
   * table is about what the players did. A tie marks both, since neither side
   * came out ahead.
   */
  const totals = sides.map((s) => statCells(returns[s].total));
  const best = COLUMNS.map((_, i) => {
    const values = totals.map((t) => t[i].value).filter((v): v is number => v !== null);
    return values.length < 2 ? null : Math.max(...values);
  });

  return (
    <div className="mt-3 border-t border-ink-700 pt-2">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="eyebrow text-[10px]">Rest of {trade.season}</span>
        <span className="text-[10px] text-chalk-600">while still on that roster</span>
      </div>
      <div className={sides.length === 2 ? "grid gap-x-6 gap-y-3 sm:grid-cols-2" : "space-y-3"}>
        {sides.map((slug) => {
          const r = returns[slug];
          const ids = Object.keys(r.byPlayer);
          return (
            <div key={slug} className="min-w-0 overflow-x-auto">
              <div className="min-w-max text-[11px]">
                <div className="mb-0.5 text-[11px] font-semibold text-chalk-300">
                  {ownerNames[slug] ?? slug}
                </div>
                <div className="flex items-center gap-2 border-b border-ink-700 pb-1 text-[9px] font-bold uppercase tracking-wide text-chalk-600">
                  <span className="min-w-[6rem] flex-1">Player</span>
                  {COLUMNS.map((c) => (
                    <span key={c.label} className={cell} title={c.hint}>
                      {c.label}
                    </span>
                  ))}
                </div>
                {ids.map((pid) => (
                  <Row key={pid} label={players[pid]?.full_name ?? pid} stat={r.byPlayer[pid]} cell={cell} />
                ))}
                {/* Blank rows so this side ends level with the other. */}
                {Array.from({ length: rows - ids.length }, (_, i) => (
                  <div key={`pad-${i}`} className="py-0.5 text-[11px]" aria-hidden>
                    &nbsp;
                  </div>
                ))}
                <Row label="Total" stat={r.total} cell={cell} best={best} bold />
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
  bold = false,
}: {
  label: string;
  stat: TradeStat;
  cell: string;
  /** Best value per column across sides. Totals rows only. */
  best?: Array<number | null>;
  bold?: boolean;
}) {
  const cells = statCells(stat);
  return (
    <div className={`flex items-center gap-2 py-0.5 ${bold ? "border-t border-ink-700 font-semibold" : ""}`}>
      <span className={`min-w-[6rem] flex-1 truncate ${bold ? "text-chalk-300" : "text-chalk-400"}`}>
        {label}
      </span>
      {cells.map((c, i) => {
        // Emphasis is ADDED to the column's colour, never instead of it. A pill
        // background replaced the tone, so the green start-rate and the red
        // bench-rate turned plain grey exactly on the row where they matter most
        // — and it padded the cell out of line with the rows above.
        const won = best?.[i] != null && c.value !== null && Math.abs(c.value - best[i]!) < 0.005;
        return (
          <span
            key={COLUMNS[i].label}
            className={`${cell} ${TONE[i]} ${won ? "font-bold brightness-125" : ""}`}
          >
            {c.text}
          </span>
        );
      })}
    </div>
  );
}

/** "Ja'Marr Chase", "2026 4th (Reagan's)", "$12 FAAB". */
function LegText({
  leg,
  players,
  ownerNames,
  outcomes,
}: {
  leg: TradeLeg;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
}) {
  if (leg.kind === "faab") {
    return <span className="text-accent">${leg.amount} FAAB</span>;
  }
  if (leg.kind === "pick") {
    const p = leg.pick!;
    // WHOSE pick it originally is, not who sent it. A pick can change hands more
    // than once, and "Reagan's 2026 4th" is how the league refers to it however
    // many owners it has passed through.
    const from = p.originalSlug ? (ownerNames[p.originalSlug] ?? p.originalSlug) : null;
    // Absent until that draft has actually run — a pick traded for a future year
    // has no outcome, and guessing one would be inventing history.
    const became = outcomes[`${p.season}:${p.round}:${p.originalSlug}`];
    // WHO ACTUALLY PICKED, when it is not the team that received it here. A pick
    // can be traded again afterwards, so the receiver is not always the user, and
    // "we got their 9th" reads very differently once you know it was flipped on.
    const usedBy =
      became && became.ownerSlug && became.ownerSlug !== leg.toSlug
        ? (ownerNames[became.ownerSlug] ?? became.ownerSlug)
        : null;
    return (
      <span className="block">
        {p.season} {`${p.round}${ordinal(p.round)}`}
        {from ? <span className="text-chalk-600"> ({from.split(" ")[0]}&apos;s)</span> : null}
        {became ? (
          /* Indented under its pick with a turnstile, so it reads as a note ABOUT
             the line above rather than another thing received. Without either cue
             a two-line leg looks like two legs. */
          <span className="mt-0.5 flex gap-1 pl-2 text-[11px] leading-snug text-chalk-600">
            <span aria-hidden className="shrink-0 text-chalk-700">
              &#8627;
            </span>
            <span className="min-w-0">
            <span className="tabular">
              {became.round}.{String(became.draftSlot).padStart(2, "0")}
            </span>{" "}
            <Link
              href={`/players/${became.playerId}/`}
              className="transition-colors hover:text-accent"
            >
              {players[became.playerId]?.full_name ?? became.playerId}
            </Link>
            {usedBy ? (
              <>
                {" "}
                <span className="text-loss">· picked by {usedBy.split(" ")[0]}</span>
              </>
            ) : null}
            </span>
          </span>
        ) : null}
      </span>
    );
  }
  const meta = players[leg.playerId!];
  return (
    <span className="block">
      <Link href={`/players/${leg.playerId}/`} className="transition-colors hover:text-accent">
        {meta?.full_name ?? leg.playerId}
        {meta?.position ? (
          <span className="ml-1 text-[11px] text-chalk-600">{meta.position}</span>
        ) : null}
      </Link>
    </span>
  );
}

const ordinal = (n: number): string =>
  n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
