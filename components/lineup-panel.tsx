import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import { Col, ListHeader, Panel, PanelHeader, fmt } from "@/components/ui";
import type { PlayerWeekState } from "@/lib/live/types";

/**
 * One team's lineup, as a panel.
 *
 * THE ONE RENDERER FOR TWO SOURCES. The finished matchup page builds these rows
 * from committed data; the live preview builds them from the provider. They are
 * the same object on screen — a reader should not have to relearn the page on
 * Tuesday when the archive catches up — and two copies would have drifted on
 * the first spacing tweak.
 *
 * It knows nothing about where the rows came from. No hooks, no fetching, no
 * player resolution: the caller does all of that and hands over finished rows,
 * which is what lets a server component and a client component share it.
 */

export interface LineupRow {
  /** React key. A Sleeper player id where there is one; anything unique otherwise. */
  id: string;
  /**
   * The slot this player filled, e.g. "FLEX". Null when the source cannot say —
   * a live provider names the lineup but not the slot ordering — and the column
   * disappears entirely when NO row has one, rather than leaving a blank gutter.
   */
  slot: string | null;
  started: boolean;
  name: string;
  position: string | null;
  team: string | null;
  points: number;
  /** Player page, or null where the site has no page for them. */
  href: string | null;
  /** A record chip on the row, e.g. "#1 player week". */
  mark?: { short: string; full: string } | null;
  /**
   * What this player's week is doing, when the caller can tell.
   *
   * UNDEFINED IS THE ARCHIVED CASE and renders exactly as it always did — a
   * finished game has no states to distinguish, every player's week is over.
   */
  state?: PlayerWeekState | null;
  /**
   * This player's projected final, while he still has football left.
   *
   * Set only for a player whose game is unfinished — once it ends the
   * projection IS the score and printing both says nothing. Absent on an
   * archived lineup, where every game is over by definition.
   */
  projected?: number | null;
}

/**
 * How each state reads in the points column.
 *
 * THE NUMBER IS REPLACED where it would be a lie by omission. "0.00" against a
 * player on a bye, or one whose team played without him, is true and useless —
 * it looks identical to a player who took the field and did nothing, which is
 * the one case that is actually his fault. Where he has played, the number
 * stands and the STATE is carried by colour instead.
 */
const STATE: Record<PlayerWeekState, { label: string | null; tone: string; title: string }> = {
  bye: { label: "BYE", tone: "text-chalk-600", title: "On a bye this week" },
  upcoming: { label: "—", tone: "text-chalk-600", title: "Has not played yet" },
  // NOT GREEN. The accent already means "best starter of this lineup" one row
  // up, and two different greens in one column is one green too many. Being
  // mid-game is carried by the pulsing dot alone, which nothing else uses here.
  live: { label: null, tone: "text-chalk-300", title: "Playing right now" },
  dnp: { label: "DNP", tone: "text-chalk-600", title: "His team played; he did not" },
  final: { label: null, tone: "text-chalk-300", title: "Final" },
};

