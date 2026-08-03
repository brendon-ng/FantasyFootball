import Link from "next/link";

import { fmt } from "@/components/ui";
import type { LeagueRecords } from "@/lib/types";

/**
 * The marquee entries from the record book, for the home page.
 *
 * Four short lists rather than one long one: a single ranked list can only answer
 * one question, and "who has gone biggest" and "what was the closest finish" are
 * different questions. Top three each keeps the panel scannable and leaves the
 * depth to /records.
 *
 * Every row links to the matchup, matching the record book — the numbers are only
 * interesting if you can go read the game.
 *
 * Works from a league's first season, so a redraft league with no keeper board
 * still has something real here rather than an empty panel.
 */

interface Entry {
  ownerSlug: string;
  opponentSlug: string | null;
  season: number;
  week: number;
  /** The figure to show — points, or a margin. */
  value: number;
  /** Prefix for a margin, so "+91.7" reads as a gap rather than a score. */
  signed?: boolean;
  /**
   * Both scores, so the row can say whether the team actually WON.
   *
   * A blowout or a closest win is a win by construction, but a high or low week
   * is not: the highest score of a week can still lose, and the lowest can win.
   * Hardcoding "def." would assert a result the data does not support.
   *
   * `opponentPoints` is nullable — an imported bracket game can name an opponent
   * without a score — so an unknown result says "vs" rather than picking one.
   */
  points: number;
  opponentPoints: number | null;
}

const SHOWN = 3;

export function RecordHighlights({
  records,
  ownerNames,
  href,
}: {
  records: LeagueRecords;
  ownerNames: Record<string, string>;
  href: (a: string, b: string | null, season: number, week: number) => string | null;
}) {
  const first = (slug: string | null | undefined) =>
    (slug && ownerNames[slug]?.split(" ")[0]) || "—";
  const full = (slug: string | null | undefined) => (slug && ownerNames[slug]) || "—";

  const sections: Array<{ title: string; hint: string; tone: string; rows: Entry[] }> = [
    {
      title: "Highest week",
      hint: "Most points by one team in a single week",
      tone: "text-accent",
      rows: records.weeklyHigh.slice(0, SHOWN).map((r) => ({ ...r, value: r.points })),
    },
    {
      title: "Lowest week",
      hint: "Fewest points by one team in a single week",
      tone: "text-loss",
      rows: records.weeklyLow.slice(0, SHOWN).map((r) => ({ ...r, value: r.points })),
    },
    {
      title: "Biggest blowout",
      hint: "Largest margin of victory",
      tone: "text-chalk-200",
      rows: records.biggestBlowout
        .slice(0, SHOWN)
        .map((r) => ({ ...r, value: r.margin, signed: true })),
    },
    {
      title: "Closest win",
      hint: "Narrowest margin of victory",
      tone: "text-chalk-200",
      rows: records.narrowestWin
        .slice(0, SHOWN)
        .map((r) => ({ ...r, value: r.margin, signed: true })),
    },
  ];

  return (
    <div className="divide-y divide-ink-700">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="flex items-baseline justify-between gap-2 bg-ink-850/60 px-4 py-1.5 sm:px-5">
            <span className="eyebrow text-[10px]" title={section.hint}>
              {section.title}
            </span>
          </div>
          {section.rows.length ? (
            <ol>
              {section.rows.map((r, i) => {
                const to = href(r.ownerSlug, r.opponentSlug, r.season, r.week);
                const body = (
                  <>
                    <span className="tabular w-4 shrink-0 text-[11px] text-chalk-600">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {/* data-owner, not a profile link — the row links to the
                          GAME, so the viewer-identity rule needs the hook. */}
                      <span data-owner={r.ownerSlug} className="font-medium">
                        {full(r.ownerSlug)}
                      </span>
                      {r.opponentSlug ? (
                        <>
                          <span className="text-chalk-600">
                            {r.opponentPoints == null
                              ? " vs "
                              : r.points > r.opponentPoints
                                ? " def. "
                                : " lost to "}
                          </span>
                          <span data-owner={r.opponentSlug} className="text-chalk-400">
                            {first(r.opponentSlug)}
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="tabular shrink-0 text-[11px] text-chalk-600">
                      {r.season} wk{r.week}
                    </span>
                    <span
                      className={`tabular w-16 shrink-0 text-right text-sm font-semibold ${section.tone}`}
                    >
                      {r.signed ? "+" : ""}
                      {fmt.pts1(r.value)}
                    </span>
                  </>
                );
                const cls =
                  "flex items-center gap-2.5 border-b border-ink-700 px-4 py-2 last:border-0 sm:px-5";
                return (
                  <li key={`${r.season}-${r.week}-${r.ownerSlug}`}>
                    {to ? (
                      <Link href={to} className={`${cls} transition-colors hover:bg-ink-700/40`}>
                        {body}
                      </Link>
                    ) : (
                      <div className={cls}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="px-4 py-4 text-center text-xs text-chalk-600 sm:px-5">
              Nothing on record yet.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
