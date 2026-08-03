import Link from "next/link";
import { notFound } from "next/navigation";

import { KeepPips, PositionPill } from "@/components/keeper-table";
import { EmptyState, Panel, PanelHeader, Stat } from "@/components/ui";
import { getAdp, getKeepers, getOwnerMap, getPlayerHistory, getPlayers } from "@/lib/data";

export const dynamicParams = false;

/**
 * One page per player the league has ever touched (~370), which keeps every
 * player name on the site clickable. The slim player index makes this cheap;
 * generating pages from Sleeper's full 5MB map would not be.
 */
export function generateStaticParams() {
  return Object.keys(getPlayers()).map((id) => ({ id }));
}

const TYPE_LABEL: Record<string, string> = {
  draft: "Draft",
  trade: "Trade",
  waiver: "Waiver",
  free_agent: "Free agent",
  commissioner: "Commissioner",
};

/** Colour of the event's left rail: acquisitions, departures, and moves. */
const ACTION_RAIL: Record<string, string> = {
  draft: "bg-win/60",
  keep: "bg-accent/70",
  add: "bg-win/60",
  trade: "bg-sky-400/60",
  drop: "bg-loss/60",
};

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
  const adpAll = getAdp();
  const adp = adpAll.byPlayer.get(id);
  const name = (s: string | null | undefined) => (s && owners.get(s)?.name) || "—";

  const seasonsSeen = [...new Set(history.map((h) => h.season))].sort((a, b) => a - b);

  return (
    <div className="space-y-5 sm:space-y-6">
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
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat
            label="Current owner"
            value={
              contract.ownerSlug ? (
                <Link
                  href={`/owners/${contract.ownerSlug}/`}
                  className="text-base hover:text-accent sm:text-lg"
                >
                  {name(contract.ownerSlug)}
                </Link>
              ) : (
                <span className="text-base sm:text-lg">Free agent</span>
              )
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

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Transaction History" meta={`${history.length} events`} />
          {history.length === 0 ? (
            <EmptyState>No recorded transactions.</EmptyState>
          ) : (
            <div className="divide-y divide-ink-700">
              {seasonsSeen.map((season) => (
                <div key={season}>
                  <div className="bg-ink-850 px-4 py-1.5">
                    <span className="eyebrow tabular">{season}</span>
                  </div>
                  <ol>
                    {history
                      .filter((h) => h.season === season)
                      .map((h, i) => (
                        <li
                          key={i}
                          className="flex items-stretch gap-3 border-b border-ink-700 px-4 py-2.5 last:border-0"
                        >
                          <span
                            className={`w-1 shrink-0 rounded-full ${ACTION_RAIL[h.action] ?? "bg-ink-500"}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm">
                              {h.action === "trade" ? (
                                <>
                                  <span className="font-medium">Traded</span>{" "}
                                  <span className="text-chalk-600">from</span>{" "}
                                  <OwnerLink slug={h.fromSlug} name={name(h.fromSlug)} />{" "}
                                  <span className="text-chalk-600">to</span>{" "}
                                  <OwnerLink slug={h.toSlug} name={name(h.toSlug)} />
                                </>
                              ) : (
                                <>
                                  <span className="font-medium">
                                    {h.action === "draft"
                                      ? `Drafted R${h.round} (pick ${h.pickNo})`
                                      : h.action === "keep"
                                        ? `Kept at R${h.round} (pick ${h.pickNo})`
                                        : h.action === "add"
                                          ? "Added"
                                          : "Dropped"}
                                  </span>{" "}
                                  <span className="text-chalk-600">by</span>{" "}
                                  <OwnerLink slug={h.ownerSlug} name={name(h.ownerSlug)} />
                                </>
                              )}
                            </div>
                            <div className="text-[11px] text-chalk-600">
                              {TYPE_LABEL[h.type] ?? h.type}
                              {/* "Draft · preseason" is redundant; only in-season
                                  moves need timing. Sleeper stamps every preseason
                                  transaction as week 1, so the raw week would
                                  misdate them — say "preseason" instead. */}
                              {h.type === "draft"
                                ? ""
                                : ` · ${h.preseason ? "preseason" : `week ${h.week}`}`}
                              {h.faabSpent != null ? ` · $${h.faabSpent} FAAB` : ""}
                            </div>
                          </div>
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </Panel>

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
    </div>
  );
}
