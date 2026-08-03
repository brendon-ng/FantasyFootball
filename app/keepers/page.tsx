import Link from "next/link";

import { KeepPips, PositionPill } from "@/components/keeper-table";
import { EmptyState, Panel, PanelHeader, Stat } from "@/components/ui";
import { getKeepers, getOwnerMap, getPlayers, getSeasons } from "@/lib/data";
import type { KeeperContract } from "@/lib/types";

export const metadata = { title: "Keeper Tracker · Den Ops" };

const MAX_KEEPERS = 4;

/**
 * The keeper tracker.
 *
 * Sleeper models none of this — `is_keeper` is a bare boolean with no round and
 * no contract length — so every value here is reconstructed by replaying drafts
 * and transactions in `scripts/derive.ts`. Each row therefore carries its own
 * provenance trail, so anyone can audit the number rather than take it on faith.
 */
export default function KeepersPage() {
  const keepers = getKeepers();
  const owners = getOwnerMap();
  const players = getPlayers();
  const seasons = getSeasons();

  const nextSeason = Math.max(...seasons.map((s) => s.season), 0) + 1;

  const byOwner = new Map<string, KeeperContract[]>();
  for (const c of keepers.final) {
    if (!c.ownerSlug) continue;
    byOwner.set(c.ownerSlug, [...(byOwner.get(c.ownerSlug) ?? []), c]);
  }
  for (const list of byOwner.values()) {
    list.sort((a, b) => Number(a.expired) - Number(b.expired) || a.round - b.round);
  }

  const all = [...byOwner.values()].flat();
  const expiring = all.filter((c) => c.keepsRemaining === 1).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Keeper Tracker</h1>
        <p className="mt-1 max-w-2xl text-sm text-chalk-500">
          Contracts entering the {nextSeason} draft. Keeping a player costs your pick in
          their round; a contract survives {MAX_KEEPERS === 4 ? "two" : "two"} keeps before
          the player is revalued to ADP.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Tracked contracts" value={all.length} />
        <Stat label="Max keepers / team" value={MAX_KEEPERS} />
        <Stat label="Final keep year" value={expiring} tone="accent" sub="Revalued next offseason" />
        <Stat
          label="Expired"
          value={all.filter((c) => c.expired).length}
          sub="Cost resets to ADP"
        />
      </div>

      {byOwner.size === 0 ? (
        <Panel>
          <EmptyState>No contracts derived yet — run npm run data.</EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {[...byOwner.entries()]
            .sort(([a], [b]) =>
              (owners.get(a)?.name ?? a).localeCompare(owners.get(b)?.name ?? b),
            )
            .map(([slug, contracts]) => {
              const eligible = contracts.filter((c) => !c.expired);
              return (
                <Panel key={slug}>
                  <PanelHeader
                    title={owners.get(slug)?.name ?? slug}
                    meta={`${eligible.length} eligible · ${contracts.length} rostered`}
                    href={`/owners/${slug}/`}
                    hrefLabel="Profile"
                  />
                  <div className="divide-y divide-ink-700">
                    {contracts.map((c, i) => {
                      const p = players[c.playerId];
                      // Only the best four eligible contracts can actually be
                      // used, so everything past that is dimmed as reference.
                      const usable = !c.expired && i < MAX_KEEPERS;
                      return (
                        <details key={c.playerId} className="group">
                          <summary
                            className={`flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 transition-colors hover:bg-ink-700/40 sm:gap-3 sm:px-4 ${
                              usable ? "" : "opacity-50"
                            }`}
                          >
                            <span className="tabular w-4 shrink-0 text-[11px] text-chalk-600">
                              {i + 1}
                            </span>
                            <PositionPill position={p?.position ?? null} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {p?.full_name ?? c.playerId}
                              {p?.team ? (
                                <span className="ml-1.5 text-[11px] font-normal text-chalk-600">
                                  {p.team}
                                </span>
                              ) : null}
                            </span>
                            <KeepPips
                              used={c.keepsUsed}
                              total={c.keepsUsed + c.keepsRemaining}
                            />
                            <span
                              className={`tabular w-9 shrink-0 text-right text-sm font-bold ${
                                c.expired ? "text-loss" : "text-accent"
                              }`}
                            >
                              {c.expired ? "ADP" : `R${c.round}`}
                            </span>
                            <span className="w-3 shrink-0 text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                              ▸
                            </span>
                          </summary>
                          <div className="bg-ink-850 px-4 py-3 text-[11px] leading-relaxed text-chalk-500 sm:px-5">
                            <div className="eyebrow mb-1.5 text-[10px]">How this was derived</div>
                            <ol className="space-y-0.5">
                              {c.provenance.map((line, j) => (
                                <li key={j} className="flex gap-2">
                                  <span className="text-chalk-600">·</span>
                                  <span>{line}</span>
                                </li>
                              ))}
                            </ol>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 pt-2 text-chalk-600">
                              <span>origin: {c.origin}</span>
                              <span>since: {c.startSeason}</span>
                              {c.originalDraftRound ? (
                                <span>drafted: R{c.originalDraftRound}</span>
                              ) : null}
                              <Link
                                href={`/players/${c.playerId}/`}
                                className="text-accent hover:underline"
                              >
                                transaction history →
                              </Link>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </Panel>
              );
            })}
        </div>
      )}
    </div>
  );
}
