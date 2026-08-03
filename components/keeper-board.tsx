"use client";

import Link from "next/link";

import { KeepPips, PositionPill, ValueBadge } from "@/components/keeper-table";
import { Col, ListHeader, Panel, PanelHeader } from "@/components/ui";
import { LiveStatus, useLiveRosters } from "@/lib/sleeper-browser";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The keeper tracker: baked contracts annotated with live selections.
 *
 * Contract values are derived at build time from years of drafts and
 * transactions and never change between deploys. WHICH players a team has
 * locked in, though, changes hour to hour in the run-up to the deadline — so
 * that one field is fetched from Sleeper in the browser and merged on top.
 *
 * The two layers stay visually distinct: a round number is settled history, a
 * "kept" badge is a live decision that may not survive the afternoon.
 *
 * No ordering emphasis. Every eligible contract renders identically, because
 * highlighting the four cheapest implied a recommendation the data can't make —
 * cost is only one input, and the owner picks the other four.
 */
export function KeeperBoard({
  contractsByOwner,
  ownerNames,
  userIdToSlug,
  players,
  adp,
  leagueId,
  maxKeepers,
}: {
  contractsByOwner: Array<[string, KeeperContract[]]>;
  ownerNames: Record<string, string>;
  /** Resolves a live roster's owner_id back to our stable slug. */
  userIdToSlug: Record<string, string>;
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  leagueId: string | null;
  maxKeepers: number;
}) {
  const live = useLiveRosters(leagueId);

  // ownerSlug -> set of player_ids that owner has locked in.
  const selectedByOwner = new Map<string, Set<string>>();
  for (const roster of live.data ?? []) {
    const slug = roster.ownerId ? userIdToSlug[roster.ownerId] : undefined;
    if (!slug) continue;
    selectedByOwner.set(slug, new Set(roster.keepers));
  }

  const totalSelected = [...selectedByOwner.values()].reduce((n, s) => n + s.size, 0);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-chalk-600">
          {live.status === "ready"
            ? `${totalSelected} keeper${totalSelected === 1 ? "" : "s"} locked in across the league`
            : "Contract values are final; selections load from Sleeper."}
        </p>
        <LiveStatus status={live.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {contractsByOwner.map(([slug, contracts]) => {
          const selected = selectedByOwner.get(slug) ?? new Set<string>();
          const eligible = contracts.filter((c) => !c.expired);

          // Selected players float to the top; everything else keeps its
          // cost order so the board still reads as a price list.
          const ordered = [...contracts].sort((a, b) => {
            const sa = Number(selected.has(b.playerId)) - Number(selected.has(a.playerId));
            if (sa !== 0) return sa;
            return Number(a.expired) - Number(b.expired) || a.round - b.round;
          });

          return (
            <Panel key={slug}>
              <PanelHeader
                title={ownerNames[slug] ?? slug}
                meta={
                  live.status === "ready"
                    ? `${selected.size} of ${maxKeepers} selected`
                    : `${eligible.length} eligible`
                }
                href={`/owners/${slug}/`}
                hrefLabel="Profile"
              />
              <ListHeader>
                <Col className="w-8 shrink-0 text-center">Pos</Col>
                <Col className="flex-1">Player</Col>
                <Col
                  className="shrink-0 text-right"
                  hint="Sleeper ADP (overall pick number), then how many rounds cheaper (+) or more expensive (−) keeping them is versus that market price"
                >
                  ADP · Value
                </Col>
                <Col
                  className="shrink-0"
                  hint="Keeps remaining before the player is revalued to ADP"
                >
                  Keeps
                </Col>
                <Col className="w-9 shrink-0 text-right" hint="Draft round it costs to keep">
                  Cost
                </Col>
                <span className="w-3 shrink-0" />
              </ListHeader>

              <div className="divide-y divide-ink-700">
                {ordered.map((c) => {
                  const p = players[c.playerId];
                  const isSelected = selected.has(c.playerId);
                  return (
                    <details key={c.playerId} className="group">
                      <summary
                        className={`flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 transition-colors sm:gap-3 sm:px-4 ${
                          isSelected
                            ? "bg-accent/[0.07] hover:bg-accent/[0.11]"
                            : `hover:bg-ink-700/40 ${c.expired ? "opacity-50" : ""}`
                        }`}
                      >
                        {/* A left rail marks a live selection without changing
                            the row's rhythm or reflowing the columns. */}
                        <span
                          aria-hidden
                          className={`-ml-1 h-7 w-[3px] shrink-0 rounded-full ${
                            isSelected ? "bg-accent" : "bg-transparent"
                          }`}
                        />
                        <PositionPill position={p?.position ?? null} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {p?.full_name ?? c.playerId}
                          {p?.team ? (
                            <span className="ml-1.5 text-[11px] font-normal text-chalk-600">
                              {p.team}
                            </span>
                          ) : null}
                          {isSelected ? (
                            <span
                              className="ml-2 rounded border border-accent-dim bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent"
                              title="This team has locked this player in as a keeper on Sleeper"
                            >
                              Kept
                            </span>
                          ) : null}
                        </span>
                        <ValueBadge costRound={c.round} adp={adp[c.playerId]} />
                        <KeepPips used={c.keepsUsed} total={c.keepsUsed + c.keepsRemaining} />
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
                          {c.originalDraftRound ? <span>drafted: R{c.originalDraftRound}</span> : null}
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
    </>
  );
}
