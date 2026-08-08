"use client";

import { useEffect } from "react";
import Link from "next/link";

import { PositionPill } from "@/components/keeper-table";
import { PlayerUsageTable } from "@/components/player-usage";
import { adpIsConsensusOnly, adpSortKey, adpTitle, adpValue, playerAge } from "@/lib/adp-format";
import { costRound } from "@/lib/draft-slots";
import { NFL_GAMES, perGame, statLine } from "@/lib/projection-format";
import type { AdpEntry, Projection } from "@/lib/data";
import type { KeeperContract, PlayerMeta, PlayerUsage } from "@/lib/types";

/**
 * A player, and the NFL team he has to beat out.
 *
 * EXPERIMENTAL, strategy-lab branch only.
 *
 * A MODAL RATHER THAN A LINK AWAY, for the same reason `TradeModal` is one: the
 * question is asked WHILE scanning the pool or the board, and navigating to
 * `/players/<id>` loses the scenario you were reading. The full profile is one
 * click further on; this carries the facts a draft decision turns on.
 *
 * DELIBERATELY NOT A COPY OF THE PLAYER PAGE. Two renderers for one thing drift
 * — the same reason a per-player breakdown lives only on the matchup page. This
 * shows contract, market and depth, and links out for the rest.
 *
 * THE DEPTH CHART IS THE NEW THING. "Is his workload safe" is the question ADP
 * cannot answer, and it is the one that decides whether a late-round contract is
 * a bargain or a trap: a R11 receiver behind two better ones is not the same
 * asset as a R11 receiver who is the only one on his team.
 */

/** How many to show per position. Receivers get more because leagues start more. */
const DEPTH_LIMIT: Record<string, number> = { QB: 3, RB: 3, WR: 5, TE: 3 };
const DEPTH_ORDER = ["QB", "RB", "WR", "TE"] as const;

