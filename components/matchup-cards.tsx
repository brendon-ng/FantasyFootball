"use client";

import Link from "next/link";

import { fmt } from "@/components/ui";
import { useMatchupSettled } from "@/lib/live";
import { meetingId } from "@/lib/meeting";
import { matchupMarks, type RecordMark, type RecordThresholds } from "@/lib/record-marks";
import type { LiveSeason } from "@/lib/types";

/**
 * This week's fixtures, as cards.
 *
 * ONE RENDERER FOR TWO SURFACES — the home page's strip and the in-progress
 * season page's panel. They differ only in the box the cards sit in, and every
 * rule that matters is in the card: when a score may be shown, when a lead may
 * be called a win, when a record chip is allowed, and whether a matchup page
 * exists to link to. A second copy would have drifted on the first of those to
 * change, which is the same reason lineups live only on `/matchups/[id]`.
 */

export interface H2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface MatchupCardsProps {
  live: LiveSeason | null;
  ownerNames: Record<string, string>;
  thresholds: RecordThresholds;
  /** All-time head-to-head, owner -> opponent -> record. */
  h2h: Record<string, Record<string, H2HRecord>>;
  /** Newest season with derived data, so matchup pages exist at or below it. */
  archivedThrough: number;
  /**
   * Ids of the in-progress season's fixtures that the BUILD generated a page for.
   *
   * Handed down rather than inferred so the links cannot outrun the pages: both
   * come from `getLiveSchedule()`, so if a build could not reach the provider
   * there are no upcoming pages AND no links to them. Inferring "it is this
   * season, so a page exists" would 404 exactly then.
   */
  upcomingIds?: string[];
  /**
   * `strip` is the home page's horizontally scrolling row; `list` is a stack of
   * rows for a panel, which is the only thing that fits half a two-column grid.
   */
  layout?: "strip" | "list";
}

