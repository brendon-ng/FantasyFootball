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
export function PlayerUsageTable({
  rows,
  ownerNames,
}: {
  rows: PlayerUsage[];
  ownerNames: Record<string, string>;
}) {
  const per = (total: number, n: number) => (n ? fmt.pts1(total / n) : "—");

  return (
    // Eight columns do not fit a phone. `min-w-max` rather than a fixed floor so
    // the columns size to their content whatever the widest owner name is.
    <div className="overflow-x-auto">
      <div className="max-sm:min-w-max">
        <ListHeader>
          <Col className="w-11 shrink-0">Season</Col>
          <Col className="min-w-[7rem] flex-1">Owner</Col>
          <Col className="w-9 shrink-0 text-right" hint="Games on the roster, bench included">
            G
          </Col>
          <Col className="w-9 shrink-0 text-right" hint="Games started">
            GS
          </Col>
          <Col className="w-16 shrink-0 text-right" hint="Points scored while started — points that counted">
            Start
          </Col>
          <Col className="w-14 shrink-0 text-right" hint="Points per game started">
            /GS
          </Col>
          <Col className="w-16 shrink-0 text-right" hint="Points scored while benched — points that counted for nobody">
            Bench
          </Col>
          <Col className="w-14 shrink-0 text-right" hint="Points per game benched">
            /G
          </Col>
        </ListHeader>
        <ol>
          {rows.map((r, i) => {
            const benched = r.rostered - r.started;
            // The season is printed once per run of rows, so a player who changed
            // hands mid-season reads as one season with several owners.
            const repeat = i > 0 && rows[i - 1].season === r.season;
            return (
              <li
                key={`${r.season}-${r.ownerSlug}`}
                className="flex items-center gap-3 border-b border-ink-700 px-4 py-2 last:border-0 sm:px-5"
              >
                <span className="tabular w-11 shrink-0 text-sm font-bold text-chalk-100">
                  {repeat ? "" : r.season}
                </span>
                <span className="min-w-[7rem] flex-1 truncate text-sm">
                  <Link
                    href={`/owners/${r.ownerSlug}/`}
                    data-owner={r.ownerSlug}
                    className="transition-colors hover:text-accent"
                  >
                    {ownerNames[r.ownerSlug] ?? r.ownerSlug}
                  </Link>
                </span>
                <span className="tabular w-9 shrink-0 text-right text-sm text-chalk-400">
                  {r.rostered}
                </span>
                <span className="tabular w-9 shrink-0 text-right text-sm text-chalk-300">
                  {r.started}
                </span>
                <span className="tabular w-16 shrink-0 text-right text-sm font-semibold text-chalk-100">
                  {fmt.pts1(r.startPoints)}
                </span>
                <span className="tabular w-14 shrink-0 text-right text-sm text-chalk-400">
                  {per(r.startPoints, r.started)}
                </span>
                <span
                  className={`tabular w-16 shrink-0 text-right text-sm ${
                    r.benchPoints > 0 ? "text-loss" : "text-chalk-600"
                  }`}
                >
                  {fmt.pts1(r.benchPoints)}
                </span>
                <span className="tabular w-14 shrink-0 text-right text-sm text-chalk-600">
                  {per(r.benchPoints, benched)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
