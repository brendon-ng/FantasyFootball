"use client";

import Link from "next/link";
import { type LeagueRef } from "@/lib/league-ref";

import { KeepPips, PositionPill, ValueBadge } from "@/components/keeper-table";
import { costRound } from "@/lib/draft-slots";
import { Tip } from "@/components/tooltip";
import { Col, ListHeader, Panel, PanelHeader } from "@/components/ui";
import { useSelectedKeepers } from "@/components/keeper-selection";
import { LiveStatus } from "@/lib/live";
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
  leagueRef,
  maxKeepers,
  draftRounds,
}: {
  contractsByOwner: Array<[string, KeeperContract[]]>;
  ownerNames: Record<string, string>;
  /** Resolves a live roster's owner_id back to our stable slug. */
  userIdToSlug: Record<string, string>;
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  /** Last round of the draft — the floor an expired contract is revalued to. */
  draftRounds: number;
  leagueRef: LeagueRef | null;
  maxKeepers: number;
}) {
  const allBaked = contractsByOwner.flatMap(([, cs]) => cs);
  const {
    byOwner: selectedByOwner,
    contracts: liveContracts,
    adjustments,
    ready,
  } = useSelectedKeepers(leagueRef, userIdToSlug, allBaked);

  // Regroup from the adjusted set: a player dropped in the preseason should
  // leave the board, and a pickup should appear, before week 1 finalises.
  const liveByOwner = new Map<string, KeeperContract[]>();
  for (const c of liveContracts) {
    if (!c.ownerSlug) continue;
    liveByOwner.set(c.ownerSlug, [...(liveByOwner.get(c.ownerSlug) ?? []), c]);
  }

  const totalSelected = [...selectedByOwner.values()].reduce((n, s) => n + s.size, 0);
  const live = { status: ready ? ("ready" as const) : ("loading" as const), data: liveContracts };

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
        {contractsByOwner.map(([slug]) => {
          const selected = selectedByOwner.get(slug) ?? new Set<string>();
          const contracts = liveByOwner.get(slug) ?? [];
          const eligible = contracts.filter((c) => !c.expired);

          // Selected players float to the top; everything else keeps its
          // cost order so the board still reads as a price list.
          const ordered = [...contracts].sort((a, b) => {
            const sa = Number(selected.has(b.playerId)) - Number(selected.has(a.playerId));
            if (sa !== 0) return sa;
            // Sorted on what it COSTS, not on the original round — an expired
            // contract's stored round is a historical fact nobody is shown.
            return (
              Number(a.expired) - Number(b.expired) ||
              costRound(a, adp[a.playerId], draftRounds) -
                costRound(b, adp[b.playerId], draftRounds)
            );
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
                        {/* The badge must sit OUTSIDE the truncating span.
                            `truncate` sets overflow:hidden, which clips a taller
                            inline-block child's border top and bottom. */}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {p?.full_name ?? c.playerId}
                          {p?.team ? (
                            <span className="ml-1.5 text-[11px] font-normal text-chalk-600">
                              {p.team}
                            </span>
                          ) : null}
                        </span>
                        {isSelected ? (
                          <span
                            className="shrink-0 rounded border border-accent-dim bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-normal tracking-wide text-accent"
                            title="This team has locked this player in as a keeper on Sleeper"
                          >
                            Kept
                          </span>
                        ) : null}
                        {/* A dot, not a banner: the row already shows the true
                            current value, so this only says where it came from. */}
                        {adjustments.has(c.playerId) ? (
                          <Tip
                            className="shrink-0 text-[10px] leading-none text-gold"
                            text={`${adjustments.get(c.playerId)}. Straight from Sleeper — this week has not been scored yet, so it is not in the committed data.`}
                          >
                            ●
                          </Tip>
                        ) : null}
                        <ValueBadge
                          costRound={costRound(c, adp[c.playerId], draftRounds)}
                          adp={adp[c.playerId]}
                        />
                        <KeepPips used={c.keepsUsed} total={c.keepsUsed + c.keepsRemaining} />
                        <span
                          className={`tabular w-9 shrink-0 text-right text-sm font-bold ${
                            c.expired ? "text-loss" : "text-accent"
                          }`}
                        >
                          R{costRound(c, adp[c.playerId], draftRounds)}
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
