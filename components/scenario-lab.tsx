"use client";

import { useState } from "react";

import { AvailablePool } from "@/components/available-pool";
import { PlayerModal } from "@/components/player-modal";
import { ProjectedDraftBoard } from "@/components/projected-draft-board";
import { ScenarioEditor, type EditorTeam } from "@/components/scenario-editor";
import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import { buildBoard, type DraftShape } from "@/lib/draft-slots";
import { placeKeepers } from "@/lib/keeper-placement";
import { useScenario } from "@/lib/scenario";
import { useLiveDraft, useLiveRosters, useLiveTradedPicks } from "@/lib/live";
import { PROVIDER_NAME, type LeagueRef } from "@/lib/league-ref";
import type { AdpEntry, Projection } from "@/lib/data";
import type { KeeperContract, PlayerMeta, PlayerUsage } from "@/lib/types";

/**
 * Wires the scenario store to the editor and the board.
 *
 * EXPERIMENTAL, strategy-lab branch only.
 *
 * Client-side because all three inputs are: the rosters come from the live
 * provider in the browser, and the scenario itself lives in localStorage. There is
 * no server to
 * hold any of it — see the static-export constraint in AGENTS.md.
 *
 * The roster list is the join between the two halves. Contracts are keyed by
 * OWNER SLUG (that is what derive produces) and the draft board is keyed by
 * ROSTER ID (that is what Sleeper produces), so nothing can be edited until
 * rosters have loaded and the two can be reconciled.
 */
