"use client";

import Link from "next/link";

import { LiveLineup } from "@/components/live-lineup";
import { RecordChip } from "@/components/record-chip";
import { Panel, fmt } from "@/components/ui";
import { useLineupStates, useLiveSeason, useMatchupSettled, useSeasonGames } from "@/lib/live";
import type { LeagueRef } from "@/lib/league-ref";
import { matchupMarks, type RecordThresholds } from "@/lib/record-marks";
import type { LiveSeason, LiveTeam, PlayerMeta } from "@/lib/types";

/**
 * The live half of a matchup that has not been played.
 *
 * WHAT A PREVIEW CAN HONESTLY SAY is the whole design here. A finished matchup
 * page is a report — a winner, a margin, the lineups that produced it — and none
 * of that exists yet. What does exist is form: how both teams got here, what they
 * average, and what happened the last time they met. So this answers "who is
 * playing and how are they going", and says nothing that would have to be taken
 * back.
 *
 * NO PROJECTIONS AND NO ODDS. Both providers publish a projected score and it is
 * tempting to show it, but everything else on this site is a fact that happened;
 * a number that turns out wrong every other week would be the only thing here
 * that is allowed to be.
 *
 * It handles the LIVE case too, not just the future one. A week in progress is
 * the same page with points on it — the scoreline appears once anybody scores,
 * on the same rule the home strip uses.
 */

export interface MatchupPreviewProps {
  refBySeason: Record<string, LeagueRef>;
  initial: LiveSeason | null;
  userIdToSlug: Record<string, string>;
  /** Sleeper player id -> NFL team; see `useLiveSeason`. */
  teamByPlayer?: Record<string, string>;
  season: number;
  week: number;
  /** Owner slugs, as the fixture lists them. */
  a: string;
  b: string;
  ownerNames: Record<string, string>;
  /** How long the season runs, so the form table covers all of it. */
  seasonWeeks: number;
  /** The baked player index, for naming and linking a live lineup. */
  players: Record<string, PlayerMeta>;
  /** e.g. "All square at 6-6". Computed on the server from the committed series. */
  headline: string;
  pairHref: string;
  /** Record-book cut lines, for the chips. Same source the home strip uses. */
  thresholds: RecordThresholds;
}

/** One completed week for one team. */
interface Form {
  week: number;
  points: number;
  against: number;
  opponent: string | null;
  result: "W" | "L" | "T";
}

