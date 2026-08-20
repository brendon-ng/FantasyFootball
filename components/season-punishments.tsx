"use client";

import { PunishmentLedger } from "@/components/punishment-ledger";
import { SampleBadge } from "@/components/punishment-tracker";
import { Panel, PanelHeader } from "@/components/ui";
import { usePunishments } from "@/lib/punishments-live";
import { buildLedger, ledgerTotals, type DerivedLow, type TeamMap } from "@/lib/punishments";

/**
 * A finished season's punishment record, on that season's own page.
 *
 * THE WHOLE LEDGER, not a teaser. It is one row per regular-season week — the
 * same fourteen the standings above it are built from — so summarising it would
 * cost a click to save nothing. `/punishments/` earns its place by carrying the
 * ballot, the remaining pool and the per-owner tally on top of this.
 *
 * RENDERS NOTHING when the sheet has no record of the season, rather than an
 * empty panel: the league only started tracking this in 2025, and every earlier
 * season would otherwise grow a panel saying so.
 */
export function SeasonPunishments({
  season,
  lows,
  teams,
  names,
  src,
  isMock,
}: {
  season: number;
  lows: DerivedLow[];
  /** Season-scoped team rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  names: Record<string, string>;
  src: string;
  isMock: boolean;
}) {
  const { status, feed } = usePunishments(src);
  if (status !== "ready") return null;

  const feedSeason = feed.seasons.find((s) => s.season === season) ?? null;
  if (!feedSeason) return null;

  const rows = buildLedger(feedSeason, lows);
  if (!rows.length) return null;

  const totals = ledgerTotals(rows);

  return (
    <Panel>
      <PanelHeader
        title="Weekly Punishments"
        meta={`${totals.completed} of ${totals.assigned} served`}
        // Lands on THIS season, not on whichever is newest. The tracker keeps its
        // selection in the query string precisely so a link can address one.
        href={`/punishments/?season=${season}`}
        hrefLabel="Full tracker"
      />
      {isMock ? (
        <div className="border-b border-ink-600 px-4 py-2 sm:px-5">
          <SampleBadge />
        </div>
      ) : null}
      <PunishmentLedger rows={rows} teams={teams} names={names} />
    </Panel>
  );
}