export function PlayerModal({
  playerId,
  players,
  adp,
  contracts,
  ownerNames,
  keptBy,
  usage,
  usageOwnerLabels,
  outlook,
  outlookCapturedAt,
  projections,
  starred,
  onToggleStar,
  onOpenPlayer,
  draftRounds,
  onClose,
}: {
  playerId: string;
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  contracts: KeeperContract[];
  ownerNames: Record<string, string>;
  /** playerId -> owner slug keeping him in this scenario. */
  keptBy: Map<string, string>;
  /** Season-by-season points and owner, the same table the player page shows. */
  usage: PlayerUsage[];
  usageOwnerLabels: Record<string, string>;
  /** ESPN's written season outlook, or null where they wrote none. */
  outlook: string | null;
  outlookCapturedAt: string | null;
  /** Whole map, not one entry — the depth chart prices teammates too. */
  projections: Record<string, Projection>;
  starred: Set<string>;
  onToggleStar: (playerId: string) => void;
  /**
   * Swap the modal to another player without closing it.
   *
   * Mirrors `TradeModal`'s `onOpenTrade`. Following a depth chart is inherently a
   * chain — you check who is ahead of him, then who is ahead of THAT player — and
   * closing and reopening between each hop would make the chart pointless to
   * have built.
   */
  onOpenPlayer: (playerId: string) => void;
  draftRounds: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const meta = players[playerId];
  const entry = adp[playerId];
  const contract = contracts.find((c) => c.playerId === playerId);
  const team = meta?.team ?? entry?.team ?? null;
  const name = meta?.full_name ?? entry?.name ?? playerId;
  const isStar = starred.has(playerId);
  const age = playerAge(meta?.birth_date);
  const proj = projections[playerId];
  const ppg = perGame(proj);
  const line = statLine(proj);

  /**
   * Everyone on the same NFL team, from the ADP list.
   *
   * ADP RATHER THAN `players.json`, deliberately. The shared player index is
   * narrowed to ids THIS LEAGUE has referenced, which reaches back to 2019 — it
   * carries retired players and stale teams, and a depth chart listing someone
   * who has not played in three years is worse than no depth chart. Every ADP
   * entry is by construction someone the market expects to be drafted this year.
   */
  const teammates = team
    ? Object.values(adp)
        .filter((e) => e.playerId && e.team === team)
        .sort((a, b) => adpSortKey(a) - adpSortKey(b) || a.rank - b.rank)
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name} detail`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/80 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-[54rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-600 bg-ink-800 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => onToggleStar(playerId)}
            aria-pressed={isStar}
            title={isStar ? "Starred — click to remove" : "Star this player"}
            className={`shrink-0 text-lg leading-none transition-colors ${
              isStar ? "text-gold" : "text-ink-400 hover:text-gold"
            }`}
          >
            {isStar ? "★" : "☆"}
          </button>
          <PositionPill position={meta?.position ?? entry?.position ?? null} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-chalk-100">{name}</h2>
            <p className="truncate text-[11px] text-chalk-600">
              {[
                team,
                age != null ? `${age} yrs old` : null,
                meta?.years_exp != null ? `${meta.years_exp} yr exp` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-sm text-chalk-500 hover:text-chalk-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
              label="Proj PPG"
              value={ppg != null ? ppg.toFixed(1) : "—"}
              sub={`Projected PPR points per game — season total over ${NFL_GAMES} games`}
            />
            <Tile
              label="Proj PTS"
              value={proj?.pts_ppr != null ? proj.pts_ppr.toFixed(0) : "—"}
              sub="Projected PPR points for the full NFL regular season"
            />
            <Tile label="ADP" value={adpValue(entry) ?? "—"} sub={adpTitle(entry)} />
            <Tile
              label="Market round"
              value={entry?.round != null ? `R${entry.round}` : "—"}
            />
            <Tile
              label="Keeper cost"
              value={contract ? `R${costRound(contract, entry, draftRounds)}` : "—"}
              sub={contract ? undefined : "No contract — free agent"}
            />
            <Tile
              label="Keeps left"
              value={contract ? String(contract.keepsRemaining) : "—"}
              sub={contract?.keepsRemaining === 1 ? "Final keep year" : undefined}
            />
          </div>

          {line.length ? (
            <div>
              <SectionHeading title="Projected line" note="Sleeper, full NFL season" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
                {line.map((c) => {
                  const headline = c.label === "PTS" || c.label === "PPG";
                  return (
                    <span key={c.label} className="flex items-baseline gap-1.5 text-[11px]">
                      <span className={headline ? "text-accent-dim" : "text-chalk-600"}>
                        {c.label}
                      </span>
                      <span
                        className={`tabular font-medium ${headline ? "text-accent" : "text-chalk-200"}`}
                      >
                        {c.value}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {contract ? (
            <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">
              <p className="text-[11px] text-chalk-500">
                Under contract to{" "}
                <span className="font-medium text-chalk-200" data-owner={contract.ownerSlug ?? undefined}>
                  {contract.ownerSlug ? (ownerNames[contract.ownerSlug] ?? contract.ownerSlug) : "—"}
                </span>{" "}
                since {contract.startSeason} ({contract.origin}).
                {keptBy.has(playerId) ? (
                  <span className="ml-1 text-accent">Kept in this scenario.</span>
                ) : (
                  <span className="ml-1 text-loss">Not kept — back in the draft.</span>
                )}
              </p>
              {contract.provenance?.length ? (
                <ul className="mt-2 space-y-0.5 text-[10px] text-chalk-600">
                  {contract.provenance.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {outlook ? (
            <div>
              <SectionHeading
                title="ESPN season outlook"
                note={
                  outlookCapturedAt
                    ? `written ${outlookCapturedAt.slice(0, 10)} — preseason, never revised`
                    : "preseason, never revised"
                }
              />
              {/* FULL WIDTH, not a reading measure. A 62ch column is right for an
                  article and wrong inside a dialog you are scanning: it doubled
                  the paragraph's height and pushed the depth chart below the
                  fold, which is the thing you actually opened this to see. */}
              <p className="rounded-lg border border-ink-600 bg-ink-850 p-3 text-[12px] leading-relaxed text-chalk-300">
                {outlook}
              </p>
            </div>
          ) : null}

          <div>
            <SectionHeading
              title={`${team ?? "—"} depth by ADP`}
              note="who else is competing for the ball"
            />
            {teammates.length === 0 ? (
              <p className="text-[11px] text-chalk-600">
                No ADP-ranked players for this team — nothing to compare against.
              </p>
            ) : (
              // items-start: a two-man QB room must not inherit the height of a
              // five-deep receiver room and leave a hole under itself.
              <div className="grid items-start gap-2 sm:grid-cols-2">
                {DEPTH_ORDER.map((p) => {
                  const group = teammates
                    .filter((e) => e.position === p)
                    .slice(0, DEPTH_LIMIT[p]);
                  if (!group.length) return null;
                  return (
                    <div key={p} className="rounded-lg border border-ink-600 bg-ink-850 p-2">
                      <div className="mb-1 flex items-center gap-1.5">
                        <PositionPill position={p} />
                        <span className="text-[9px] uppercase tracking-wide text-chalk-600">
                          top {DEPTH_LIMIT[p]}
                        </span>
                      </div>
                      <ul className="space-y-0.5">
                        {group.map((e, i) => {
                          const tid = e.playerId as string;
                          const self = tid === playerId;
                          const owner = keptBy.get(tid);
                          return (
                            <li
                              key={tid}
                              className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] ${
                                self ? "bg-accent/10 font-medium text-accent" : "text-chalk-300"
                              }`}
                            >
                              <span className="tabular w-3 shrink-0 text-chalk-600">{i + 1}</span>
                              <span
                                className="tabular w-10 shrink-0 text-right text-chalk-500"
                                title={adpTitle(e)}
                              >
                                {adpValue(e) ?? "—"}
                                {adpIsConsensusOnly(e) ? (
                                  <span className="text-chalk-600">°</span>
                                ) : null}
                              </span>
                              {self ? (
                                <span className="min-w-0 flex-1 truncate">
                                  {players[tid]?.full_name ?? e.name}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onOpenPlayer(tid)}
                                  className="min-w-0 flex-1 truncate text-left transition-colors hover:text-accent"
                                  title="Open his contract, market and depth"
                                >
                                  {players[tid]?.full_name ?? e.name}
                                </button>
                              )}
                              {/* Age belongs on a depth chart more than anywhere
                                  else: "behind a 31-year-old" and "behind a
                                  23-year-old" are different situations. */}
                              {/* PPG, not just ADP: the depth question is who
                                  produces, and the market can be wrong about the
                                  order in a way a projection is at least explicit
                                  about. */}
                              {perGame(projections[tid]) != null ? (
                                <span
                                  className="tabular shrink-0 text-[9px] text-chalk-500"
                                  title={`Projected ${perGame(projections[tid])!.toFixed(1)} PPR points per game`}
                                >
                                  {perGame(projections[tid])!.toFixed(1)}
                                </span>
                              ) : null}
                              {playerAge(players[tid]?.birth_date) != null ? (
                                <span
                                  className="tabular shrink-0 text-[9px] text-chalk-600"
                                  title={`${playerAge(players[tid]?.birth_date)} years old`}
                                >
                                  {playerAge(players[tid]?.birth_date)}
                                </span>
                              ) : null}
                              {starred.has(tid) ? (
                                <span className="shrink-0 text-[9px] text-gold">★</span>
                              ) : null}
                              {/* Kept means unavailable. On a depth chart that is
                                  the difference between "he is behind someone" and
                                  "he is behind someone you cannot have". */}
                              {owner ? (
                                <span
                                  className="shrink-0 truncate text-[9px] text-chalk-600"
                                  title={`Kept by ${ownerNames[owner] ?? owner}`}
                                >
                                  {(ownerNames[owner] ?? owner).split(" ")[0]}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <SectionHeading
              title="By season and owner"
              note="bench points are what he scored for nobody"
            />
            {usage.length ? (
              <div className="rounded-lg border border-ink-600 bg-ink-850 py-1">
                <PlayerUsageTable rows={usage} ownerLabels={usageOwnerLabels} />
              </div>
            ) : (
              <p className="text-[11px] text-chalk-600">
                Never rostered in this league — no usage to show.
              </p>
            )}
          </div>

          <Link
            href={`/players/${playerId}/`}
            className="inline-block text-[11px] text-chalk-500 underline underline-offset-2 hover:text-accent"
          >
            Full profile — usage, history and every transaction →
          </Link>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold uppercase tracking-wide text-chalk-300">
      {title}
      <span className="font-normal normal-case tracking-normal text-chalk-600">{note}</span>
    </h3>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-2 rounded-md border border-ink-600 bg-ink-850 px-2 py-1.5"
      title={sub}
    >
      <span className="text-[9px] uppercase tracking-wide text-chalk-600">{label}</span>
      <span className="tabular text-[13px] font-semibold text-chalk-100">{value}</span>
    </div>
  );
}
