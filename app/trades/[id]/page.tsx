import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { TradeCard } from "@/components/trade-card";
import { TradeTreeSection } from "@/components/trade-tree-section";
import { EmptyState, Panel, PanelHeader, Stat } from "@/components/ui";
import {
  getOwnerMap,
  getPickHandoffs,
  getPickOutcomes,
  getPlayers,
  getTradeReturns,
  getTrades,
  pageTitle,
} from "@/lib/data";
import { buildTradeTree } from "@/lib/trade-tree";

// Static export: a page per trade, generated at build time.
export const dynamicParams = false;

export function generateStaticParams() {
  return getTrades().map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trade = getTrades().find((t) => t.id === id);
  return { title: pageTitle(trade ? `${trade.season} Trade` : "Trade") };
}

/**
 * One trade, and everything it turned into.
 *
 * A PAGE RATHER THAN THE MODAL. The modal is the right size for "who got what
 * and how did it go that season"; a lineage running four deep needs room, and
 * wants to be linkable — this is the page you send someone when you are arguing
 * about a trade from two years ago.
 */
export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trade = getTrades().find((t) => t.id === id);
  if (!trade) notFound();

  const players = getPlayers();
  const owners = getOwnerMap();
  const ownerNames = Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]));
  const tree = buildTradeTree(trade);

  const assets = tree.roots.reduce((n, r) => n + count(r.nodes), 0);
  const best = [...tree.roots].sort((a, b) => b.total.startPoints - a.total.startPoints)[0];
  const mixed = tree.roots.some((r) => r.nodes.some(anyDiluted));

  return (
    <div className="space-y-5 sm:space-y-6">
      <BackLink fallback={{ href: "/trades/", label: "Trades" }} />

      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {trade.season} {trade.preseason ? "Preseason" : `Week ${trade.week}`} Trade
        </h1>
        <p className="mt-1 text-sm text-chalk-500">
          {trade.ownerSlugs.map((s) => ownerNames[s] ?? s).join(" · ")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Assets in the chain" value={assets} sub={`${tree.depth + 1} deep`} />
        <Stat
          label="Most returned"
          value={
            <span className="text-base sm:text-lg">
              {best ? (ownerNames[best.owner] ?? best.owner).split(" ")[0] : "—"}
            </span>
          }
          sub={best ? `${best.total.startPoints.toFixed(1)} started pts` : undefined}
          tone="accent"
        />
        <Stat
          label="Parties"
          value={trade.ownerSlugs.length}
          sub={trade.ownerSlugs.length > 2 ? "multi-team" : undefined}
        />
        <Stat label="Season" value={trade.season} sub={trade.preseason ? "preseason" : `week ${trade.week}`} />
      </div>

      <Panel>
        <PanelHeader title="The Deal" meta="as agreed" />
        <TradeCard
          trade={trade}
          players={players}
          ownerNames={ownerNames}
          outcomes={getPickOutcomes()}
          returns={getTradeReturns()[trade.id]}
          handoffs={getPickHandoffs()}
          showSeason={false}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Trade Tree"
          meta={tree.depth ? `${tree.depth + 1} generations` : "nothing moved on"}
          legend={
            mixed
              ? "Follows every asset until it leaves for good: traded on, drafted, kept, or dropped. A deal marked ·mixed also sent out assets from outside this lineage — what it sent is named on the node, and each side says how much of its return traces purely to this trade."
              : "Follows every asset until it leaves for good: traded on, drafted, kept, or dropped."
          }
        />
        <div className="p-4 sm:p-5">
          {assets ? (
            <TradeTreeSection
              trade={trade}
              tree={tree}
              players={players}
              ownerNames={ownerNames}
              outcomes={getPickOutcomes()}
              returns={getTradeReturns()}
              handoffs={getPickHandoffs()}
              allTrades={Object.fromEntries(getTrades().map((t) => [t.id, t]))}
            />
          ) : (
            <EmptyState>
              Nothing to follow — this trade moved only FAAB, which is spent rather than held.
            </EmptyState>
          )}
        </div>
      </Panel>
    </div>
  );
}

const count = (nodes: Array<{ children: unknown[] }>): number =>
  nodes.reduce((n, x) => n + 1 + count(x.children as Array<{ children: unknown[] }>), 0);

const anyDiluted = (n: {
  ended: { kind: string; diluted?: boolean };
  children: unknown[];
}): boolean =>
  (n.ended.kind === "traded" && Boolean(n.ended.diluted)) ||
  (n.children as Array<Parameters<typeof anyDiluted>[0]>).some(anyDiluted);
