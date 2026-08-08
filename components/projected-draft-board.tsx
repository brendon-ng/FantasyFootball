"use client";

import Link from "next/link";
import { PROVIDER_NAME, type LeagueRef } from "@/lib/league-ref";

import { PositionPill } from "@/components/keeper-table";
import { adpIsConsensusOnly, adpSortKey, adpTitle, adpValue } from "@/lib/adp-format";
import { EmptyState } from "@/components/ui";
import {
  costRound,
  buildBoard,
  overallPick,
  pickInRound,
  pickLabel,
  type BoardPick,
  type DraftShape,
} from "@/lib/draft-slots";
import { placeKeepers } from "@/lib/keeper-placement";
import { LiveStatus, useLiveDraft, useLiveRosters, useLiveTradedPicks } from "@/lib/live";
import type { AdpEntry } from "@/lib/data";
import type { KeeperContract, PlayerMeta } from "@/lib/types";

/**
 * The draft as it currently projects: who owns each pick, and which keepers land
 * where.
 *
 * ENTIRELY LIVE. Every input moves right up to the draft — the order is drawn
 * after the keeper deadline, picks trade until the last minute, and keeper
 * selections change hourly. None of it is committed until the draft completes, at
 * which point `derive` writes the real board to `drafts.json` and
 * `/history/<season>/draft/` renders that instead.
 *
 * A keeper occupies a pick, so that pick is GONE for drafting. Showing the board
 * without them would overstate what a team can still do with its picks, which is
 * the whole question this page exists to answer.
 */

/**
 * A hypothetical laid over the live board.
 *
 * NOT A MOCK. Every other stand-in in this codebase only fills in a value Sleeper
 * has not published yet, so it stops mattering on its own. This deliberately
 * CONTRADICTS live data — that is what makes it useful for planning and what
 * makes it dangerous to render unlabelled. Supplied only by /lab; `/keepers`
 * passes nothing and is unaffected.
 */
export interface BoardOverride {
  /** slot -> rosterId. Replaces Sleeper's order, and counts as the order being set. */
  order: Record<number, number> | null;
  /** rosterId -> playerIds. A roster absent here keeps whatever Sleeper says. */
  keepers: Record<number, string[]>;
}

