import { notFound } from "next/navigation";

import Link from "next/link";

import { BackLink } from "@/components/back-link";
import { TradeCard } from "@/components/trade-card";
import { TradeTreeSection } from "@/components/trade-tree-section";
import { EmptyState, Panel, PanelHeader, fmt } from "@/components/ui";
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
  const sides = tree.roots.filter((r) => r.nodes.length);
  const best = Math.max(0, ...sides.map((r) => r.total.startPoints));
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
          {assets ? (
            <span className="text-chalk-600">
              {" · "}
              {assets} asset{assets === 1 ? "" : "s"} in the chain, {tree.depth + 1} deep
            </span>
          ) : null}
        </p>
      </div>

      {/*
       * WHAT EACH SIDE GOT, before the deal itself. The old strip led with the
       * party count and the season, both of which the heading above already says
       * — so the first thing on the page answered a question nobody had.
       *
       * VOLUME AND RATE TOGETHER, and then by season. A side can win on total and
       * lose on rate (500 points off 100 starts against 100 off ten), and a total
       * cannot tell a one-year rental from a contract that paid for three. The
       * same three figures the tree's side headers carry, for the same reason.
       */}
      {sides.length ? (
        <div className={`grid gap-2.5 ${sides.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {sides.map((side) => {
            const lead = side.total.startPoints > 0 && side.total.startPoints === best;
            return (
              <div key={side.owner} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <Link
                    href={`/owners/${side.owner}/`}
                    data-owner={side.owner}
                    className="truncate text-sm font-semibold transition-colors hover:text-accent"
                  >
                    {ownerNames[side.owner] ?? side.owner}
                  </Link>
                  {lead && sides.length > 1 ? (
                    <span className="eyebrow shrink-0 text-[9px] text-chalk-600">Most returned</span>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="tabular text-xl font-semibold leading-none sm:text-2xl">
                    {fmt.pts1(side.total.startPoints)}
                  </span>
                  <span className="text-[11px] text-chalk-600">started pts</span>
                </div>
                <div className="mt-1 text-[11px] text-chalk-600">
                  {side.total.started ? (
                    <>
                      <span className="tabular">{side.total.started}</span> starts{" · "}
                      <span
                        className="tabular text-accent"
                        title="Started points per game started — what the trade returned each time it filled a lineup slot"
                      >
                        {fmt.pts1(side.total.startPoints / side.total.started)}/GS
                      </span>
                    </>
                  ) : (
                    "never started"
                  )}
                </div>
                {side.bySeason.length ? (
                  <dl className="mt-2.5 space-y-1 border-t border-ink-600 pt-2">
                    {side.bySeason.map((y) => (
                      <div key={y.season} className="flex items-baseline gap-2 text-[11px]">
                        <dt className="tabular w-9 shrink-0 text-chalk-600">{y.season}</dt>
                        <dd className="tabular flex-1 text-right font-semibold text-chalk-100">
                          {fmt.pts1(y.stat.startPoints)}
                        </dd>
                        <dd className="tabular w-12 shrink-0 text-right text-chalk-600">
                          {y.stat.started} GS
                        </dd>
                        <dd className="tabular w-14 shrink-0 text-right text-accent">
                          {y.stat.started ? `${fmt.pts1(y.stat.startPoints / y.stat.started)}/GS` : "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

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
          showTreeLink={false}
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