export function MatchupCards({
  live,
  ownerNames,
  thresholds,
  h2h,
  archivedThrough,
  upcomingIds,
  layout = "strip",
}: MatchupCardsProps) {
  const upcoming = new Set(upcomingIds ?? []);
  /**
   * MARKS AND RESULTS ONLY ONCE A GAME IS SETTLED. A record is a fact about a
   * finished game; a partial score cannot have set one, and half a lineup
   * sitting on 40 points is not the lowest week in league history, it is Sunday
   * lunchtime. Per MATCHUP rather than per week, so a game that is over does not
   * wait on one that is not.
   *
   * Called before the early return below — it is a hook.
   */
  const settled = useMatchupSettled(live);

  if (!live?.matchups.length) return null;
  const started = live.matchups.some((m) => m.a.points > 0 || m.b.points > 0);
  const name = (slug: string) => ownerNames[slug] ?? slug;
  const first = (slug: string) => name(slug).split(" ")[0];
  const recordOf = (slug: string) => live.teams.find((t) => t.ownerSlug === slug);

  /**
   * Every owner of the team, first names joined — "Jaymie & Katie".
   *
   * A co-owned team is one team with two people on it, and naming only the
   * primary makes the card disagree with the standings, which have credited both
   * since the ESPN import. First names because five of these share a row.
   */
  const credited = (slug: string): string => {
    const slugs = recordOf(slug)?.ownerSlugs;
    return (slugs?.length ? slugs : [slug]).map(first).join(" & ");
  };

  /**
   * "All time: Jake leads 5-4".
   *
   * PREFIXED, because a bare "Jake leads 5-4" under two names and two records
   * reads as this season. It is the whole series, going back to 2019.
   */
  const series = (a: string, b: string): string => {
    const r = h2h[a]?.[b];
    const total = r ? r.wins + r.losses + r.ties : 0;
    if (!r || !total) return "All time: first meeting";
    const score = r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
    if (r.wins === r.losses) return `All time: even at ${score}`;
    const leader = r.wins > r.losses ? a : b;
    const flipped = r.ties ? `${r.losses}-${r.wins}-${r.ties}` : `${r.losses}-${r.wins}`;
    return `All time: ${first(leader)} leads ${r.wins > r.losses ? score : flipped}`;
  };

  const strip = layout === "strip";

  return (
    <div
      className={
        strip
          ? "-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0"
          : "divide-y divide-ink-700"
      }
    >
      {live.matchups.map((m) => {
        const done = settled(m);
        const marks = done ? matchupMarks(m.a.points, m.b.points, thresholds) : [];
        /**
         * A CARD IS ONLY A LINK IF ITS MATCHUP PAGE EXISTS.
         *
         * Two ways it can: the season is archived, so derive built a page for the
         * finished game; or the build generated a PREVIEW page for the fixture.
         * Anything else — a provider that was unreachable at build time, a
         * playoff week added to the schedule since — renders as plain text rather
         * than a link to a page nobody generated.
         */
        const id = meetingId(live.season, live.week, m.a.ownerSlug, m.b.ownerSlug);
        const href =
          live.season <= archivedThrough || upcoming.has(id) ? `/matchups/${id}/` : null;
        const card = strip
          ? `min-w-0 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2.5${
              href ? " transition-colors hover:border-accent-dim" : ""
            }`
          : `block px-4 py-2.5 sm:px-5${href ? " transition-colors hover:bg-ink-700/40" : ""}`;
        // Equal bases so cards fill the row on a desktop and hold 10rem on a
        // phone; see the note on the home strip. A list row is just full width.
        const style = strip ? { flex: "1 0 10rem" } : undefined;

        const body = (
          <>
            {[m.a, m.b].map((side, i) => {
              const other = i === 0 ? m.b : m.a;
              // LEADING IS NOT WINNING. Bold marks who is ahead; the accent is
              // reserved for a result, so it waits until the game is settled — a
              // green number at 2pm on Sunday asserts an outcome that has not
              // happened, and half these leads will not survive the late games.
              const leading = started && side.points > other.points;
              const won = done && side.points > other.points;
              const rec = recordOf(side.ownerSlug);
              return (
                <div key={side.ownerSlug} className="flex items-baseline gap-1.5">
                  <span
                    data-owner={side.ownerSlug}
                    className={`min-w-0 truncate text-sm ${
                      leading ? "font-semibold text-chalk-100" : "text-chalk-400"
                    }`}
                  >
                    {credited(side.ownerSlug)}
                  </span>
                  {rec ? (
                    <span className="tabular shrink-0 text-[10px] text-chalk-600">
                      {fmt.record(rec.wins, rec.losses, rec.ties)}
                    </span>
                  ) : null}
                  {started ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <span
                        className={`tabular text-sm ${
                          won
                            ? "font-semibold text-accent"
                            : leading
                              ? "font-semibold text-chalk-200"
                              : "text-chalk-500"
                        }`}
                      >
                        {fmt.pts1(side.points)}
                      </span>
                    </span>
                  ) : null}
                </div>
              );
            })}
            <div className="mt-1 truncate text-[10px] text-chalk-600">
              {series(m.a.ownerSlug, m.b.ownerSlug)}
            </div>
            {/* Only a game that actually made a record book gets chips, which is
                what keeps them worth reading — most weeks no card has one. */}
            {marks.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {marks.map((mark) => (
                  <RecordChip key={`${mark.short}-${mark.side ?? "game"}`} mark={mark} />
                ))}
              </div>
            ) : null}
          </>
        );

        return href ? (
          <Link key={m.matchupId} href={href} className={card} style={style}>
            {body}
          </Link>
        ) : (
          <div key={m.matchupId} className={card} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A record this game entered. Tone carries the direction — green for a peak, red
 * for a floor — and the title spells the rank out, since "#3 low" is terse.
 */
function RecordChip({ mark }: { mark: RecordMark }) {
  return (
    <span
      title={mark.full}
      className={`rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wide ${
        mark.tone === "good"
          ? "border-accent-dim/60 bg-accent/10 text-accent"
          : "border-loss/50 bg-loss/10 text-loss"
      }`}
    >
      {mark.short}
    </span>
  );
}