export function LineupPanel({
  title,
  meta,
  rows,
  emptyLabel,
  benchLabel,
}: {
  title: string;
  /** Sits beside the title — "121.34 from starters", or a running total. */
  meta: string;
  rows: LineupRow[];
  emptyLabel: string;
  /** How the collapsed bench summarises itself. Given the count and its total. */
  benchLabel: (count: number, points: number) => string;
}) {
  const starters = rows.filter((r) => r.started);
  const bench = rows.filter((r) => !r.started);
  const benchTotal = bench.reduce((t, r) => t + r.points, 0);
  // THE COLUMN GOES AWAY WHEN NOTHING FILLS IT. A live lineup has no slot
  // ordering, and a permanently empty 10-wide gutter reads as a broken table.
  const showSlots = rows.some((r) => r.slot);
  const best = Math.max(0, ...starters.map((r) => r.points));

  if (!rows.length) {
    return (
      <Panel>
        <PanelHeader title={title} meta={meta} />
        <div className="px-4 py-8 text-center text-xs text-chalk-600 sm:px-5">{emptyLabel}</div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title={title} meta={meta} />
      <ListHeader>
        {showSlots ? <Col className="w-10 shrink-0">Slot</Col> : null}
        <Col className="w-8 shrink-0 text-center">Pos</Col>
        <Col className="flex-1">Player</Col>
        <Col className="w-20 shrink-0 text-right" hint="Fantasy points scored in this game">
          Pts
        </Col>
      </ListHeader>
      <div className="divide-y divide-ink-700">
        {starters.map((r) => (
          <Row key={r.id} row={r} showSlots={showSlots} best={best} />
        ))}
      </div>

      {bench.length ? (
        <details className="group border-t border-ink-600">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] text-chalk-600 transition-colors hover:bg-ink-700/40 sm:px-5">
            <span>{benchLabel(bench.length, benchTotal)}</span>
            <span className="transition-transform group-open:rotate-90">▸</span>
          </summary>
          {/* Dimmed as a block rather than per row: bench points scored nobody
              anything, and the whole section is the aside. */}
          <div className="divide-y divide-ink-700 bg-ink-850/60 opacity-70">
            {[...bench]
              .sort((a, b) => b.points - a.points)
              .map((r) => (
                <Row key={r.id} row={r} showSlots={showSlots} best={best} />
              ))}
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

/**
 * The points, and what state they are in.
 *
 * BEST-STARTER EMPHASIS STILL WINS over a state tone: it is the louder fact
 * about a finished lineup, and the only state it can collide with is `final`,
 * which is the plain one anyway.
 */
function PointsCell({ row, best }: { row: LineupRow; best: number }) {
  const st = row.state ? STATE[row.state] : null;
  const isBest = row.started && row.points === best && best > 0;
  const tone = isBest ? "font-bold text-accent" : (st?.tone ?? "text-chalk-300");

  return (
    <span
      title={st?.title}
      className={`tabular flex w-20 shrink-0 items-center justify-end gap-1 text-right text-sm ${tone}`}
    >
      {/* A pulsing dot rather than a word: the column is 14 wide and already
          carries a number, and this is the same signal the rest of the site
          uses for something still moving. */}
      {row.state === "live" ? (
        <span className="live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      ) : null}
      {/*
        THE PROJECTION SITS TO THE LEFT OF THE SCORE, dimmer and smaller. The
        score stays hard against the right edge where the column aligns and
        where the eye already looks for it; the projection leans in beside it
        rather than pushing it off its line.

        Only while the player has football left: afterwards the two are the
        same figure and the second one is noise.
      */}
      {row.projected != null ? (
        <span
          title={`Projected final: ${fmt.pts(row.projected)}`}
          className="tabular shrink-0 text-[10px] font-normal leading-none text-chalk-600"
        >
          {fmt.pts(row.projected)}
        </span>
      ) : null}
      {st?.label ?? fmt.pts(row.points)}
    </span>
  );
}

function Row({
  row,
  showSlots,
  best,
}: {
  row: LineupRow;
  showSlots: boolean;
  best: number;
}) {
  const body = (
    <>
      {row.name}
      {row.team ? <span className="ml-1.5 text-[11px] text-chalk-600">{row.team}</span> : null}
      {/* ON THE ROW, not only in the badge strip at the top. The strip names the
          player in prose, so finding him in a 17-man lineup meant reading both
          and matching by eye. */}
      {row.mark ? (
        <span
          title={row.mark.full}
          className="ml-1.5 whitespace-nowrap rounded border border-gold/50 bg-gold/10 px-1 py-px align-middle text-[9px] font-bold uppercase tracking-wide text-gold"
        >
          {row.mark.short}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 sm:px-4">
      {showSlots ? (
        row.slot ? (
          <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
            {row.slot}
          </span>
        ) : (
          <span className="w-10 shrink-0" />
        )
      ) : null}
      <PositionPill position={row.position} />
      {/* LINKED ONLY WHERE A PAGE EXISTS. `/players/<id>/` is generated per key
          of the baked index, so a player the site has never referenced — a
          rookie drafted this week, typically — stays plain text. */}
      {row.href ? (
        <Link
          href={row.href}
          className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent"
        >
          {body}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{body}</span>
      )}
      <PointsCell row={row} best={best} />
    </div>
  );
}
