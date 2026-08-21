"use client";

import { PunishmentLedger } from "@/components/punishment-ledger";
import { SampleBadge } from "@/components/punishment-tracker";
import { Panel, PanelHeader, Skeleton } from "@/components/ui";
import { usePunishments } from "@/lib/punishments-live";
import {
  buildLedger,
  ledgerTotals,
  type DerivedLow,
  type TeamMap,
} from "@/lib/punishments";

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
 *
 * IT RESERVES ITS SPACE WHILE THE SHEET ANSWERS, though, as long as the season
 * has weeks on the board. It sits in the middle of a long page, so appearing
 * late shoved the brackets and every matchup down under the reader — and the
 * week, the loser and the score are all known from the build anyway, so the
 * placeholder is the real table with two columns pending rather than a grey
 * box.
 *
 * The one case that still moves: a season with weeks lost that the sheet has no
 * record of. The panel is drawn and then withdrawn. That is every season before
 * the league started tracking this, which for the only league that does is none
 * — and the alternative, a permanent panel saying there is nothing to say, is
 * the thing this component was written to avoid.
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

  // Everything the build knows: a row per week lost, with the punishment and the
  // completion still to come. Also what the panel is drawn from while waiting.
  const pending = buildLedger(null, lows);

  if (status !== "ready") {
    // An outage leaves the page as it was rather than showing a broken panel —
    // nothing else here depends on the sheet.
    if (status === "error" || !pending.length) return null;
    return (
      <Shell
        season={season}
        meta={<Skeleton className="h-3 w-24" />}
        isMock={isMock}
      >
        <PunishmentLedger rows={pending} teams={teams} names={names} loading />
      </Shell>
    );
  }

  const feedSeason = feed.seasons.find((s) => s.season === season) ?? null;
  if (!feedSeason) return null;

  const rows = buildLedger(feedSeason, lows);
  if (!rows.length) return null;

  const totals = ledgerTotals(rows);

  return (
    <Shell
      season={season}
      meta={`${totals.completed} of ${totals.assigned} completed`}
      isMock={isMock}
    >
      <PunishmentLedger rows={rows} teams={teams} names={names} />
    </Shell>
  );
}

/**
 * The panel around the ledger, identical in both states.
 *
 * Shared so the header, the link and the badge cannot drift between the
 * placeholder and the real thing — if they did, the swap would be visible as
 * exactly the jump this is here to prevent.
 */
function Shell({
  season,
  meta,
  isMock,
  children,
}: {
  season: number;
  meta: React.ReactNode;
  isMock: boolean;
  children: React.ReactNode;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Weekly Punishments"
        meta={meta}
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
      {children}
    </Panel>
  );
}
