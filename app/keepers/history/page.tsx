import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import {
  Col,
  EmptyState,
  ListHeader,
  Panel,
  PanelHeader,
  Stat,
} from "@/components/ui";
import {
  features,
  getKeepHistory,
  getOwnerMap,
  getPlayers,
  getSeasons,
  pageTitle,
} from "@/lib/data";

export const generateMetadata = () => ({ title: pageTitle("Keeper History") });

/**
 * Who kept whom, season by season.
 *
 * Built from `isKeeper` on draft picks rather than from contract state: a pick
 * is a record of what happened, while a contract is a derived assertion about
 * what a player is worth. Only seasons with a Sleeper draft can appear — the
 * imported ESPN seasons kept no draft data — so this starts at 2025, the
 * league's first keeper year. 2024 was the startup draft and has none by
 * definition.
 */
export default function KeeperHistoryPage() {
  // Routes still exist in a redraft league's build (static export generates every
  // page), but the nav hides them and this says why rather than rendering a board
  // with nothing on it.
  if (!features().keepers) {
    return (
      <Panel>
        <EmptyState>This league does not use keepers.</EmptyState>
      </Panel>
    );
  }

  const keeps = getKeepHistory();
  const owners = getOwnerMap();
  const players = getPlayers();
  const seasons = getSeasons();

  const name = (slug: string | null) => (slug && owners.get(slug)?.name) || "—";

  const bySeason = new Map<number, typeof keeps>();
  for (const k of keeps) bySeason.set(k.season, [...(bySeason.get(k.season) ?? []), k]);
  const seasonList = [...bySeason.keys()].sort((a, b) => b - a);

  // How often each player has been retained, across every season.
  const repeatCounts = new Map<string, number>();
  for (const k of keeps) repeatCounts.set(k.playerId, (repeatCounts.get(k.playerId) ?? 0) + 1);
  const mostKept = [...repeatCounts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const keeperSeasons = seasons.filter((s) => s.finalized && !s.imported && s.season > 2024).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <Link href="/keepers/" className="text-xs text-chalk-600 hover:text-accent">
          ← Keeper tracker
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Keeper History</h1>
        <p className="mt-1 max-w-2xl text-sm text-chalk-500">
          Every player retained, by team and season. Drawn from the draft record, so it begins in
          2025 — 2024 was the startup draft and the imported 2020–23 ESPN seasons kept no draft
          data.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Keepers declared" value={keeps.length} />
        <Stat label="Keeper seasons" value={keeperSeasons} sub="since 2025" />
        <Stat
          label="Kept more than once"
          value={mostKept.length}
          tone="accent"
          sub="same player, multiple years"
        />
        <Stat
          label="Distinct players"
          value={repeatCounts.size}
          sub="retained at least once"
        />
      </div>

      {mostKept.length ? (
        <Panel>
          <PanelHeader
            title="Kept Repeatedly"
            legend="A contract survives two keeps at its original round before the player is revalued to ADP, so a third appearance means a reset happened in between."
          />
          <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
            {mostKept.map(([playerId, n]) => (
              <div key={playerId} className="flex items-center gap-2.5 bg-ink-800 px-3 py-2">
                <PositionPill position={players[playerId]?.position ?? null} />
                <Link
                  href={`/players/${playerId}/`}
                  className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                >
                  {players[playerId]?.full_name ?? playerId}
                </Link>
                <span className="tabular shrink-0 text-sm font-bold text-accent">{n}×</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {seasonList.length === 0 ? (
        <Panel>
          <EmptyState>No keepers declared yet.</EmptyState>
        </Panel>
      ) : (
        seasonList.map((season) => {
          const inSeason = bySeason.get(season)!;
          const byOwner = new Map<string, typeof keeps>();
          for (const k of inSeason) {
            const slug = k.ownerSlug ?? "unknown";
            byOwner.set(slug, [...(byOwner.get(slug) ?? []), k]);
          }
          const teams = [...byOwner.entries()].sort(([a], [b]) =>
            name(a).localeCompare(name(b)),
          );

          return (
            <Panel key={season}>
              <PanelHeader
                title={`${season} Keepers`}
                meta={`${inSeason.length} across ${teams.length} teams`}
                href={`/history/${season}/`}
                hrefLabel="Season"
              />
              <div className="grid gap-px bg-ink-600 lg:grid-cols-2">
                {teams.map(([slug, picks]) => (
                  <div key={slug} className="bg-ink-800 p-1">
                    <div className="flex items-baseline justify-between px-3 pb-1 pt-2">
                      <Link
                        href={`/owners/${slug}/`}
                        className="text-sm font-semibold transition-colors hover:text-accent"
                      >
                        {name(slug)}
                      </Link>
                      <span className="text-[11px] text-chalk-600">
                        {picks.length} kept
                      </span>
                    </div>
                    <ListHeader>
                      <Col className="w-8 shrink-0 text-center">Pos</Col>
                      <Col className="flex-1">Player</Col>
                      <Col
                        className="w-16 shrink-0 text-right"
                        hint="The pick this keeper consumed"
                      >
                        Cost
                      </Col>
                    </ListHeader>
                    {picks
                      .slice()
                      .sort((a, b) => a.round - b.round)
                      .map((k) => (
                        <div
                          key={k.playerId}
                          className="flex items-center gap-2.5 px-3 py-1.5 sm:px-4"
                        >
                          <PositionPill position={players[k.playerId]?.position ?? null} />
                          <Link
                            href={`/players/${k.playerId}/`}
                            className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent"
                          >
                            {players[k.playerId]?.full_name ?? k.playerId}
                          </Link>
                          <span
                            className="tabular w-16 shrink-0 text-right text-sm font-semibold text-accent"
                            title={`Round ${k.round}, pick ${k.pickNo} overall`}
                          >
                            R{k.round}
                            <span className="ml-1 text-[10px] font-normal text-chalk-600">
                              #{k.pickNo}
                            </span>
                          </span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}
