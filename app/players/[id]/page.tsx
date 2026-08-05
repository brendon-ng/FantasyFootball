import Link from "next/link";
import { notFound } from "next/navigation";

import { KeepPips, PositionPill } from "@/components/keeper-table";
import { BackLink } from "@/components/back-link";
import { LiveOwner, PlayerTransactions } from "@/components/player-live";
import { PlayerUsageTable } from "@/components/player-usage";
import { Panel, PanelHeader, Stat } from "@/components/ui";
import {
  features,
  getAdp,
  getConfig,
  getKeepers,
  getOwners,
  getSeasons,
  getOwnerMap,
  getPickOutcomes,
  getPlayerHistory,
  getPlayerUsage,
  getTrades,
  getPlayerKeepHistory,
  getPlayers,
} from "@/lib/data";

export const dynamicParams = false;

/**
 * One page per player the league has ever touched (~370), which keeps every
 * player name on the site clickable. The slim player index makes this cheap;
 * generating pages from Sleeper's full 5MB map would not be.
 */
export function generateStaticParams() {
  return Object.keys(getPlayers()).map((id) => ({ id }));
}

function OwnerLink({ slug, name }: { slug: string | null; name: string }) {
  if (!slug) return <span className="text-chalk-400">{name}</span>;
  return (
    <Link href={`/owners/${slug}/`} className="transition-colors hover:text-accent">
      {name}
    </Link>
  );
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const players = getPlayers();
  const player = players[id];
  if (!player) notFound();

  const owners = getOwnerMap();
  const history = getPlayerHistory()[id] ?? [];
  const contract = getKeepers().final.find((c) => c.playerId === id);
  const keeps = getPlayerKeepHistory(id);
  const adpAll = getAdp();
  const cfg = getConfig();
  // Weeks after this are not yet in the committed data, so anything there has to
  // come from Sleeper directly.
  const upcoming = Math.max(...getSeasons().map((x) => x.season), 0) + 1;
  const liveLeagueId = cfg.knownLeagueIds[String(upcoming)] ?? null;
  const userIdToSlug = Object.fromEntries(
    getOwners().filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
  );
  const ownerNames = Object.fromEntries(getOwners().map((o) => [o.slug, o.name]));
  const adp = adpAll.byPlayer.get(id);
  const trades = getTrades().filter((t) => t.legs.some((l) => l.playerId === id));
  const usage = getPlayerUsage()[id] ?? [];
  // Credit is per season: who co-owns a team changes, so the label has to be
  // looked up against that season's standings rather than the owner list.
  const standingsBySeason = new Map(getSeasons().map((x) => [x.season, x.standings]));
  const ownerLabels = Object.fromEntries(
    usage.map((u) => {
      const row = standingsBySeason.get(u.season)?.find((r) => r.ownerSlug === u.ownerSlug);
      const slugs = row?.ownerSlugs?.length ? row.ownerSlugs : [u.ownerSlug];
      // FIRST NAMES THROUGHOUT, not just for shared teams. The column is narrow
      // in a half-width panel and a surname earns nothing here — the league has
      // no two owners who share a first name.
      return [
        `${u.season}|${u.ownerSlug}`,
        slugs.map((sl) => owners.get(sl)?.firstName ?? sl).join(" & "),
      ];
    }),
  );
  const name = (s: string | null | undefined) => (s && owners.get(s)?.name) || "—";


  return (
    <div className="space-y-5 sm:space-y-6">
      {/* A player page is a leaf reached from matchups, lineups, trades, the
          record book and the keeper board — so it needs the back control more
          than most, and had none. The fallback is the keeper tracker where the
          league has one, since that is the only page listing players; a redraft
          league falls back to the league home. */}
      <BackLink
        fallback={
          features().keepers
            ? { href: "/keepers/", label: "Keeper tracker" }
            : { href: "/", label: "League" }
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PositionPill position={player.position} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{player.full_name}</h1>
            <p className="mt-0.5 text-sm text-chalk-500">
              {[player.position, player.team].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>
      </div>

      {contract ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Current owner"
            value={
              <LiveOwner
                playerId={id}
                leagueId={liveLeagueId}
                userIdToSlug={userIdToSlug}
                ownerNames={ownerNames}
                bakedOwnerSlug={contract.ownerSlug}
              />
            }
          />
          <Stat
            label="Keeper cost"
            value={contract.expired ? "ADP" : `R${contract.round}`}
            tone={contract.expired ? "default" : "accent"}
          />
          <Stat
            label="Keeps left"
            value={
              <KeepPips used={contract.keepsUsed} total={contract.keepsUsed + contract.keepsRemaining} />
            }
            sub={`${contract.keepsRemaining} of ${contract.keepsUsed + contract.keepsRemaining}`}
          />
          <Stat
            label="Times kept"
            value={keeps.length}
            tone={keeps.length ? "accent" : "default"}
            sub={
              keeps.length
                ? keeps.map((k) => k.season).join(", ")
                : `On contract since ${contract.startSeason}`
            }
          />
          <Stat
            label={`Sleeper ADP${adpAll.frozen ? " (locked)" : ""}`}
            value={adp?.sleeper != null ? adp.sleeper.toFixed(1) : "—"}
            sub={
              adp?.round
                ? `round ${adp.round}${
                    !contract.expired ? ` · keeping saves ${contract.round - adp.round}` : ""
                  }`
                : "not in top 372"
            }
          />
        </div>
      ) : adp?.sleeper != null ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Sleeper ADP" value={adp.sleeper.toFixed(1)} sub={`round ${adp.round}`} />
        </div>
      ) : null}

      {/* PAIRED ON DESKTOP: keeper history beside the derivation that explains it,
          then the transaction log beside what each owner actually got out of him.
          Each pair is one subject read two ways, so they belong on a line. */}
      <div className="grid gap-5 lg:grid-cols-2">
      {keeps.length ? (
        <Panel>
          <PanelHeader
            title="Keeper History"
            meta={`kept ${keeps.length} time${keeps.length === 1 ? "" : "s"}`}
            legend="Each retention consumed the owner's pick in that round. A contract survives two keeps at its original cost before the player is revalued to ADP."
          />
          <div className="divide-y divide-ink-700">
            {keeps.map((k) => (
              <div
                key={`${k.season}-${k.pickNo}`}
                className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
              >
                <span className="tabular w-12 shrink-0 text-sm font-bold text-chalk-100">
                  {k.season}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="text-chalk-600">kept by</span>{" "}
                  <OwnerLink slug={k.ownerSlug} name={name(k.ownerSlug)} />
                </span>
                <span
                  className="tabular shrink-0 text-sm font-semibold text-accent"
                  title={`Round ${k.round}, pick ${k.pickNo} overall`}
                >
                  R{k.round}
                  <span className="ml-1 text-[10px] font-normal text-chalk-600">#{k.pickNo}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

        {contract ? (
          <Panel>
            <PanelHeader title="Contract Derivation" meta="auditable" />
            <ol className="space-y-1.5 p-4 text-[12px] leading-relaxed text-chalk-400 sm:p-5">
              {contract.provenance.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="tabular shrink-0 text-chalk-600">{i + 1}.</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
            <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-chalk-600 sm:px-5">
              Derived by replaying drafts and transactions — Sleeper stores no keeper cost or
              contract length. Corrections go in{" "}
              <code className="text-chalk-500">config/keeper-overrides.json</code>.
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Transaction History"
            meta={`${history.length} events`}
            legend="A dot marks a move Sleeper has processed but not yet scored, so it is not archived yet."
          />
          <PlayerTransactions
            playerId={id}
            baked={history}
            trades={Object.fromEntries(trades.map((t) => [t.id, t]))}
            players={players}
            pickOutcomes={getPickOutcomes()}
            leagueId={liveLeagueId}
            season={upcoming}
            fromWeek={1}
            userIdToSlug={userIdToSlug}
            ownerNames={ownerNames}
          />
        </Panel>

        {usage.length ? (
          <Panel>
            <PanelHeader
              title="By Season and Owner"
              meta={`${usage.length} owner-season${usage.length === 1 ? "" : "s"}`}
              legend="Games on the roster and games started, with the points each owner got out of him. Bench points are what he scored for nobody. Bye weeks are left out — his team was idle, so a zero there is the schedule, not the player."
            />
            <PlayerUsageTable rows={usage} ownerLabels={ownerLabels} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
