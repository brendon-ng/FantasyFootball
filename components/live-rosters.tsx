"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import { positionRank } from "@/lib/espn-maps";
import { useLiveRosters } from "@/lib/live";
import { buildNameIndex, matchLivePlayer, type NameIndex } from "@/lib/player-match";
import type { LeagueRef } from "@/lib/league-ref";
import type { LiveRosterPlayer } from "@/lib/live/types";
import type { LiveSeason, PlayerMeta } from "@/lib/types";

/**
 * Every team's roster, as it stands right now.
 *
 * LIVE, NOT BAKED, and it has to be: sync withholds a season's rosters until the
 * season is OVER, so there is no committed roster for the year being played. A
 * draft, a waiver claim and a trade all move these daily.
 *
 * NAMES COME FROM THE PROVIDER FIRST ON ESPN. `LiveRoster.players` is Sleeper
 * ids and only about a quarter of a freshly drafted ESPN roster has one, so a
 * list built from ids shows a quarter of each team and silently drops the rest.
 * `LiveRoster.detail` carries the provider's own name, position and pro team —
 * see `LiveRosterPlayer`. The baked index still wins where it has an entry, since
 * that is the name the rest of the site uses.
 */
export function LiveRosters({
  leagueRef,
  live,
  ownerNames,
  players,
}: {
  leagueRef: LeagueRef | null;
  live: LiveSeason | null;
  ownerNames: Record<string, string>;
  /** The baked index. Also decides which names can link — a page exists per key. */
  players: Record<string, PlayerMeta>;
}) {
  const rosters = useLiveRosters(leagueRef);
  /**
   * Built once, not per row: a roster panel resolves ~160 names against a
   * few hundred players, and rebuilding the index inside the row would make
   * that quadratic.
   */
  const nameIndex = useMemo(() => buildNameIndex(players), [players]);

  const name = (slug: string) => ownerNames[slug] ?? slug;
  const teamOf = (rosterId: number) => live?.teams.find((t) => t.rosterId === rosterId);
  const label = (rosterId: number): string => {
    const t = teamOf(rosterId);
    if (!t) return `Roster ${rosterId}`;
    return (t.ownerSlugs?.length ? t.ownerSlugs : [t.ownerSlug]).map(name).join(" & ");
  };

  const list = rosters.data ?? [];
  // Standings order, so the panel reads the same way as the table above it.
  const ordered = [...list].sort(
    (a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor,
  );

  return (
    <Panel>
      <PanelHeader
        title="Rosters"
        meta={ordered.length ? `${ordered.length} teams` : undefined}
        legend="As they stand right now, straight from the league — not the archive."
      />
      {rosters.status === "error" || (rosters.status === "ready" && !ordered.length) ? (
        <EmptyState>Rosters appear once the draft has run.</EmptyState>
      ) : (
        <div className="grid gap-px bg-ink-600 sm:grid-cols-2 lg:grid-cols-3">
          {(ordered.length
            ? ordered
            : // Skeleton: the panel keeps its shape while the league answers, so
              // the page below it does not jump when the rosters land.
              Array.from({ length: 6 }, () => null)
          ).map((r, i) => (
            <div key={r?.rosterId ?? `pending-${i}`} className="min-w-0 bg-ink-850 p-3 sm:p-4">
              {r ? (
                <div className="mb-2 truncate text-sm font-semibold text-chalk-200">
                  <span data-owner={teamOf(r.rosterId)?.ownerSlug}>{label(r.rosterId)}</span>
                  {teamOf(r.rosterId)?.teamName ? (
                    <span className="ml-1.5 text-[11px] font-normal text-chalk-600">
                      {teamOf(r.rosterId)?.teamName}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="skeleton mb-2 h-4 w-32 rounded" />
              )}
              {r ? (
                <ol className="space-y-0.5">
                  {sortRoster(r.detail).map((p) => (
                    <RosterRow key={p.id} player={p} players={players} index={nameIndex} />
                  ))}
                </ol>
              ) : (
                <div className="space-y-1.5">
                  {Array.from({ length: 8 }, (_, k) => (
                    <div key={k} className="skeleton h-3 w-full rounded" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** QB, RB, WR, TE, K, DEF — then by name, so a card reads like a depth chart. */
const sortRoster = (detail: LiveRosterPlayer[]): LiveRosterPlayer[] =>
  [...detail].sort(
    (a, b) =>
      positionRank(a.position) - positionRank(b.position) ||
      (a.name ?? a.id).localeCompare(b.name ?? b.id),
  );

function RosterRow({
  player,
  players,
  index,
}: {
  player: LiveRosterPlayer;
  players: Record<string, PlayerMeta>;
  index: NameIndex;
}) {
  /**
   * The provider's id is not enough on ESPN — see `matchLivePlayer`. Falling
   * straight through to plain text left James Cook and Amon-Ra St. Brown
   * unclickable purely because Sleeper publishes no `espn_id` for them.
   */
  const matchedId = matchLivePlayer(player, players, index);
  const meta = matchedId ? players[matchedId] : undefined;
  // NAME: the baked index first, because that is what the rest of the site
  // shows — "James Cook", not ESPN's "James Cook III". The id only if both fail.
  const shown = meta?.full_name ?? player.name ?? player.id;
  const pos = meta?.position ?? player.position;
  // TEAM: the PROVIDER first, the other way round. `PlayerMeta.team` is recorded
  // per season and goes stale the moment somebody is traded, whereas the live
  // roster is where the player is today.
  const team = player.team ?? meta?.team;

  const body = (
    <>
      <span className="w-8 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
        {pos ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate">{shown}</span>
      <span className="shrink-0 text-[10px] text-chalk-600">{team ?? ""}</span>
    </>
  );

  return (
    <li className="flex items-baseline gap-1.5 text-[13px] text-chalk-400">
      {/* LINKED ONLY WHERE A PAGE EXISTS. `/players/<id>/` is generated per key
          of the baked index, so a player the site has never referenced — a 2026
          rookie, typically — has nowhere to go and stays plain text. */}
      {meta ? (
        <Link
          href={`/players/${matchedId}/`}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 transition-colors hover:text-accent"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
