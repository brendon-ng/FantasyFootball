import Link from "next/link";

import { fmt } from "@/components/ui";
import type { TreeNode, TradeTree } from "@/lib/trade-tree";
import type { PlayerMeta, TradeStat } from "@/lib/types";

/**
 * A trade followed all the way down, one column per side.
 *
 * NESTED CARDS RATHER THAN A DRAWN GRAPH. The instinct is an SVG canvas with
 * curved edges, and it would be mostly empty: the deepest lineage in league
 * history is four levels and the largest holds eight assets. At that size a
 * node-link diagram spends its pixels on whitespace and loses to indentation,
 * which also reflows on a phone and needs no layout maths.
 *
 * TIME LIVES ON THE NODE, not on an axis. A spell can span three seasons, so a
 * shared time axis would either stretch every node into a bar or force one row
 * per season. The per-season chips say when, and the tree says what came from
 * what — which is the question being asked.
 */
export function TradeTreeView({
  tree,
  players,
  ownerNames,
  onOpenTrade,
}: {
  tree: TradeTree;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  /** Opens the deal a node was traded on in. Absent renders a plain badge. */
  onOpenTrade?: (tradeId: string) => void;
}) {
  const sides = tree.roots.filter((r) => r.nodes.length);
  if (!sides.length) return null;

  return (
    <div className={sides.length === 2 ? "grid gap-5 lg:grid-cols-2" : "space-y-5"}>
      {sides.map((side) => (
        <div key={side.owner} className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-600 pb-1.5">
            <Link
              href={`/owners/${side.owner}/`}
              data-owner={side.owner}
              className="text-sm font-semibold transition-colors hover:text-accent"
            >
              {ownerNames[side.owner] ?? side.owner}
            </Link>
            {/* VOLUME AND RATE TOGETHER. 500 points off 100 starts and 100 off
                ten are not the same trade, and the total alone cannot tell them
                apart — the second team got the same return from a tenth of the
                lineup slots. */}
            <span className="text-[11px] text-chalk-600">
              <span className="tabular font-semibold text-chalk-100">
                {fmt.pts1(side.total.startPoints)}
              </span>{" "}
              pts
              {side.total.started ? (
                <>
                  {" · "}
                  <span className="tabular">{side.total.started}</span> starts
                  {" · "}
                  <span
                    className="tabular text-accent"
                    title="Started points per game started — what the trade returned each time it filled a lineup slot"
                  >
                    {fmt.pts1(side.total.startPoints / side.total.started)}/GS
                  </span>
                </>
              ) : null}
            </span>
          </div>
          {/* Only when there is a FIGURE to give. When nothing traces purely to
              this trade the sentence was three lines of prose carrying no number,
              and the ·mixed badges on the nodes below already say why. */}
          {side.pure.startPoints !== side.total.startPoints && side.pure.startPoints > 0 ? (
            // Named, not just numbered: "traceable" says which of the two figures
            // is the strict one, where "unmixed" read as a different statistic.
            <p className="mb-2 text-[10px] leading-snug text-chalk-600">
              <span className="tabular text-chalk-400">{fmt.pts1(side.pure.startPoints)}</span> of
              those points trace purely to this trade; the rest came through a later deal that also
              sent out assets from elsewhere.
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {side.nodes.map((n) => (
              <Branch
                key={n.id}
                node={n}
                players={players}
                ownerNames={ownerNames}
                onOpenTrade={onOpenTrade}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Branch({
  node,
  players,
  ownerNames,
  onOpenTrade,
}: {
  node: TreeNode;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
}) {
  return (
    <li>
      <NodeCard node={node} players={players} ownerNames={ownerNames} onOpenTrade={onOpenTrade} />
      {node.children.length ? (
        // The rail is the edge. A left border plus indentation says "these came
        // from that" as clearly as a drawn line, and survives a narrow column.
        <ul className="ml-2 space-y-1.5 border-l border-ink-600 pl-3 pt-1.5">
          {node.children.map((c) => (
            <Branch
              key={c.id}
              node={c}
              players={players}
              ownerNames={ownerNames}
              onOpenTrade={onOpenTrade}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function NodeCard({
  node,
  players,
  ownerNames,
  onOpenTrade,
}: {
  node: TreeNode;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const meta = node.playerId ? players[node.playerId] : undefined;
  const label =
    node.kind === "pick" && node.pick
      ? `${node.pick.season} ${ordinal(node.pick.round)}`
      : (meta?.full_name ?? node.playerId ?? "—");
  const from =
    node.kind === "pick" && node.pick?.originalSlug
      ? (ownerNames[node.pick.originalSlug] ?? node.pick.originalSlug).split(" ")[0]
      : null;

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-[10px] font-bold uppercase ${node.kind === "pick" ? "text-trade" : "text-chalk-600"}`}>
          {node.kind === "pick" ? "Pick" : (meta?.position ?? "—")}
        </span>
        {node.playerId ? (
          <Link
            href={`/players/${node.playerId}/`}
            className="text-[13px] font-medium transition-colors hover:text-accent"
          >
            {label}
          </Link>
        ) : (
          <span className="text-[13px] font-medium">{label}</span>
        )}
        {from ? <span className="text-[10px] text-chalk-600">({from}&apos;s)</span> : null}
        <Ending node={node} onOpenTrade={onOpenTrade} />
      </div>
      {node.ended.kind === "traded" && node.ended.alsoSent?.length ? (
        <div className="mt-1 text-[10px] leading-snug text-chalk-600">
          <span className="text-chalk-500">Sent with it:</span>{" "}
          {node.ended.alsoSent
            .map((a) =>
              a.kind === "player"
                ? (players[a.playerId ?? ""]?.full_name ?? a.playerId ?? "?")
                : a.kind === "pick" && a.pick
                  ? `${a.pick.season} ${ordinal(a.pick.round)}`
                  : `$${a.amount} FAAB`,
            )
            .join(", ")}
        </div>
      ) : null}
      {node.bySeason.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {node.bySeason.map((s) => (
            <span
              key={s.season}
              className="tabular rounded bg-ink-700 px-1.5 py-px text-[10px] text-chalk-400"
              title={`${s.stat.started} started, ${fmt.pts1(s.stat.startPoints)} points`}
            >
              {s.season}{" "}
              <span className="font-semibold text-chalk-100">{fmt.pts1(s.stat.startPoints)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** How the spell finished — the part that says whether it is still paying. */
function Ending({
  node,
  onOpenTrade,
}: {
  node: TreeNode;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const e = node.ended;
  const base = "ml-auto shrink-0 rounded border px-1 text-[9px] font-bold uppercase tracking-wide";
  if (e.kind === "traded") {
    const label = `Traded ${e.season}${e.diluted ? " ·mixed" : ""}`;
    const title = e.diluted
      ? `Traded on in ${e.season} week ${e.week}. That deal also sent out assets from outside this lineage, so what came back is not purely attributable to this trade. Click to see it.`
      : `Traded on in ${e.season} week ${e.week} — click to see that deal`;
    // The badge names another trade, so it IS the way into it.
    return onOpenTrade ? (
      <button
        type="button"
        onClick={() => onOpenTrade(e.tradeId)}
        title={title}
        className={`${base} border-trade/50 text-trade transition-colors hover:border-trade hover:bg-trade/10`}
      >
        {label}
      </button>
    ) : (
      <span className={`${base} border-trade/50 text-trade`} title={title}>
        {label}
      </span>
    );
  }
  if (e.kind === "drafted") {
    // Straight to the board it was made on, which shows the picks around it.
    return (
      <Link
        href={`/history/${e.season}/draft/`}
        title={`Used at ${e.round}.${String(e.slot).padStart(2, "0")} — see the ${e.season} draft board`}
        className={`${base} border-accent-dim/60 text-accent transition-colors hover:border-accent hover:bg-accent/10`}
      >
        {e.round}.{String(e.slot).padStart(2, "0")}
      </Link>
    );
  }
  if (e.kind === "dropped") {
    return (
      <span className={`${base} border-loss/50 text-loss`} title={`Dropped in week ${e.week}`}>
        Dropped {e.season}
      </span>
    );
  }
  if (e.kind === "expired") {
    return (
      <span className={`${base} border-ink-500 text-chalk-500`} title="Not kept the following season">
        Not kept
      </span>
    );
  }
  // A pick with no ending is one whose draft has not happened. "Held" is the
  // label for a player still on a roster and says the wrong thing about a pick.
  if (node.kind === "pick") {
    return (
      <span className={`${base} border-ink-500 text-chalk-500`} title="That draft has not happened yet">
        Undrafted
      </span>
    );
  }
  return (
    <span className={`${base} border-ink-500 text-chalk-500`} title="Still on the roster">
      Held
    </span>
  );
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const emptyStat = (): TradeStat => ({
  games: 0,
  started: 0,
  startPoints: 0,
  benchPoints: 0,
});
