import Link from "next/link";

import { Tip } from "@/components/tooltip";
import { Col, ListHeader } from "@/components/ui";
import { formatCompleted, teamFor, type LedgerRow, type TeamMap } from "@/lib/punishments";

/**
 * The people on a team, each their own link.
 *
 * A CO-OWNED TEAM IS NAMED IN FULL — "Robbie & Thomas", not just the primary
 * owner the low is keyed to. Both of them lost that week and both owe the
 * punishment, so naming one is simply wrong.
 *
 * Each name is a separate link and carries its own `data-owner`, the same way
 * the finish timeline splits a shared label: the team is one thing, but the
 * people are two, and identity highlighting has to be able to pick one of them
 * out. A joined string would light up both for whoever is browsing.
 */
export function TeamNames({
  season,
  slugs,
  teams,
  names,
}: {
  season: number;
  slugs: string[];
  teams: TeamMap;
  names: Record<string, string>;
}) {
  if (!slugs.length) return <span className="text-chalk-600">—</span>;
  const people = slugs.flatMap((slug) => teamFor(teams, names, season, slug));
  return (
    <>
      {people.map((p, i) => (
        <span key={`${p.slug}-${i}`}>
          {i > 0 ? <span className="text-chalk-600"> &amp; </span> : null}
          <Link
            href={`/owners/${p.slug}/`}
            data-owner={p.slug}
            className="font-medium transition-colors hover:text-accent"
          >
            {p.label}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * Which week drew which punishment, and whether it has been served.
 *
 * THE ONE RENDERER for a ledger row. It appears on `/punishments/` and on a
 * season's own page, and the site has been bitten before by two renderers for
 * the same thing drifting apart — which is why lineups live only on the matchup
 * page. Same rule here.
 *
 * ONE LINE PER ROW. Fourteen rows is a table, and a table that spends two lines
 * a row reads as a feed of events rather than a season at a glance.
 *
 * The column widths live in `COL` because a `ListHeader` cell has to repeat the
 * width class of the row cell beneath it — these lists are flex rows, not
 * `<table>`s, so a header does not come for free. One definition each, or the
 * columns drift apart the first time one of them is tweaked.
 *
 * NO 🚽 GLYPH ON A ROW. Every row in this table is a weekly low by construction,
 * so marking each one says nothing and costs width the punishment needs.
 */
const COL = {
  week: "w-7 shrink-0",
  owner: "w-24 shrink-0 sm:w-40",
  punishment: "min-w-0 flex-1",
  // Supporting detail, and the first thing to go when a phone runs out of room:
  // who owes what survives without it, and the punishment text does not.
  score: "hidden w-16 shrink-0 text-right sm:block",
  status: "w-[4.25rem] shrink-0 text-right",
};

export function PunishmentLedger({
  rows,
  teams,
  names,
}: {
  rows: LedgerRow[];
  /** Season-scoped team rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  /** Owner slug -> display name. */
  names: Record<string, string>;
}) {
  return (
    <>
      <ListHeader>
        <Col className={COL.week}>Wk</Col>
        <Col className={COL.owner}>Loser</Col>
        <Col className={COL.punishment}>Punishment</Col>
        <Col className={COL.score} hint="Their score that week — the lowest in the league">
          Score
        </Col>
        <Col className={COL.status}>Done</Col>
      </ListHeader>

      <ol className="divide-y divide-ink-700">
        {rows.map((row) => (
          <li key={row.week} className="flex items-center gap-3 px-4 py-1.5 sm:px-5">
            <span className={`tabular text-[11px] font-bold text-chalk-600 ${COL.week}`}>
              {row.week}
            </span>

            <span className={`truncate text-sm ${COL.owner}`}>
              <TeamNames season={row.season} slugs={row.losers} teams={teams} names={names} />
              {row.disagrees ? <Disagreement row={row} names={names} /> : null}
            </span>

            <span className={COL.punishment}>
              {row.punishment ? (
                // Native title, not a Tip: a tooltip trigger on every row would
                // underline the whole column on hover and read as interactive.
                <span className="block truncate text-sm text-chalk-300" title={row.punishment.text}>
                  {row.punishment.text}
                </span>
              ) : row.punishmentId != null ? (
                // An id the suggestion table has no row for — always a sheet
                // error. Named, not numbered: the id is bookkeeping, and it is in
                // the tooltip for whoever has to go and fix it.
                <Tip
                  text={`The sheet assigned punishment #${row.punishmentId} for week ${row.week}, which is not in this season's suggestions.`}
                  className="text-sm text-gold"
                >
                  Unknown punishment
                </Tip>
              ) : (
                <span className="text-sm text-chalk-600">Not drawn yet</span>
              )}
            </span>

            <span className={`tabular text-xs text-chalk-500 ${COL.score}`}>
              {row.points == null ? (
                "—"
              ) : row.matchupId ? (
                <Link
                  href={`/matchups/${row.matchupId}/`}
                  className="transition-colors hover:text-accent"
                >
                  {row.points.toFixed(2)}
                </Link>
              ) : (
                row.points.toFixed(2)
              )}
            </span>

            <span className={COL.status}>
              <Status row={row} />
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * The sheet named someone other than the team that actually scored lowest.
 *
 * Sleeper's answer is the one rendered — it is measured from the scores — so
 * this marks a row that needs correcting in the sheet rather than changing what
 * the site says.
 */
function Disagreement({ row, names }: { row: LedgerRow; names: Record<string, string> }) {
  const label = (slugs: string[]) => slugs.map((s) => names[s] ?? s).join(" & ");
  return (
    <Tip
      text={`The sheet has ${label(row.sheetLosers)} for this week, but the scores say ${label(
        row.losers,
      )}. Showing the scores — the sheet needs correcting.`}
      className="ml-1 text-gold"
    >
      <span aria-label="Sheet disagrees with the scores">⚠</span>
    </Tip>
  );
}

function Status({ row }: { row: LedgerRow }) {
  if (row.completed) {
    return (
      <span className="tabular whitespace-nowrap text-[11px] font-semibold text-win">
        ✓ {formatCompleted(row.completed)}
      </span>
    );
  }
  if (row.punishmentId == null) {
    return <span className="text-[11px] font-semibold text-chalk-600">—</span>;
  }
  return (
    <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-loss">
      Owed
    </span>
  );
}