export function ProjectedDraftBoard({
  leagueRef,
  season,
  contracts,
  players,
  userIdToSlug,
  ownerNames,
  maxKeepers,
  adp,
  draftRounds,
  override,
  showAdp = false,
  fillEmptyPicks = false,
  starred,
  onOpenPlayer,
}: {
  leagueRef: LeagueRef | null;
  season: number;
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  maxKeepers: number;
  adp: Record<string, AdpEntry>;
  /** Last round of the draft — the floor an expired contract is revalued to. */
  draftRounds: number;
  override?: BoardOverride;
  /**
   * Price each keeper against the market — his ADP rank, and cost round minus
   * market round beside it.
   *
   * Off for `/keepers`, on for `/lab`. Note this is the OPPOSITE call to
   * `/history/<season>/draft/`, which deliberately has no ADP column — pricing a
   * 2024 pick against today's market compares a draft to a market that did not
   * exist. Here the draft has not happened, so today's market is the right
   * yardstick.
   */
  showAdp?: boolean;
  /**
   * Fill every UNSPENT pick with whoever ADP says is still available there.
   *
   * Separate from `showAdp` and separately toggleable, because they differ in
   * kind: a keeper's price is a fact about a contract, while a fill-in is a
   * projection nobody has acted on. The most useful thing on the board is also
   * the most speculative, so it has to be easy to turn off.
   */
  fillEmptyPicks?: boolean;
  /**
   * Your watchlist, marked on the grid.
   *
   * The point is not the keepers — you already know who you kept. It is the ADP
   * fill-ins: star your targets in the pool list and this shows which of YOUR
   * picks they are projected to fall to, which is the question the two surfaces
   * together exist to answer.
   */
  starred?: Set<string>;
  /**
   * Open a player detail modal instead of navigating to his page.
   *
   * Only the lab passes it. On `/keepers` a kept name stays an ordinary link —
   * that page has no scenario to lose your place in.
   */
  onOpenPlayer?: (playerId: string) => void;
}) {
  // Naming the service rather than assuming Sleeper: a season has a provider,
  // and this board is reachable from any keeper league.
  const providerName = PROVIDER_NAME[leagueRef?.provider ?? "sleeper"];
  const draft = useLiveDraft(leagueRef);
  const traded = useLiveTradedPicks(leagueRef);
  const rosters = useLiveRosters(leagueRef);

  const loading =
    draft.status === "loading" || traded.status === "loading" || rosters.status === "loading";
  if (loading) {
    return <EmptyState>Loading the draft…</EmptyState>;
  }
  if (draft.status === "error" || !draft.data) {
    return <EmptyState>{providerName} did not return a draft for {season}.</EmptyState>;
  }

  const d = draft.data;

  // Once the draft has run this board is a projection of the past. The real one
  // is derived from the committed picks — `sync` writes them the moment the draft
  // completes, and derive records them without waiting for the season to end.
  if (d.status === "complete") {
    return (
      <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
        <p className="flex items-center justify-center gap-2">
          {d.mocked ? (
            <span
              className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold"
              title="?mockDraft=true — the draft has not actually run."
            >
              Mock
            </span>
          ) : null}
          The {season} draft is done.
        </p>
        <p className="mt-2 text-[11px]">
          <Link href={`/history/${season}/draft/`} className="hover:text-accent">
            See the board as it happened →
          </Link>
          {d.mocked ? (
            <span className="ml-2 text-chalk-600">
              (that page exists once the real picks are committed)
            </span>
          ) : null}
        </p>
      </div>
    );
  }

  // The order is what makes a board possible. Before it is drawn Sleeper still
  // reports a slot map, but it is the identity placeholder — rendering it would
  // claim a running order nobody has drawn. A scenario order counts: the whole
  // point of /lab is running the board before anyone has drawn one.
  if (!d.orderSet && !override?.order) {
    return (
      <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
        <p>The draft order has not been drawn yet.</p>
        <p className="mt-1 text-[11px]">
          Bylaws set it after the keeper deadline. This board fills in as soon as
          {" "}{providerName} has it — nothing here needs a redeploy.
        </p>
      </div>
    );
  }

  const shape: DraftShape = {
    rounds: d.rounds,
    teams: d.teams,
    type: d.type,
    slotToRoster: override?.order ?? d.slotToRoster,
    reversalRound: d.reversalRound,
  };

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }

  const board = buildBoard(shape, traded.data ?? []);

  // Keepers each team has actually locked in on Sleeper, not every eligible
  // contract — the board should show what is really happening. A scenario
  // replaces this per roster; a roster the scenario says nothing about keeps
  // following Sleeper, so you can change one team and leave the rest real.
  const selectedByRoster = new Map<number, string[]>();
  for (const r of rosters.data ?? []) selectedByRoster.set(r.rosterId, r.keepers ?? []);
  for (const [rosterId, playerIds] of Object.entries(override?.keepers ?? {})) {
    selectedByRoster.set(Number(rosterId), playerIds);
  }

  // Shared with the lab's available-pool list, which needs the same per-round
  // counts to draw its round breaks. See lib/keeper-placement.ts.
  const placement = placeKeepers({
    board,
    rounds: shape.rounds,
    selectedByRoster,
    contracts,
    adp,
    draftRounds,
    maxKeepers,
  });
  const keeperAt = new Map<string, { playerId: string; ownerSlug: string | null }>();
  for (const [key, v] of placement.byPick) {
    keeperAt.set(key, { playerId: v.playerId, ownerSlug: rosterToSlug.get(v.rosterId) ?? null });
  }

  const slots = Object.keys(shape.slotToRoster)
    .map(Number)
    .sort((a, b) => a - b);
  const totalKept = keeperAt.size;

  /**
   * Who ADP says is still on the board at each unspent pick.
   *
   * THE KEEPERS COME OFF THE BOARD IMMEDIATELY, but the picks they cost are
   * spread across all 17 rounds. That asymmetry is the whole reason a keeper
   * league's early rounds feel thin: at pick 1 the pool is already missing every
   * kept player, and it only catches up as their pick slots go by. So a keeper
   * cell consumes NO player from the pool — it was never in it — while every
   * live pick takes the next name.
   *
   * Strict ADP order, deliberately. Modelling reaches and positional runs would
   * be guessing; this states the market's own ordering and lets you see the
   * dilution rather than hiding it behind a simulation.
   */
  const projected = new Map<string, AdpEntry>();
  if (fillEmptyPicks) {
    const kept = new Set([...keeperAt.values()].map((k) => k.playerId));
    // Same ordering as the available-pool list, and for the same reason: the
    // board should hand out players in the order the market actually takes them,
    // which is the ADP figure rather than beatadp's consensus rank.
    const pool = Object.values(adp)
      .filter((e) => e.playerId && !kept.has(e.playerId))
      .sort((a, b) => adpSortKey(a) - adpSortKey(b) || a.rank - b.rank);
    let next = 0;
    const inOrder = [...board].sort(
      (a, b) => overallPick(a.round, a.slot, shape) - overallPick(b.round, b.slot, shape),
    );
    for (const p of inOrder) {
      const key = `${p.round}:${p.slot}`;
      if (keeperAt.has(key)) continue;
      const pick = pool[next++];
      if (pick) projected.set(key, pick);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1 pt-3 text-[11px] text-chalk-600 sm:px-5">
        <span className="flex flex-wrap items-center gap-2">
          {/* A scenario board is pixel-identical to the real thing and is asserting
              things nobody has done, so it gets the loudest label on the page.
              Loss red deliberately: violet is reserved for identity and gold
              already means "mocked phase", so red is the only token on this
              surface that cannot be read as something else. */}
          {override?.order || Object.keys(override?.keepers ?? {}).length > 0 ? (
            <span
              className="rounded border border-loss/60 bg-loss/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-loss"
              title="A what-if board built in /lab. The order and/or keeper selections here are yours, not Sleeper's."
            >
              Scenario
            </span>
          ) : null}
          {/* A mocked order renders exactly like a real one, so it says so loudly
              — this is the sort of thing that gets screenshotted and believed. */}
          {d.mocked ? (
            <span
              className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold"
              title="?mockDraftOrder=true — a stand-in order, seeded from the draft id. Sleeper has not drawn one."
            >
              Mock order
            </span>
          ) : null}
          <span>
            {shape.rounds} rounds · {shape.teams} teams · {totalKept} keeper
            {totalKept === 1 ? "" : "s"} placed
          </span>
        </span>
        <LiveStatus status={draft.status} provider={leagueRef?.provider} />
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-1 p-3 sm:p-4"
          style={{ gridTemplateColumns: `2rem repeat(${slots.length}, minmax(8.5rem, 1fr))` }}
        >
          <div />
          {slots.map((slot) => {
            const slug = rosterToSlug.get(shape.slotToRoster[slot]) ?? null;
            return (
              <div key={`h${slot}`} className="min-w-0 border-b border-ink-600 px-1.5 pb-1.5 text-center">
                <div className="eyebrow text-[10px]">{slot}</div>
                {slug ? (
                  <Link
                    href={`/owners/${slug}/`}
                    className="block truncate text-[11px] font-medium text-chalk-400 transition-colors hover:text-accent"
                  >
                    {ownerNames[slug] ?? slug}
                  </Link>
                ) : (
                  <div className="truncate text-[11px] text-chalk-600">—</div>
                )}
              </div>
            );
          })}

          {Array.from({ length: shape.rounds }, (_, i) => i + 1).map((round) => (
            <Row
              key={round}
              round={round}
              slots={slots}
              shape={shape}
              board={board}
              rosterToSlug={rosterToSlug}
              ownerNames={ownerNames}
              players={players}
              keeperAt={keeperAt}
              adp={adp}
              projected={projected}
              starred={starred}
              onOpenPlayer={onOpenPlayer}
              showAdp={showAdp}
              fillEmptyPicks={fillEmptyPicks}
              costOf={(playerId) => {
                const c = contracts.find((x) => x.playerId === playerId);
                return c ? costRound(c, adp[playerId], draftRounds) : null;
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  round,
  slots,
  shape,
  board,
  rosterToSlug,
  ownerNames,
  players,
  keeperAt,
  adp,
  projected,
  starred,
  onOpenPlayer,
  showAdp,
  fillEmptyPicks,
  costOf,
}: {
  round: number;
  slots: number[];
  shape: DraftShape;
  board: BoardPick[];
  rosterToSlug: Map<number, string>;
  ownerNames: Record<string, string>;
  players: Record<string, PlayerMeta>;
  keeperAt: Map<string, { playerId: string; ownerSlug: string | null }>;
  adp: Record<string, AdpEntry>;
  projected: Map<string, AdpEntry>;
  starred?: Set<string>;
  onOpenPlayer?: (playerId: string) => void;
  showAdp: boolean;
  fillEmptyPicks: boolean;
  costOf: (playerId: string) => number | null;
}) {
  // Which way this round runs. Derived from `pickInRound` rather than
  // re-deriving the reversal rule: slot 1 picking first means left-to-right, and
  // that function is the single implementation of the snake (including
  // `reversalRound`, for a draft that flips somewhere other than round 2).
  const forward = pickInRound(round, 1, shape) === 1;
  const snake = shape.type === "snake";

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-0.5 pr-1">
        <span className="tabular text-[11px] font-semibold text-chalk-600">{round}</span>
        {snake ? (
          <span
            aria-hidden
            className="text-[10px] leading-none text-chalk-600"
            title={
              forward
                ? `Round ${round} runs left to right`
                : `Round ${round} runs right to left — the snake turns`
            }
          >
            {forward ? "\u2192" : "\u2190"}
          </span>
        ) : null}
      </div>
      {slots.map((slot) => {
        const pick = board.find((p) => p.round === round && p.slot === slot);
        if (!pick) return <div key={slot} className="rounded border border-dashed border-ink-700" />;
        const key = `${round}:${slot}`;
        const kept = keeperAt.get(key);
        const meta = kept ? players[kept.playerId] : undefined;
        const ownerSlug = rosterToSlug.get(pick.ownerRoster) ?? null;
        const projectedHere = kept || !fillEmptyPicks ? undefined : projected.get(key);
        const keptAdp = kept && showAdp ? adp[kept.playerId] : undefined;
        const keptCost = kept ? costOf(kept.playerId) : null;
        const surplus =
          keptCost != null && keptAdp?.round != null ? keptCost - keptAdp.round : null;
        // Whoever this cell is about, kept or merely projected there.
        const cellPlayer = kept?.playerId ?? projectedHere?.playerId ?? null;
        const isStar = Boolean(cellPlayer && starred?.has(cellPlayer));
        return (
          <div
            key={slot}
            className={`min-w-0 rounded border px-1.5 py-1.5 ${
              kept
                ? "border-accent/40 bg-accent/10"
                : "border-ink-600 bg-ink-850"
            } ${
              // A ring rather than a recolour: the border already carries "kept"
              // and the text already carries position. Gold is free on this
              // surface and survives being scanned across a 17-row grid.
              isStar ? "ring-1 ring-gold/60" : ""
            }`}
          >
            <div className="flex items-center gap-1">
              {isStar ? (
                <span
                  className="shrink-0 text-[10px] leading-none text-gold"
                  title="On your watchlist"
                >
                  {"\u2605"}
                </span>
              ) : null}
              {kept ? <PositionPill position={meta?.position ?? null} /> : null}
              {/* Traded picks name the acquirer, matching the completed board. */}
              {pick.traded ? (
                <span
                  className="min-w-0 shrink truncate rounded border border-sky-400/50 bg-sky-400/10 px-1 text-[10px] font-bold tracking-wide text-sky-300"
                  data-owner={ownerSlug ?? undefined}
                  data-me-exempt
                  title={`Acquired by ${ownerSlug ? (ownerNames[ownerSlug] ?? ownerSlug) : "—"}`}
                >
                  → {ownerSlug ? (ownerNames[ownerSlug] ?? ownerSlug).split(" ")[0] : "—"}
                </span>
              ) : null}
              <span className="tabular ml-auto text-[10px] text-chalk-600">
                {pickLabel(round, slot, shape)}
              </span>
            </div>
            {kept ? (
              onOpenPlayer ? (
                <button
                  type="button"
                  onClick={() => onOpenPlayer(kept.playerId)}
                  className="mt-1 block w-full truncate text-left text-[11px] font-medium leading-tight transition-colors hover:text-accent"
                >
                  {meta?.full_name ?? kept.playerId}
                </button>
              ) : (
                <Link
                  href={`/players/${kept.playerId}/`}
                  className="mt-1 block truncate text-[11px] font-medium leading-tight transition-colors hover:text-accent"
                >
                  {meta?.full_name ?? kept.playerId}
                </Link>
              )
            ) : projectedHere ? (
              // Italic and dim: nobody has drafted this player. It is the market's
              // guess at who is here, not a claim that he lands here.
              <button
                type="button"
                onClick={() =>
                  projectedHere.playerId && onOpenPlayer?.(projectedHere.playerId)
                }
                disabled={!onOpenPlayer}
                className="mt-1 block w-full truncate text-left text-[11px] italic leading-tight text-chalk-500 transition-colors enabled:hover:text-accent"
                title={`${adpTitle(projectedHere)}\n\nWho the market says is still available at this pick. Nobody has drafted him.`}
              >
                {projectedHere.name}
              </button>
            ) : (
              <div className="mt-1 truncate text-[11px] leading-tight text-chalk-600">—</div>
            )}
            <div className="mt-0.5 flex items-center gap-1">
              <span className="min-w-0 truncate text-[10px] text-chalk-600">
                {kept
                  ? [meta?.team, keptAdp ? `ADP ${adpValue(keptAdp) ?? "—"}` : null]
                      .filter(Boolean)
                      .join(" · ")
                  : projectedHere
                    ? `${projectedHere.position ?? ""} · ADP ${adpValue(projectedHere) ?? "—"}${
                        adpIsConsensusOnly(projectedHere) ? "°" : ""
                      }`
                    : ""}
              </span>
              {kept && showAdp && surplus !== null ? (
                // costRound - adpRound. Positive means the pick is later than the
                // market asks, i.e. the keeper is a bargain. Rounds count up as
                // value counts down, so the sign is easy to read backwards.
                <span
                  className={`tabular ml-auto shrink-0 text-[10px] font-bold ${
                    surplus > 0 ? "text-accent" : surplus < 0 ? "text-loss" : "text-chalk-600"
                  }`}
                  title={`Costs R${keptCost}, market has him in round ${keptAdp?.round}`}
                >
                  {surplus > 0 ? `+${surplus}` : surplus}
                </span>
              ) : kept ? (
                <span className="ml-auto shrink-0 text-[9px] font-bold tracking-wide text-accent">
                  KEPT
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
