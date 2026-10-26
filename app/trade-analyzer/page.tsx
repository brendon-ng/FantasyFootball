import { TradeAnalyzer } from "@/components/trade-analyzer";
import { EmptyState, Panel } from "@/components/ui";

import {
  getLeagueRefs,
  getLiveSeason,
  getOwners,
  getPlayers,
  getRosterPositions,
  getSeasonFormat,
  getUserIdToSlug,
  pageTitle,
} from "@/lib/data";

export const generateMetadata = () => ({ title: pageTitle("Trade Analyzer") });

/**
 * Trade Analyzer — what a hypothetical trade does to the rest of the season.
 *
 * NOT LINKED FROM THE NAV, for the reason /lab is not: every tab up there is a
 * record of what the league has done, and this is a scratchpad of what it has
 * not. Reaching it means typing the path.
 *
 * EVERYTHING THAT MOVES IS FETCHED IN THE BROWSER — rosters, records, the
 * schedule and every remaining week's projections — so a trade is weighed
 * against the league as it stands right now rather than as of the last deploy.
 * The build supplies only what is settled: the season's format, its lineup
 * shape and who the owners are.
 *
 * BOTH PROVIDERS. A Sleeper league runs on Sleeper's projections scored with its
 * settings; an ESPN league on ESPN's own, which ESPN has already scored with the
 * league's settings — see `fetchTradePool` in lib/live/espn.
 */
export default async function TradeAnalyzerPage() {
  const initial = await getLiveSeason();
  const refs = getLeagueRefs();
  const season = initial && !initial.unavailable ? initial.season : null;
  const ref = season ? refs[String(season)] ?? null : null;
  const format = season ? getSeasonFormat(season) : null;
  const rosterPositions = season ? getRosterPositions(season) : [];

  const header = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Trade Analyzer</h1>
      <p className="mt-1 max-w-2xl text-sm text-chalk-500">
        Put together a trade between two teams and see what it does to each of them: their best
        possible lineup every remaining week, their chance of winning each game, and their odds of
        making the playoffs and winning it all. Nothing here is sent anywhere.
      </p>
    </div>
  );

  const blocked = !season || !ref || !format || !rosterPositions.length
    ? "There is no season in progress to trade in."
    : !initial?.teams.length
      ? "Trades open once the league has teams on it."
      : null;

  if (blocked) {
    return (
      <div className="space-y-5 sm:space-y-6">
        {header}
        <Panel>
          <EmptyState>{blocked}</EmptyState>
        </Panel>
      </div>
    );
  }

  const owners = getOwners();
  const players = getPlayers();
  /**
   * NAMES FOR ROSTERED PLAYERS ONLY, as a fallback. The live player pool names
   * everybody, free agents included; this is what renders if that feed is down,
   * so the rosters still read as people rather than ids.
   */
  const rostered = new Set(initial!.teams.flatMap((t) => t.players));
  const baked: Record<string, { name: string; position: string | null; team: string | null }> = {};
  for (const id of rostered) {
    const p = players[id];
    if (p) baked[id] = { name: p.full_name, position: p.position, team: p.team };
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {header}
      <TradeAnalyzer
        refBySeason={refs}
        initial={initial!}
        userIdToSlug={getUserIdToSlug()}
        owners={Object.fromEntries(owners.map((o) => [o.slug, { name: o.name, first: o.firstName }]))}
        format={format!}
        rosterPositions={rosterPositions}
        baked={baked}
        // A player page exists per key of the league's index, so only these link.
        linkable={Object.keys(players)}
      />
    </div>
  );
}
