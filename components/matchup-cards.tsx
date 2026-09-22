"use client";

import Link from "next/link";

import { fmt } from "@/components/ui";
import { useMatchupSettled } from "@/lib/live";
import { meetingId } from "@/lib/meeting";
import { RecordChip } from "@/components/record-chip";
import { matchupMarks, peerScore, recordHref, type RecordThresholds } from "@/lib/record-marks";
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
   * Owner slug -> chance of posting the league's LOWEST score this week.
   *
   * Only the punishments page passes it; everywhere else a card has no business
   * ranking a team against the whole league rather than its opponent.
   */
  punishmentOdds?: Record<string, number>;
  /**
   * Draw the full odds bar, not just the locked-in marker.
   *
   * Both tickers set this for a league that plays the weekly punishment. It
   * stays a flag separate from `punishmentOdds` so a surface can still take
   * the locked-in marker — a settled fact — without the running percentage,
   * which is a forecast.
   */
  punishmentBars?: boolean;
  /**
   * Slugs who are MATHEMATICALLY last already — see `lockedIntoLast`. Not
   * derived from `punishmentOdds` here on purpose: the odds are a normalised
   * integral that never quite reaches 1, so certainty has to be passed in as
   * the separate fact it is rather than recovered from a threshold.
   */
  punishmentLocked?: string[];
  /**
   * This league punishes the week's lowest score, so mark whoever took it.
   *
   * `punishmentLocked` only answers DURING the week: it comes from the live
   * projections, which stop being fetched the moment the platform marks the
   * week scored. So the marker appeared on Sunday and vanished on Tuesday,
   * which is backwards — mid-week it is a forecast hardening into certainty,
   * and afterwards it is simply what happened.
   *
   * Once every game is in, no projection is needed: the lowest of the week's
   * final scores is the answer, and this computes it directly.
   */
  markWeeklyLow?: boolean;
  /**
   * Each team's projected final for the week, from `useLiveProjections`.
   *
   * Sleeper's own blend, and the same figure the win probability and the
   * last-place odds are computed from — so a card cannot show a projection
   * that disagrees with its own percentages. `done` means every starter has
   * finished, at which point the projection IS the score and is dropped.
   */
  projections?: Record<string, { projected: number; done: boolean }>;
  /**
   * Meeting ids derive has already archived, for the season being played.
   *
   * A finished week now reaches the record book within a day, so a card can be
   * looking at a game that is BOTH live-fetched and in the cut lines. Ranking
   * it against those lines without saying so counted it twice and put it below
   * itself. Ids rather than a week number because a week lands as a unit but
   * this does not have to assume that.
   */
  archivedIds?: string[];
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
  archivedIds,
  punishmentOdds,
  punishmentBars = false,
  punishmentLocked,
  markWeeklyLow = false,
  projections,
  layout = "strip",
}: MatchupCardsProps) {
  const upcoming = new Set(upcomingIds ?? []);
  const archived = new Set(archivedIds ?? []);
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
  /** This week's already-final games, in week order — the peer field. */
  const finished = live ? live.matchups.filter(settled) : [];

  /**
   * Who took the weekly punishment, once the week is over.
   *
   * THE WHOLE WEEK, not this matchup: the punishment goes to the lowest score
   * in the LEAGUE, so it cannot be read off one card. Every game must be
   * settled before the question has an answer at all — one lineup still
   * playing can undercut anybody.
   *
   * Ties are all marked, matching `buildWeeklyLows`, which records every team
   * level on the low rather than picking one.
   */
  const settledLow: string[] = [];
  if (markWeeklyLow && live && live.matchups.length && finished.length === live.matchups.length) {
    const sides = live.matchups.flatMap((m) => [m.a, m.b]);
    const low = Math.min(...sides.map((x) => x.points));
    for (const x of sides) if (x.points === low) settledLow.push(x.ownerSlug);
  }
  const lockedSlugs = new Set([...(punishmentLocked ?? []), ...settledLow]);
  /**
   * ONE MARKER SILENCES EVERY BAR. Once the week's loser is settled the
   * remaining percentages are all zero and answer a question nobody is asking;
   * leaving them up invites the reader to keep comparing bars in a race that
   * has already finished.
   */
  const punishmentSettled = lockedSlugs.size > 0;

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
        /**
         * RANKED AGAINST THIS WEEK TOO, not history alone.
         *
         * The cut lines in `thresholds` are the record book as the build left
         * it, so a game finishing this afternoon is invisible to the game
         * beside it — which is how two cards came to show "#2 high" with
         * different scores. Every OTHER matchup already settled this week is
         * handed over as a peer, split on the week's own order so an exact tie
         * gets two consecutive places rather than one shared.
         */
        const id = meetingId(live.season, live.week, m.a.ownerSlug, m.b.ownerSlug);
        const at = finished.indexOf(m);
        // Already in the cut lines, so rank against those alone — see
        // `matchupMarks`. Peers are for the gap before derive catches up.
        const inBaseline = live.season <= archivedThrough || archived.has(id);
        const marks = done
          ? matchupMarks(
              m.a.points,
              m.b.points,
              thresholds,
              {
                ahead: finished.slice(0, at).map(peerScore),
                behind: finished.slice(at + 1).map(peerScore),
              },
              inBaseline,
            )
          : [];
        /**
         * A CARD IS ONLY A LINK IF ITS MATCHUP PAGE EXISTS.
         *
         * Two ways it can: the season is archived, so derive built a page for the
         * finished game; or the build generated a PREVIEW page for the fixture.
         * Anything else — a provider that was unreachable at build time, a
         * playoff week added to the schedule since — renders as plain text rather
         * than a link to a page nobody generated.
         */
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
              // WHO IS AHEAD, WHICH IS NOT WHO HAS WON. Bold on the name is
              // the only thing that says it, and it says nothing stronger than
              // "ahead right now" — half these leads will not survive the late
              // games. Nothing green until the archive calls it.
              const leading = started && side.points > other.points;
              const rec = recordOf(side.ownerSlug);
              const odds = punishmentOdds?.[side.ownerSlug];
              const locked = lockedSlugs.has(side.ownerSlug);
              /**
               * The projected final, while there is still football to play.
               *
               * DROPPED THE MOMENT EVERY STARTER IS DONE, which is what `done`
               * means: from then on the projection equals the score, and
               * repeating the score in smaller type under it says nothing.
               */
              const p = projections?.[side.ownerSlug];
              const proj = p && !p.done ? p.projected : null;
              /** Every starter has played — from the live clock, or from the
               *  matchup being settled once that stops being fetched. */
              const finishedSide = done || (p?.done ?? false);
              /** Settled AND ahead. A tie has no winner. */
              const won = done && side.points > other.points;
              /**
               * The last-place bar, when this surface draws them.
               *
               * DRAWN FOR EVERY TEAM STILL IN IT rather than only the ones at
               * risk: it is read by comparing it with the others on screen, so
               * a row that omits its bar reads as missing data rather than as
               * a team who is fine. A near-zero bar is simply empty, which
               * says it. Gone entirely once anybody is `locked` — a settled
               * question is not a percentage.
               */
              /**
               * GREEN THROUGH RED BY RISK, because a bar that is always red
               * says "danger" at a team sitting on 3%. The reader is scanning
               * six cards for who is in trouble, and colour does that faster
               * than comparing lengths.
               */
              const barTone =
                odds == null
                  ? ""
                  : odds < 0.1
                    ? "bg-accent"
                    : odds < 0.2
                      ? "bg-gold"
                      : odds < 0.5
                        ? "bg-caution"
                        : "bg-loss";
              const oddsRow =
                odds != null && punishmentBars && !punishmentSettled ? (
                  <span
                    title={`${(odds * 100).toFixed(1)}% chance of the league's lowest score this week`}
                    className="flex min-w-0 flex-1 items-center gap-1"
                  >
                    {/* Labelled, because a bare red bar under a name in a
                        fantasy app reads as "how badly they are losing". */}
                    <span className="shrink-0 text-[8px] uppercase leading-none text-chalk-600">
                      Last
                    </span>
                    <span className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-700">
                      <span
                        className={`block h-full ${barTone}`}
                        style={{ width: `${Math.min(100, odds * 100)}%` }}
                      />
                    </span>
                    {/* NEITHER END IS ALLOWED TO ROUND TO A CERTAINTY. The bar
                        only renders while nobody is locked, so a 99.6% here is
                        a team who CAN still escape — printing "100%" beside
                        them would claim the one thing the marker exists to
                        say, and it would be wrong. Mirrors "<1%" at the
                        bottom, which is the same lie upside down. */}
                    <span className="tabular shrink-0 text-[8px] leading-none text-chalk-600">
                      {/* 0% ONLY WHEN IT IS 0. `safeFromLast` zeroes the
                          teams somebody has already finished below; everything
                          else that rounds down is "<1%", because a team with a
                          lineup still out there has not escaped anything. */}
                      {odds === 0
                        ? "0%"
                        : odds < 0.005
                          ? "<1%"
                          : odds >= 0.995
                            ? ">99%"
                            : `${Math.round(odds * 100)}%`}
                    </span>
                  </span>
                ) : null;
              return (
                <div key={side.ownerSlug}>
                  <div className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
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
                      {locked ? (
                        <span
                          title="Locked in for the league's lowest score this week"
                          className="shrink-0 rounded border border-loss/50 bg-loss/10 px-1 py-px text-[9px] leading-none text-loss"
                        >
                          🚽
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {/*
                    SHOWN EVEN AT 0.0, once a week is on screen. A blank where
                    the score goes reads as missing data, and it leaves the
                    projected final underneath with nothing to be a projection
                    OF. Nobody LEADS at nil-nil, which `leading` already
                    handles, so neither name goes bold.
                  */}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {/*
                      BOLD MEANS FINISHED, GREEN MEANS WON.
                      
                      Two separate facts, so they get two separate signals. A
                      team whose starters have all played is done arguing and
                      goes bold whatever the result; only the winner of a
                      settled matchup also turns green. A team still playing
                      stays light — nothing about it is final yet.

                      `done` covers the matchup being settled, which is the
                      only signal left once the week is scored and the live
                      projections stop being fetched.
                    */}
                    <span
                      className={`tabular text-sm ${
                        finishedSide
                          ? won
                            ? "font-semibold text-accent"
                            : "font-semibold text-chalk-100"
                          : "text-chalk-100"
                      }`}
                    >
                      {fmt.pts1(side.points)}
                    </span>
                  </span>
                  </div>
                  {/*
                    ONE LINE UNDER THE ROW, carrying whatever applies: the
                    last-place bar on the left under the name, the projected
                    final on the right under the score it belongs to. They
                    share a line because they are the same kind of thing — a
                    smaller, dimmer footnote to the number above — and because
                    two separate lines would push a six-card strip taller than
                    the panel beside it.
                  */}
                  {oddsRow || proj != null ? (
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {oddsRow ?? <span className="flex-1" />}
                      {proj != null ? (
                        <span
                          title={`Projected final: ${fmt.pts1(proj)}`}
                          className="tabular shrink-0 text-[9px] leading-none text-chalk-600"
                        >
                          {fmt.pts1(proj)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="mt-1 truncate text-[10px] text-chalk-600">
              {series(m.a.ownerSlug, m.b.ownerSlug)}
            </div>
          </>
        );

        /**
         * OUTSIDE THE CARD'S LINK, deliberately.
         *
         * Each chip links into the record book, and the card itself usually
         * links to the matchup — an anchor inside an anchor is invalid HTML and
         * browsers disagree about which one wins. So the card's link wraps the
         * scoreline only, and the chips sit beside it under the same border.
         *
         * Only a game that actually made a record book gets them, which is what
         * keeps them worth reading — most weeks no card has one.
         */
        const chips = marks.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {marks.map((mark) => (
              <RecordChip
                key={`${mark.short}-${mark.side ?? "game"}`}
                mark={mark}
                href={recordHref(mark.list)}
              />
            ))}
          </div>
        ) : null;

        /**
         * THE WHOLE CARD IS THE LINK, via an overlay rather than a wrapper.
         *
         * Wrapping the content meant the card's own padding was dead space —
         * most of the card, on a narrow strip — and wrapping EVERYTHING would
         * put the record chips, which are links themselves, inside an anchor.
         * An absolutely positioned link covers the card instead; the chips come
         * after it in the DOM and are positioned, so they paint above it and
         * take their own clicks. Nothing else in a card is interactive — the
         * owner names are plain spans — so there is nothing else to shadow.
         */
        return (
          <div key={m.matchupId} className={`relative ${card}`} style={style}>
            {body}
            {href ? (
              <Link
                href={href}
                // Named for a screen reader, which otherwise meets an empty link.
                aria-label={`${name(m.a.ownerSlug)} vs ${name(m.b.ownerSlug)}`}
                className="absolute inset-0 rounded-lg"
              />
            ) : null}
            {chips ? <div className="relative">{chips}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