export function MatchupPreview({
  refBySeason,
  initial,
  userIdToSlug,
  teamByPlayer,
  season,
  week,
  a,
  b,
  ownerNames,
  seasonWeeks,
  players,
  headline,
  pairHref,
  thresholds,
}: MatchupPreviewProps) {
  const live = useLiveSeason(refBySeason, initial, userIdToSlug, teamByPlayer);
  /**
   * ONLY THE WEEKS THE FORM TABLE READS, which is the ones already played.
   *
   * `formOf` discards every week from this one onward, and Sleeper has no bulk
   * scoreboard — `seasonGames` is one request per week — so asking for the
   * whole season fired seventeen requests on a week-1 page and threw all
   * seventeen away. ESPN serves the season in one payload either way.
   */
  const games = useSeasonGames(
    refBySeason[String(season)] ?? null,
    Math.max(0, Math.min(seasonWeeks, week - 1)),
  );

  const name = (slug: string) => ownerNames[slug] ?? slug;
  const teamOf = (slug: string): LiveTeam | undefined =>
    live?.teams.find((t) => t.ownerSlug === slug || t.ownerSlugs?.includes(slug));
  const label = (slug: string): string => {
    const t = teamOf(slug);
    return (t?.ownerSlugs?.length ? t.ownerSlugs : [slug]).map(name).join(" & ");
  };
  const slugOfRoster = (rosterId: number) =>
    live?.teams.find((t) => t.rosterId === rosterId)?.ownerSlug ?? null;

  /**
   * Every week this team has finished, newest last.
   *
   * A week with no points on either side has not been played — the same test the
   * strip uses — so an unplayed fixture does not become an 0-0 tie in the record.
   */
  const formOf = (slug: string): Form[] => {
    const rosterId = teamOf(slug)?.rosterId;
    if (rosterId == null) return [];
    const out: Form[] = [];
    for (const wk of Object.keys(games).map(Number).sort((x, y) => x - y)) {
      if (wk >= week) continue;
      for (const g of games[wk]) {
        const mine = g.sides.find((s) => s.rosterId === rosterId);
        const other = g.sides.find((s) => s.rosterId !== rosterId);
        if (!mine || !other) continue;
        if (mine.points === 0 && other.points === 0) continue;
        out.push({
          week: wk,
          points: mine.points,
          against: other.points,
          opponent: slugOfRoster(other.rosterId),
          result: mine.points > other.points ? "W" : mine.points < other.points ? "L" : "T",
        });
      }
    }
    return out;
  };

  const formA = formOf(a);
  const formB = formOf(b);
  const played = formA.length || formB.length;

  const avg = (f: Form[]) => (f.length ? f.reduce((s, x) => s + x.points, 0) / f.length : null);

  /** This week's own scoreline, once there is one. Absent means not started. */
  const thisWeek = live?.week === week ? live.matchups.find(
    (m) =>
      [m.a.ownerSlug, m.b.ownerSlug].includes(a) && [m.a.ownerSlug, m.b.ownerSlug].includes(b),
  ) : undefined;
  const liveScore =
    thisWeek && (thisWeek.a.points > 0 || thisWeek.b.points > 0) ? thisWeek : null;

  /**
   * PREVIEW -> LIVE -> FINAL, and the badge has to be CLIENT-RENDERED to say so.
   *
   * It used to be a static "PREVIEW" printed by the server page, which meant a
   * game being played was labelled a preview all Sunday while live scores ran
   * underneath it — the badge and the numbers disagreeing on the same screen.
   *
   * FINAL is `useMatchupSettled`, not "the archive has it": the archive is a
   * day or two behind, and the whole point of that hook is that a matchup whose
   * starters have all finished is decided on Sunday evening. Once it fires, the
   * winner may be called and record chips may be shown — see AGENTS.md.
   */
  const settled = useMatchupSettled(live);
  // Hoisted so both lineups share one NFL-clock fetch rather than one each.
  const { stateOf } = useLineupStates(live, refBySeason[String(season)] ?? null);
  const isFinal = Boolean(thisWeek && settled(thisWeek));
  const state = isFinal ? "FINAL" : liveScore ? "LIVE" : "PREVIEW";

  /** Only once settled: a lead at 1pm is not a win. */
  const winner =
    isFinal && liveScore && liveScore.a.points !== liveScore.b.points
      ? (liveScore.a.points > liveScore.b.points ? liveScore.a : liveScore.b).ownerSlug
      : null;

  /**
   * Records this game has entered, on the SAME rule the home strip uses.
   *
   * A record is a claim about a finished game, so it waits for
   * `useMatchupSettled` — per MATCHUP, so a game that is over does not wait on
   * one that is not. Without this the strip could show "#2 low" on a card while
   * the page behind it showed nothing, which is the same fact rendered two
   * ways.
   *
   * MEASURED AGAINST THE ARCHIVE, which is what `thresholds` is built from, so
   * a week earlier in this same season that has not been archived is not in the
   * baseline yet. A chip can therefore move once the week lands — the accepted
   * cost of being early, the same one stat corrections impose.
   */
  const marks =
    isFinal && liveScore ? matchupMarks(liveScore.a.points, liveScore.b.points, thresholds) : [];

  const lineupOf = (slug: string) =>
    liveScore
      ? (liveScore.a.ownerSlug === slug ? liveScore.a : liveScore.b).lineup
      : thisWeek
        ? (thisWeek.a.ownerSlug === slug ? thisWeek.a : thisWeek.b).lineup
        : undefined;
  const anyLineup = Boolean(lineupOf(a)?.length || lineupOf(b)?.length);

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {season} · Week {week}
          </h1>
          {/* Says what the page IS, because it looks like a matchup page and a
              reader arriving from a link needs to know whether there is a
              result here. LIVE gets the pulsing dot the rest of the site uses
              for a running fetch, for the same reason. */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${
              state === "FINAL"
                ? "border-ink-500 text-chalk-400"
                : "border-accent-dim text-accent"
            }`}
          >
            {state === "LIVE" ? (
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            ) : null}
            {state}
          </span>
          {marks.length ? (
            <span className="flex flex-wrap gap-1">
              {marks.map((mark) => (
                <RecordChip key={`${mark.short}-${mark.side ?? "game"}`} mark={mark} />
              ))}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-chalk-500">
          {headline} ·{" "}
          <Link href={pairHref} className="hover:text-accent">
            head to head
          </Link>
          {" · "}
          <Link href={`/history/${season}/`} className="hover:text-accent">
            {season} season
          </Link>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[a, b].map((slug) => {
          const t = teamOf(slug);
          const f = slug === a ? formA : formB;
          const mine = liveScore
            ? liveScore.a.ownerSlug === slug
              ? liveScore.a.points
              : liveScore.b.points
            : null;
          return (
            <Panel key={slug}>
              <div className="p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/owners/${slug}/`}
                    data-owner={slug}
                    className="min-w-0 truncate text-lg font-bold transition-colors hover:text-accent"
                  >
                    {label(slug)}
                  </Link>
                  {mine != null ? (
                    <span
                      className={`tabular shrink-0 text-xl font-bold ${
                        winner === slug ? "text-accent" : "text-chalk-100"
                      }`}
                    >
                      {fmt.pts1(mine)}
                    </span>
                  ) : null}
                </div>
                {t?.teamName ? (
                  <div className="truncate text-[11px] text-chalk-600">{t.teamName}</div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-chalk-500">
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {t ? fmt.record(t.wins, t.losses, t.ties) : "—"}
                    </span>{" "}
                    record
                  </span>
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {avg(f) == null ? "—" : fmt.pts1(avg(f) as number)}
                    </span>{" "}
                    per game
                  </span>
                  <span>
                    <span className="tabular font-semibold text-chalk-300">
                      {t ? fmt.pts1(t.pointsFor) : "—"}
                    </span>{" "}
                    for
                  </span>
                </div>
                {/* LAST FIVE, NEWEST LAST, so the row reads left to right the way
                    the season ran. Letters rather than scores: this is shape at a
                    glance, and the week-by-week detail is one tap away below. */}
                {f.length ? (
                  <div className="mt-3 flex items-center gap-1">
                    {f.slice(-5).map((x) => (
                      <span
                        key={x.week}
                        title={`Week ${x.week}: ${fmt.pts1(x.points)} vs ${fmt.pts1(x.against)}`}
                        className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                          x.result === "W"
                            ? "bg-accent/15 text-accent"
                            : x.result === "L"
                              ? "bg-loss/15 text-loss"
                              : "bg-ink-700 text-chalk-500"
                        }`}
                      >
                        {x.result}
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* COLLAPSED BY DEFAULT. Two of these open at once is most of a
                    screen, and the cards exist to be compared at a glance — the
                    record, the average and the five chips already say the shape.
                    This is for when that prompts a question. */}
                {f.length ? (
                  <details className="group mt-3 border-t border-ink-700 pt-2.5">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] uppercase tracking-wide text-chalk-600 transition-colors hover:text-chalk-400">
                      <span>
                        Season so far · {f.length} game{f.length === 1 ? "" : "s"}
                      </span>
                      <span aria-hidden className="transition-transform group-open:rotate-90">
                        ▸
                      </span>
                    </summary>
                    <ol className="mt-2 space-y-1">
                      {f.map((x) => (
                        <li
                          key={x.week}
                          className="flex items-baseline gap-2 text-[13px] tabular"
                        >
                          <span className="w-8 shrink-0 text-chalk-600">Wk{x.week}</span>
                          <span
                            className={`w-4 shrink-0 font-bold ${
                              x.result === "W"
                                ? "text-accent"
                                : x.result === "L"
                                  ? "text-loss"
                                  : "text-chalk-500"
                            }`}
                          >
                            {x.result}
                          </span>
                          <span className="shrink-0 text-chalk-300">
                            {fmt.pts1(x.points)}
                            <span className="text-chalk-600"> – {fmt.pts1(x.against)}</span>
                          </span>
                          {/* THE OTHER TEAM IN THIS FIXTURE IS WORTH MARKING: a
                              row against them is not just form, it is the last
                              time these two met, and it is the most relevant
                              line in the drawer. */}
                          {x.opponent ? (
                            <span
                              className={`min-w-0 truncate text-[11px] ${
                                x.opponent === (slug === a ? b : a)
                                  ? "font-semibold text-me"
                                  : "text-chalk-600"
                              }`}
                            >
                              {x.opponent === (slug === a ? b : a) ? "vs " : ""}
                              {name(x.opponent).split(" ")[0]}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </div>
            </Panel>
          );
        })}
      </div>

      {/* The whole reason the drawer can be absent. Said once, under both cards,
          rather than as an empty panel per team. Suppressed once this week has
          a lineup on the board — "neither team has played yet" beside a running
          scoreline is the contradiction this page used to print. */}
      {played || anyLineup ? null : (
        <p className="text-[13px] text-chalk-600">
          Neither team has played yet — this is week {week}.
        </p>
      )}

      {/* THE LINEUPS, once the provider has them — which is from the moment
          lineups are set, before kickoff. Side by side so the two can be read
          against each other, which is the whole question during a game. */}
      {anyLineup ? (
        <>
        <div className="grid gap-5 lg:grid-cols-2">
          {[a, b].map((slug) => (
            <LiveLineup
              key={slug}
              title={label(slug)}
              lineup={lineupOf(slug)}
              players={players}
              stateOf={stateOf}
            />
          ))}
        </div>
        </>
      ) : null}
    </>
  );
}
