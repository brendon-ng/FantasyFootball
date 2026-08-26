import Link from "next/link";

import { KeeperBoard } from "@/components/keeper-board";
import { ProjectedDraftBoard } from "@/components/projected-draft-board";
import {
  EmptyState,
  Panel,
  PanelHeader,
  Stat,
} from "@/components/ui";
import {
  features,
  getAdp,
  getDrafts,
  getKeepers,
  getLeagueRefs,
  getOwners,
  getPlayers,
  getRules,
  getSeasons,
  getUserIdToSlug,
  keeperCycleSeason,
  pageTitle,
} from "@/lib/data";
import type { KeeperContract } from "@/lib/types";

export const generateMetadata = () => ({ title: pageTitle("Keeper Tracker") });

const MAX_KEEPERS = 4;

/**
 * The keeper tracker.
 *
 * Sleeper models no part of the contract system — `is_keeper` is a bare boolean
 * with no round and no length — so every value here is reconstructed by
 * replaying drafts and transactions in `scripts/derive.ts`, and each row carries
 * its own provenance so the maths is auditable rather than taken on faith.
 *
 * That derived layer is baked at build time. Which players a team has actually
 * LOCKED IN changes hour to hour before the deadline, so `KeeperBoard` fetches
 * that from Sleeper in the browser and merges it on top.
 */
export default function KeepersPage() {
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

  const keepers = getKeepers();
  const owners = getOwners();
  const players = getPlayers();
  const seasons = getSeasons();
  const adp = getAdp();
  const { draftRounds } = getRules();

  /**
   * TWO DIFFERENT SEASONS, and they diverge for five months of the year.
   *
   * `nextSeason` is the DRAFT this page projects — which league to fetch live
   * from, and what to title the board. `cycle` is the season the CONTRACTS are
   * priced for, and a completed draft advances that immediately: from the day the
   * 2026 draft is archived these contracts say what it costs to keep in 2027,
   * while the 2026 draft is still the one that just happened.
   */
  const nextSeason = Math.max(...seasons.map((s) => s.season), 0) + 1;
  const cycle = keeperCycleSeason();
  const leagueRef = getLeagueRefs()[String(nextSeason)] ?? null;
  /**
   * The real board exists, so the projected one has nothing left to say.
   *
   * KNOWN AT BUILD TIME, which is the point: the board itself can only discover
   * this in the browser, from the live draft status, so the panel around it was
   * still headed "Projected 2026 Draft Board · live from Sleeper" over a body
   * saying the draft was done — and would have stayed that way for the five
   * months until `nextSeason` advances. `drafts.json` is the same signal a beat
   * later and needs no network at all.
   */
  const drafted = getDrafts().some((d) => d.season === nextSeason);

  const byOwner = new Map<string, KeeperContract[]>();
  for (const c of keepers.final) {
    if (!c.ownerSlug) continue;
    byOwner.set(c.ownerSlug, [...(byOwner.get(c.ownerSlug) ?? []), c]);
  }

  const ownerNames = Object.fromEntries(owners.map((o) => [o.slug, o.name]));
  const contractsByOwner = [...byOwner.entries()].sort(([a], [b]) =>
    (ownerNames[a] ?? a).localeCompare(ownerNames[b] ?? b),
  );

  const all = [...byOwner.values()].flat();
  const expiring = all.filter((c) => c.keepsRemaining === 1).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Keeper Tracker</h1>
          <p className="mt-1 max-w-2xl text-sm text-chalk-500">
            Contracts entering the {cycle} draft. Keeping a player costs your pick in their
            round; a contract survives two keeps before the player is revalued to ADP.
          </p>
        </div>
        <Link
          href="/keepers/history/"
          className="shrink-0 rounded-lg border border-ink-500 px-3 py-1.5 text-xs font-medium text-chalk-300 transition-colors hover:border-accent-dim hover:text-accent"
        >
          Keeper history <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Tracked contracts" value={all.length} />
        <Stat label="Max keepers / team" value={MAX_KEEPERS} />
        <Stat
          label="Final keep year"
          value={expiring}
          tone="accent"
          sub="Revalued next offseason"
        />
        <Stat label="Expired" value={all.filter((c) => c.expired).length} sub="Cost resets to ADP" />
      </div>

      {contractsByOwner.length === 0 ? (
        <Panel>
          <EmptyState>No contracts derived yet — run npm run data.</EmptyState>
        </Panel>
      ) : (
        <KeeperBoard
          draftRounds={draftRounds}
          contractsByOwner={contractsByOwner}
          ownerNames={ownerNames}
          userIdToSlug={getUserIdToSlug()}
          players={players}
          adp={Object.fromEntries(adp.byPlayer)}
          leagueRef={leagueRef}
          maxKeepers={MAX_KEEPERS}
        />
      )}

      {/* Entirely live: the order is drawn after the keeper deadline, picks trade
          until the last minute, and selections change hourly. Once the draft runs,
          `derive` commits the real board and /history/<season>/draft/ takes over —
          so this becomes one line pointing at it rather than a panel explaining
          that it has nothing to project. */}
      {drafted ? (
        <p className="px-1 text-xs text-chalk-600">
          The {nextSeason} draft is done.{" "}
          <Link
            href={`/history/${nextSeason}/draft/`}
            className="text-chalk-400 transition-colors hover:text-accent"
          >
            See the board as it happened →
          </Link>
        </p>
      ) : (
      <Panel>
        <PanelHeader
          title={`Projected ${nextSeason} Draft Board`}
          meta="live from Sleeper"
          legend="Who owns each pick after trades, with locked-in keepers placed on the pick they will consume. A green cell is a pick already spent on a keeper."
        />
        <ProjectedDraftBoard
          draftRounds={draftRounds}
          adp={Object.fromEntries(adp.byPlayer)}
          leagueRef={leagueRef}
          season={nextSeason}
          contracts={all}
          players={players}
          userIdToSlug={getUserIdToSlug()}
          ownerNames={ownerNames}
          maxKeepers={MAX_KEEPERS}
        />
      </Panel>
      )}
    </div>
  );
}
