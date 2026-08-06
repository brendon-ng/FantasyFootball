import Link from "next/link";

import { Col, ListHeader, fmt } from "@/components/ui";
import type { PlayerUsage } from "@/lib/types";

/**
 * What each owner got out of this player, season by season.
 *
 * The transaction log beside it says who had him and when; this says whether
 * having him was worth anything. A player can sit on three rosters in a season
 * and only ever count for one of them.
 *
 * BENCH POINTS ARE THE INTERESTING COLUMN. They are what he scored for nobody —
 * the cost of guessing wrong — and there is nowhere else on the site to see them.
 *
 * Averages divide by the games in that state, not by games rostered: a player
 * started twice and benched twelve times has a start average over two, which is
 * the number that answers "was he any good when I played him".
 */
/** Shared by the header and every row, so the columns cannot drift apart. */
const SPACING = "gap-2 px-3 sm:px-4";

export function PlayerUsageTable({
  rows,
  ownerLabels,
}: {
  rows: PlayerUsage[];
  /**
   * `season|slug` -> display name, from `creditedNames`.
   *
   * FIRST NAMES, and co-owned teams read "Jaymie & Katie" — a shared team is two
   * people, and naming only the primary is the half-truth the standings stopped
   * telling. Credit is per SEASON, because who co-owns a team changes.
   */
  ownerLabels: Record<string, string>;
}) {
  const per = (total: number, n: number) => (n ? fmt.pts1(total / n) : "—");

  return (
    // Eight columns are a squeeze even on a desktop, because this panel is half
    // the page. Each is sized to its content — a points figure is five characters
    // — so the last one is not pushed off the right edge, where it read as having
    // been removed rather than scrolled past.
    <div className="overflow-x-auto">
      <div className="max-sm:min-w-max">
        <ListHeader className={SPACING}>
          {/* "Year", not "Season". The column only has to hold four digits, so it
              is `w-10` — but "SEASON" at the header's tracking runs wider than
              that and nothing clips it, so it ran into the owner beside it. */}
          <Col className="w-10 shrink-0">Year</Col>
          <Col className="min-w-[4.5rem] flex-1">Owner</Col>
          <Col className="w-7 shrink-0 text-right" hint="Games on the roster, bench included">
            G
          </Col>
          <Col className="w-8 shrink-0 text-right" hint="Games started">
            GS
          </Col>
          <Col className="w-12 shrink-0 text-right" hint="Points scored while started — points that counted">
            Start
          </Col>
          <Col className="w-11 shrink-0 text-right" hint="Points per game started">
            /GS
          </Col>
          <Col className="w-12 shrink-0 text-right" hint="Points scored while benched — points that counted for nobody">
            Bench
          </Col>
          <Col className="w-11 shrink-0 text-right" hint="Points per game benched">
            /G
          </Col>
          <Col
            className="w-12 shrink-0 text-right"
            hint="Every point he scored on this roster, started or benched, per game rostered"
          >
            All/G
          </Col>
        </ListHeader>
        <ol>
          {rows.map((r, i) => {
            const benched = r.rostered - r.started;
            // A SEASON CHANGE GETS A HEAVIER RULE than a change of owner within
            // one. Rows are compact and most seasons are a single row, so with a
            // uniform divider a year split across two owners looked exactly like
            // two separate years.
            const newSeason = i === 0 || rows[i - 1].season !== r.season;
            return (
              <li
                key={`${r.season}-${r.ownerSlug}`}
                className={`flex items-center py-2 ${SPACING} ${
                  i === 0
                    ? ""
                    : newSeason
                      ? "border-t-2 border-t-ink-500"
                      : "border-t border-ink-700"
                }`}
              >
                {/* Printed on EVERY row. Blanking it on a repeat was meant to
                    group a season split across owners, and instead read as a row
                    with no year at all. */}
                {/* Still printed on a continuation row — blanking it read as a
                    row with no year — but dimmed, so the block's first row is
                    where the eye lands. */}
                <span
                  className={`tabular w-10 shrink-0 text-sm ${
                    newSeason ? "font-bold text-chalk-100" : "text-chalk-600"
                  }`}
                >
                  {r.season}
                </span>
                <span className="min-w-[4.5rem] flex-1 truncate text-sm">
                  <Link
                    href={`/owners/${r.ownerSlug}/`}
                    data-owner={r.ownerSlug}
                    className="transition-colors hover:text-accent"
                  >
                    {ownerLabels[`${r.season}|${r.ownerSlug}`] ?? r.ownerSlug}
                  </Link>
                </span>
                <span className="tabular w-7 shrink-0 text-right text-sm text-chalk-400">
                  {r.rostered}
                </span>
                <span className="tabular w-8 shrink-0 text-right text-sm text-chalk-300">
                  {r.started}
                </span>
                <span className="tabular w-12 shrink-0 text-right text-sm font-semibold text-chalk-100">
                  {fmt.pts1(r.startPoints)}
                </span>
                {/* Green: this is the number that counted for the owner. */}
                <span className="tabular w-11 shrink-0 text-right text-sm text-accent">
                  {per(r.startPoints, r.started)}
                </span>
                <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-300">
                  {fmt.pts1(r.benchPoints)}
                </span>
                {/* The RATE carries the colour, not the total. A big bench total
                    over a whole season says less than a big average does: the
                    per-game number is what compares against the start average
                    beside it, and it is the one worth flinching at. */}
                <span
                  className={`tabular w-11 shrink-0 text-right text-sm ${
                    benched && r.benchPoints > 0 ? "text-loss" : "text-chalk-600"
                  }`}
                >
                  {per(r.benchPoints, benched)}
                </span>
                {/* Everything he produced while on this roster, however he was
                    used. The two rates either side are about the owner's choices;
                    this one is about the player. */}
                <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-400">
                  {per(r.startPoints + r.benchPoints, r.rostered)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
