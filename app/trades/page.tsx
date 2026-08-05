import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { TradeCard } from "@/components/trade-card";
import { EmptyState, Panel, PanelHeader, Stat } from "@/components/ui";
import { getOwnerMap, getPickOutcomes, getPlayers, getTrades } from "@/lib/data";

export const metadata: Metadata = { title: "Trades" };

/**
 * Every trade the league has ever made, newest first.
 *
 * Grouped by season rather than listed flat: a trade's meaning is bound up in
 * when it happened, and "week 9, 2021" says more next to that year's other deals
 * than it does in a single scroll of seven seasons.
 */
export default function TradesPage() {
  const trades = getTrades();
  const players = getPlayers();
  const owners = getOwnerMap();
  const outcomes = getPickOutcomes();
  const ownerNames = Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]));

  const bySeason = new Map<number, typeof trades>();
  for (const t of [...trades].reverse()) {
    bySeason.set(t.season, [...(bySeason.get(t.season) ?? []), t]);
  }

  const players_ = trades.reduce((n, t) => n + t.legs.filter((l) => l.kind === "player").length, 0);
  const picks = trades.reduce((n, t) => n + t.legs.filter((l) => l.kind === "pick").length, 0);
  const multi = trades.filter((t) => t.ownerSlugs.length > 2).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <BackLink fallback={{ href: "/history/", label: "History" }} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trades</h1>
        <p className="mt-1 text-sm text-chalk-500">
          Every completed trade in league history. Vetoed and withdrawn offers are not
          included — only deals that actually took effect.
        </p>
      </div>

      {trades.length ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Trades" value={trades.length} />
            <Stat label="Players moved" value={players_} />
            <Stat label="Picks moved" value={picks} />
            <Stat
              label="Multi-team"
              value={multi}
              sub={multi ? "three or more parties" : undefined}
            />
          </div>

          {[...bySeason.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([season, list]) => (
              <Panel key={season}>
                <PanelHeader
                  title={`${season}`}
                  meta={`${list.length} trade${list.length === 1 ? "" : "s"}`}
                  href={`/history/${season}/`}
                  hrefLabel="Season detail"
                />
                {list.map((t) => (
                  <TradeCard
                    key={t.id}
                    trade={t}
                    players={players}
                    ownerNames={ownerNames}
                    outcomes={outcomes}
                    showSeason={false}
                  />
                ))}
              </Panel>
            ))}
        </>
      ) : (
        <Panel>
          <EmptyState>No trades on record yet.</EmptyState>
        </Panel>
      )}
    </div>
  );
}