export function ScenarioLab({
  leagueRef,
  season,
  contracts,
  players,
  adp,
  draftRounds,
  maxKeepers,
  userIdToSlug,
  ownerNames,
  usage,
  usageOwnerLabels,
  outlooks,
  outlookCapturedAt,
  projections,
}: {
  leagueRef: LeagueRef | null;
  season: number;
  contracts: KeeperContract[];
  players: Record<string, PlayerMeta>;
  adp: Record<string, AdpEntry>;
  draftRounds: number;
  maxKeepers: number;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
  usage: Record<string, PlayerUsage[]>;
  /** `season|slug` -> display name, per season, co-owners joined. */
  usageOwnerLabels: Record<string, string>;
  outlooks: Record<string, string>;
  outlookCapturedAt: string | null;
  projections: Record<string, Projection>;
}) {
  const api = useScenario();
  const providerName = PROVIDER_NAME[leagueRef?.provider ?? "sleeper"];
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const rosters = useLiveRosters(leagueRef);
  // The pool list needs the same per-round keeper counts the board computes, so
  // it can show where the round breaks fall. Same hooks, same shared placement —
  // an approximation here would quietly disagree with the grid above it.
  const draft = useLiveDraft(leagueRef);
  const traded = useLiveTradedPicks(leagueRef);

  if (rosters.status === "loading") {
    return <EmptyState>Loading rosters from {providerName}…</EmptyState>;
  }
  if (rosters.status === "error" || !rosters.data?.length) {
    return (
      <EmptyState>
        Could not reach {providerName} for {season} rosters, so there is nothing to build a
        scenario against.
      </EmptyState>
    );
  }

  const byOwner = new Map<string, KeeperContract[]>();
  for (const c of contracts) {
    if (!c.ownerSlug) continue;
    byOwner.set(c.ownerSlug, [...(byOwner.get(c.ownerSlug) ?? []), c]);
  }

  const teams: EditorTeam[] = rosters.data
    .map((r) => {
      const slug = r.ownerId ? (userIdToSlug[r.ownerId] ?? null) : null;
      return {
        rosterId: r.rosterId,
        slug,
        name: slug ? (ownerNames[slug] ?? slug) : `Roster ${r.rosterId}`,
        contracts: slug ? (byOwner.get(slug) ?? []) : [],
        live: r.keepers ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Nothing scenario-shaped renders until localStorage has been read — an effect
  // that set state on mount would flash the un-scenarioed board for a frame.
  if (!api.ready) return <EmptyState>…</EmptyState>;

  // Who is off the board, under the scenario as it stands. Same per-roster rule
  // as everywhere else: a team you have not edited contributes what Sleeper says
  // it has locked in.
  const keptBy = new Map<string, string>();
  const selectedByRoster = new Map<number, string[]>();
  for (const t of teams) {
    const sel = api.scenario.keepers[t.rosterId] ?? t.live;
    selectedByRoster.set(t.rosterId, sel);
    for (const id of sel) if (t.slug) keptBy.set(id, t.slug);
  }

  // Live picks per round, for the pool list's round breaks. Null until the order
  // exists — without it there is no board and no honest count, and the list just
  // renders flat rather than inventing one.
  let livePicksByRound: number[] | null = null;
  const d = draft.data;
  if (d && d.status !== "complete" && (d.orderSet || api.scenario.order)) {
    const shape: DraftShape = {
      rounds: d.rounds,
      teams: d.teams,
      type: d.type,
      slotToRoster: api.scenario.order ?? d.slotToRoster,
      reversalRound: d.reversalRound,
    };
    livePicksByRound = placeKeepers({
      board: buildBoard(shape, traded.data ?? []),
      rounds: shape.rounds,
      selectedByRoster,
      contracts,
      adp,
      draftRounds,
      maxKeepers,
    }).livePicksByRound;
  }

  const starredSet = new Set(api.scenario.starred);

  return (
    <div className="space-y-5">
      <ScenarioEditor
        teams={teams}
        players={players}
        adp={adp}
        draftRounds={draftRounds}
        maxKeepers={maxKeepers}
        api={api}
        providerName={providerName}
      />

      <Panel>
        <PanelHeader
          title={`Projected ${season} Draft Board`}
          meta={api.active ? "scenario" : `live from ${providerName}`}
          legend="Keepers occupy the pick they cost — a green cell is a pick already spent, and the number beside it is cost round minus market round, so positive is a bargain. Anything you have not edited follows the live data."
        />

        {/* Off by choice, not by default: the fill-ins are the most useful thing
            on the board and also the most speculative, so they need to be easy
            to drop when you want to look at the picks alone. */}
        <label className="flex cursor-pointer items-center gap-2 px-4 pt-3 text-[11px] text-chalk-500 sm:px-5">
          <input
            type="checkbox"
            checked={api.scenario.fillAdp}
            onChange={(e) => api.setFillAdp(e.target.checked)}
            className="h-3 w-3 accent-[#00e5a0]"
          />
          <span>
            Fill empty picks with ADP
            <span className="ml-1.5 text-chalk-600">
              — strict market order, keepers removed from the pool. Nobody has drafted these.
            </span>
          </span>
        </label>
        <ProjectedDraftBoard
          leagueRef={leagueRef}
          season={season}
          contracts={contracts}
          players={players}
          userIdToSlug={userIdToSlug}
          ownerNames={ownerNames}
          maxKeepers={maxKeepers}
          adp={adp}
          draftRounds={draftRounds}
          override={{ order: api.scenario.order, keepers: api.scenario.keepers }}
          showAdp
          fillEmptyPicks={api.scenario.fillAdp}
          starred={starredSet}
          onOpenPlayer={setOpenPlayer}
        />
      </Panel>

      <AvailablePool
        adp={adp}
        keptBy={keptBy}
        livePicksByRound={livePicksByRound}
        starred={starredSet}
        onToggleStar={api.toggleStar}
        onClearStars={api.clearStars}
        onOpenPlayer={setOpenPlayer}
        projections={projections}
        contracts={contracts}
        players={players}
        ownerNames={ownerNames}
        draftRounds={draftRounds}
      />

      {openPlayer ? (
        <PlayerModal
          // Keyed on the player so hopping down a depth chart REMOUNTS rather
          // than re-rendering: a tall modal otherwise keeps its scroll offset and
          // the next player opens halfway down his own page.
          key={openPlayer}
          playerId={openPlayer}
          players={players}
          adp={adp}
          contracts={contracts}
          ownerNames={ownerNames}
          keptBy={keptBy}
          usage={usage[openPlayer] ?? []}
          usageOwnerLabels={usageOwnerLabels}
          outlook={outlooks[openPlayer] ?? null}
          outlookCapturedAt={outlookCapturedAt}
          projections={projections}
          starred={starredSet}
          onToggleStar={api.toggleStar}
          onOpenPlayer={setOpenPlayer}
          draftRounds={draftRounds}
          onClose={() => setOpenPlayer(null)}
        />
      ) : null}
    </div>
  );
}
