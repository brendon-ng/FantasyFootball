import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import { Col, ListHeader, Panel, PanelHeader, fmt } from "@/components/ui";

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
}

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
        <Col className="w-14 shrink-0 text-right" hint="Fantasy points scored in this game">
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
      <span
        className={`tabular w-14 shrink-0 text-right text-sm ${
          row.started && row.points === best && best > 0
            ? "font-bold text-accent"
            : "text-chalk-300"
        }`}
      >
        {fmt.pts(row.points)}
      </span>
    </div>
  );
}
