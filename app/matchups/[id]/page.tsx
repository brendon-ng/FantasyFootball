import Link from "next/link";
import { notFound } from "next/navigation";

import { MatchupPreview } from "@/components/matchup-preview";
import { SeriesPanel } from "@/components/series-panel";
import {
  longestStreak,
  seriesLine,
  seriesRecord,
  seriesStreak,
  seriesTally,
  streakLine,
} from "@/lib/series";

import { BackLink } from "@/components/back-link";

import { Bracket } from "@/components/bracket";
import { WeeklyLowBadge } from "@/components/weekly-low";
import { PositionPill } from "@/components/keeper-table";
import { Tip } from "@/components/tooltip";
import {
  Col,
  ListHeader,
  Panel,
  PanelHeader,
  Stat,
  fmt,
} from "@/components/ui";
import type { BracketMatch } from "@/lib/types";
import {
  getAllMeetings,
  getAtTheTime,
  getMeetingsToDate,
  getOwnerMap,
  getPlayerTeamsAt,
  getPlayers,
  getRecordFlags,
  type RecordFlag,
  getSeasons,
  getWeeklyLowKeys,
  matchupChip,
  meetingId,
  type Meeting,
  type MeetingSide,
  weeklyCoverage,
  getLeagueRefs,
  getLiveSchedule,
  getLiveSeason,
  getPlayerTeams,
  getUserIdToSlug,
  seasonWeekCount,
  type ScheduledGame,
} from "@/lib/data";

export const dynamicParams = false;

/**
 * One page per matchup ever played.
 *
 * This is where lineups live. The head-to-head page lists a series and links
 * here; duplicating the per-player breakdown in both would mean two renderers
 * for the same thing, drifting apart.
 *
 * Imported ESPN matchups get a page too, and now carry lineups of their own — the
 * score, the round it decided, and the series context are all still real. A
 * missing page would leave dead links from the record book.
 */
export async function generateStaticParams() {
  const played = getAllMeetings().map((m) => m.id);
  // Fixtures the season has not reached yet get a page too — see
  // `getLiveSchedule`. No overlap with the above: derive only builds finalized
  // seasons and this is the one being played.
  const upcoming = (await getLiveSchedule()).map((g) => g.id);
  return [...new Set([...played, ...upcoming])].map((id) => ({ id }));
}

const KIND_LABEL: Record<Meeting["kind"], string> = {
  regular: "Regular season",
  playoff: "Playoffs",
  // A postseason game among non-playoff teams. Only the one deciding last place
  // is THE toilet bowl, and that comes through as the matchup's own label.
  consolation: "Consolation",
};

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = getAllMeetings().find((m) => m.id === id);
  // Not played yet: a preview rather than a report. Everything below this line
  // describes a finished game — a winner, a margin, lineups — and none of it
  // exists for a fixture.
  if (!game) {
    const fixture = (await getLiveSchedule()).find((g) => g.id === id);
    if (fixture) return <UpcomingMatchupPage fixture={fixture} />;
    notFound();
  }

  const coverage = weeklyCoverage();
  const owners = getOwnerMap();
  // Empty unless this league punishes the weekly low, so no flag check here.
  const lowKeys = getWeeklyLowKeys();
  const players = getPlayers();
  const season = getSeasons().find((s) => s.season === game.season);
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || slug || "TBD";

  const winner = game.a.points === game.b.points ? null : game.a.points > game.b.points ? game.a : game.b;
  const margin = Math.abs(game.a.points - game.b.points);

  // Series context: every other meeting between these two, so this game can be
  // placed in the rivalry rather than shown in isolation.
  // To date, not just archived — see `getMeetingsToDate`. A game already played
  // this season belongs in the all-time record beside the ones from 2019.
  const series = await getMeetingsToDate(game.a.ownerSlug, game.b.ownerSlug);
  const before = series.filter(
    (g) => g.season < game.season || (g.season === game.season && (g.week ?? 0) < (game.week ?? 0)),
  );

  /**
   * The run one of them was on WALKING INTO this game.
   *
   * `getMeetings` is newest first and `before` preserves that, so this walks
   * forward from the meeting immediately preceding. A tie ends a streak — nobody
   * won it, so nobody carried anything into the next one.
   *
   * Folded into the "series before this" tile rather than given its own: both
   * describe the state of the rivalry at kickoff, and as a subtitle the streak
   * reads as context for the record rather than a competing number.
   */
  const firstName = (slug: string) => owners.get(slug)?.firstName ?? name(slug);
  // Past tense: this describes what somebody carried INTO a game that has since
  // been played. The preview says the same thing in the present.
  const priorStreak = streakLine(seriesStreak(before), firstName, "past");
  // Leader first and named, so a bare "3-6" never leaves the reader working out
  // which of the two names above it the numbers belong to.
  const priorRecord = seriesRecord(before, game.a.ownerSlug, game.b.ownerSlug, name);
  const overallRecord = seriesRecord(series, game.a.ownerSlug, game.b.ownerSlug, name);
  const pairHref = `/h2h/${[game.a.ownerSlug, game.b.ownerSlug].sort().join("-vs-")}/`;

  // Any record-book list this game appears in.
  const slugs = [game.a.ownerSlug, game.b.ownerSlug];
  /**
   * RECORD MARKS BELONG TO A WEEK, not to a matchup. The record book ranks weeks,
   * so a two-week playoff matchup has a set of marks per week — and showing week
   * one's beside a combined two-week scoreline would attach them to a number they
   * were never about. A single-week matchup keeps them at the top as before.
   */
  const legs = game.weeks?.length
    ? game.weeks
    : [{ week: game.week ?? 0, a: game.a, b: game.b }];
  const flagsFor = (week: number) => getRecordFlags(game.season, week, slugs);
  const flags = game.weeks?.length ? [] : flagsFor(game.week ?? 0);
  // Marks this game set when it was played, whether or not they still stand.
  const madeHistory = getAtTheTime()[game.id] ?? [];
  const chip = matchupChip(game.label, game.kind);

  /**
   * The bracket this matchup belongs to, so a postseason game can be seen in
   * the shape it was played in rather than in isolation.
   *
   * Matched on the two teams plus the week: a pairing can recur across rounds,
   * and a season can run several brackets at once.
   */
  const isThisMatch = (m: BracketMatch) =>
    m.week === game.week &&
    !!m.team1 &&
    !!m.team2 &&
    [m.team1, m.team2].every((t) => [game.a.ownerSlug, game.b.ownerSlug].includes(t!));

  const bracket =
    game.kind === "regular" || !season
      ? null
      : // Carries `ladder` and the real `finalLabel` so this renders IDENTICALLY
        // to the season page. Omitting them made the same bracket appear as a
        // ladder there and a tree here, with "7th place" against
        // "7th / 8th place" and "Placement" against "🚽 Toilet Bowl" — 73 pages
        // contradicting the season page they link to.
        ([
          {
            title: "Playoff bracket",
            matches: season.winnersBracket,
            finalPlace: 1,
            finalLabel: "🏆 Championship",
            ladder: false,
          },
          ...season.extraBrackets.map((b) => ({
            title: b.title,
            matches: b.matches,
            finalPlace: b.finalPlace,
            finalLabel: b.finalLabel,
            ladder: b.ladder,
          })),
          {
            title: season.ladderConsolation ? "Consolation ladder" : "Consolation bracket",
            matches: season.losersBracket,
            finalPlace: season.teams,
            finalLabel: "🚽 Toilet Bowl · Last Place",
            ladder: season.ladderConsolation,
          },
        ].find((b) => b.matches.some(isThisMatch)) ?? null);

  const existingMeetings = new Set(getAllMeetings().map((m) => m.id));
  const bracketHref = (m: BracketMatch) => {
    if (!m.team1 || !m.team2 || m.isBye) return null;
    const id = meetingId(game.season, m.week, m.team1, m.team2);
    return existingMeetings.has(id) && id !== game.id ? `/matchups/${id}/` : null;
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <BackLink
          fallback={{
            href: pairHref,
            label: `${name(game.a.ownerSlug)} vs ${name(game.b.ownerSlug)}`,
          }}
        />
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {game.season} · Week {game.week ?? "—"}
        </h1>
        <p className="mt-1 text-sm text-chalk-500">
          {/* The bracket label is appended only when it SAYS SOMETHING MORE than
              the bracket itself. `matchupChip` now names every postseason game,
              including the ordinary ones it used to leave null, so printing both
              unconditionally read "Consolation · Consolation" on 97 pages. A
              championship still reads "Playoffs · Championship". */}
          {KIND_LABEL[game.kind]}
          {chip && chip !== KIND_LABEL[game.kind] ? ` · ${chip}` : ""}
          {" · "}
          <Link href={`/history/${game.season}/`} className="hover:text-accent">
            {game.season} season
          </Link>
        </p>
      </div>

      {madeHistory.length ? (
        <div className="rounded-xl border border-me-dim bg-me/[0.08] px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="text-base leading-none">
              🏅
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-me">
              Made history
            </span>
            <Tip
              className="text-[10px] text-chalk-600"
              text={`Measured against every score on record at that moment.${
                coverage.missing.length
                  ? ` Week-by-week scores exist for ${coverage.label}; for ${coverage.missingLabel} only playoff and ladder matchups survived, so the earlier baseline is thinner than the matchups actually played.`
                  : ""
              }`}
            >
              coverage ⓘ
            </Tip>
          </div>
          <ul className="space-y-1">
            {madeHistory.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-semibold text-me">{f.label}</span>
                <span className="tabular text-chalk-300">{f.value.toFixed(2)}</span>
                <span className="text-chalk-600">
                  {f.playerId
                    ? (players[f.playerId]?.full_name ?? "")
                    : f.opponentSlug
                      ? `${name(f.ownerSlug)} def. ${name(f.opponentSlug)}`
                      : (owners.get(f.ownerSlug)?.name ?? "")}
                </span>
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                    f.stillStands
                      ? "border-gold/40 bg-gold/10 text-gold"
                      : "border-ink-500 text-chalk-600"
                  }`}
                >
                  {f.stillStands ? "Still stands" : "Since broken"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {flags.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/35 bg-gold/[0.07] px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gold">
            Record book
          </span>
          {flags.map((f, i) => (
            <span
              key={i}
              title={`${f.full}${f.ownerSlug ? ` — ${name(f.ownerSlug)}` : ""}`}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                f.tone === "bad"
                  ? "border-loss/40 bg-loss/10 text-loss"
                  : "border-gold/40 bg-gold/10 text-gold"
              }`}
            >
              {f.short}
              {/* Whole-game records name both sides — one name is only half
                  the fact for a blowout or a combined total. */}
              {f.playerId ? (
                <span className="ml-1 font-normal opacity-80">
                  {players[f.playerId]?.full_name ?? ""}
                </span>
              ) : f.opponentSlug ? (
                <span className="ml-1 font-normal opacity-80">
                  {owners.get(f.ownerSlug ?? "")?.firstName ?? ""} def.{" "}
                  {owners.get(f.opponentSlug)?.firstName ?? ""}
                </span>
              ) : f.ownerSlug ? (
                <span className="ml-1 font-normal opacity-80">
                  {owners.get(f.ownerSlug)?.firstName ?? ""}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {/* Scoreboard */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[game.a, game.b].map((side) => {
          const won = winner?.ownerSlug === side.ownerSlug;
          return (
            <div
              key={side.ownerSlug}
              className={`rounded-xl border px-4 py-4 ${
                won ? "border-accent-dim bg-accent/[0.06]" : "border-ink-600 bg-ink-850"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/owners/${side.ownerSlug}/`}
                  className="truncate text-base font-semibold transition-colors hover:text-accent sm:text-lg"
                >
                  {name(side.ownerSlug)}
                </Link>
                <span
                  className={`tabular shrink-0 text-2xl font-bold ${won ? "text-accent" : "text-chalk-300"}`}
                >
                  {fmt.pts(side.points)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-chalk-600">
                <span>{won ? "Winner" : winner ? `Lost by ${fmt.pts(margin)}` : "Tie"}</span>
                {lowKeys.has(`${game.season}:${game.week}:${side.ownerSlug}`) ? (
                  <WeeklyLowBadge />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Margin" value={fmt.pts(margin)} tone={margin < 5 ? "accent" : "default"} />
        <Stat label="Combined" value={fmt.pts1(game.a.points + game.b.points)} />
        <Stat
          label="Series before this"
            value={priorRecord.value}
            sub={priorStreak ?? priorRecord.sub}
        />
        <Stat
          label="Series all-time"
            value={overallRecord.value}
            sub={
              overallRecord.sub
                ? `${overallRecord.sub} · ${series.length} meetings`
                : `${series.length} meetings`
            }
        />
      </div>

      {game.hasLineups ? (
        /* A MULTI-WEEK MATCHUP GETS A LINEUP PAIR PER WEEK. The game is one
           playoff round, decided on the combined score, but each week had its
           own lineup and its own result — collapsing them would hide which week
           was actually won and by whom. An ordinary matchup renders exactly as
           before, as a single unlabelled pair. */
        legs.map((leg) => {
          const legFlags = game.weeks?.length ? flagsFor(leg.week) : flags;
          return (
            <div key={leg.week} className="space-y-2">
              {game.weeks?.length ? (
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="eyebrow">Week {leg.week}</h2>
                  <span className="tabular text-xs text-chalk-600">
                    {fmt.pts(leg.a.points)} – {fmt.pts(leg.b.points)}
                  </span>
                  {legFlags.map((f, i) => (
                    <span
                      key={i}
                      title={`${f.full}${f.ownerSlug ? ` — ${name(f.ownerSlug)}` : ""}`}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        f.tone === "bad"
                          ? "border-loss/40 bg-loss/10 text-loss"
                          : "border-gold/40 bg-gold/10 text-gold"
                      }`}
                    >
                      {f.short}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-5 lg:grid-cols-2">
                {[leg.a, leg.b].map((side) => (
                  <Lineup
                    key={side.ownerSlug}
                    side={side}
                    slots={season?.rosterPositions ?? []}
                    name={name(side.ownerSlug)}
                    players={players}
                    teamsThen={getPlayerTeamsAt(game.season, leg.week)}
                    /* Per WEEK, not the winner of the whole matchup — the team
                       that lost the round can still have won a week. */
                    won={
                      leg.a.points !== leg.b.points &&
                      side.points === Math.max(leg.a.points, leg.b.points)
                    }
                    playerFlags={legFlags.filter((f) => f.playerId)}
                  />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <Panel>
          <PanelHeader title="Lineups" />
          {/* Nothing reaches this today: every game in league history has a
              lineup. It survives for a game recovered from brackets alone, which
              is still possible for a season whose scoreboards were never found. */}
          <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
            No lineups on record for this game.
          </div>
        </Panel>
      )}

      {bracket ? (
        <Panel>
          <PanelHeader
            title={bracket.title}
            meta={`${game.season} postseason`}
            legend="This matchup is highlighted. Open any other to see its lineups."
            href={`/history/${game.season}/`}
            hrefLabel="Season"
          />
          <div className="p-4 sm:p-5">
            <Bracket
              matches={bracket.matches}
              ladder={bracket.ladder}
              finalLabel={bracket.finalLabel}
              finalPlace={bracket.finalPlace}
              nameOf={name}
              seedOf={(slug) =>
                slug ? (season?.standings.find((r) => r.ownerSlug === slug)?.seed ?? null) : null
              }
              hrefFor={bracketHref}
              isCurrent={isThisMatch}
            />
          </div>
        </Panel>
      ) : null}

      <SeriesPanel
        series={series}
        currentId={game.id}
        nameOf={name}
        pairHref={pairHref}
      />
    </div>
  );
}

/**
 * One team's lineup.
 *
 * `starters` is positionally aligned to the league's `roster_positions`, which
 * is the only way to know a given player filled the FLEX rather than RB2 — the
 * player object itself just says "RB".
 */
function Lineup({
  side,
  slots,
  name,
  players,
  teamsThen,
  won,
  playerFlags,
}: {
  side: MeetingSide;
  slots: string[];
  name: string;
  players: Record<string, { full_name: string; position: string | null; team: string | null }>;
  /**
   * Team by player FOR THIS SEASON. Falls back to the player's current team,
   * which is what the page showed before and is still right for a recent game.
   */
  teamsThen: Record<string, string>;
  won: boolean;
  /**
   * Every player-week record set in this game, either side.
   *
   * Filtered by player id here rather than by owner: `getRecordFlags` already
   * scoped them to these two teams, and a bench player who out-scored the league
   * still belongs on the row that shows him.
   */
  playerFlags: RecordFlag[];
}) {
  const startersTotal = side.starters.reduce((t, pid) => t + (side.playerPoints[pid] ?? 0), 0);
  const bench = Object.keys(side.playerPoints).filter((pid) => !side.starters.includes(pid));
  const benchTotal = bench.reduce((t, pid) => t + (side.playerPoints[pid] ?? 0), 0);
  const best = Math.max(0, ...side.starters.map((pid) => side.playerPoints[pid] ?? 0));

  const row = (pid: string, slot: string | null) => {
    const p = players[pid];
    const pts = side.playerPoints[pid] ?? 0;
    // STARTERS ONLY, asserted here rather than assumed. The all-time list is
    // built from started players (`buildLeagueRecords` skips the bench), so this
    // is belt-and-braces — but a chip on a bench row would claim a record that
    // the record book does not contain, and the bench is collapsed, so it would
    // be a wrong badge that is also hard to spot.
    const mark = side.starters.includes(pid)
      ? (playerFlags.find((f) => f.playerId === pid) ?? null)
      : null;
    return (
      <div key={pid} className="flex items-center gap-2.5 px-3 py-1.5 sm:px-4">
        {slot ? (
          <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
            {slot}
          </span>
        ) : (
          <span className="w-10 shrink-0" />
        )}
        <PositionPill position={p?.position ?? null} />
        <Link
          href={`/players/${pid}/`}
          className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent"
        >
          {p?.full_name ?? pid}
          {teamsThen[pid] ?? p?.team ? (
            <span className="ml-1.5 text-[11px] text-chalk-600">
              {teamsThen[pid] ?? p?.team}
            </span>
          ) : null}
          {/* ON THE ROW, not only in the badge strip at the top. The strip names
              the player in prose, so finding him in a 17-man lineup meant reading
              both and matching by eye. */}
          {mark ? (
            <span
              title={mark.full}
              className="ml-1.5 whitespace-nowrap rounded border border-gold/50 bg-gold/10 px-1 py-px align-middle text-[9px] font-bold uppercase tracking-wide text-gold"
            >
              {`#${mark.rank} player week`}
            </span>
          ) : null}
        </Link>
        <span
          className={`tabular w-14 shrink-0 text-right text-sm ${
            slot && pts === best && best > 0 ? "font-bold text-accent" : "text-chalk-300"
          }`}
        >
          {fmt.pts(pts)}
        </span>
      </div>
    );
  };

  // Nothing is in this state today: every game in league history has a lineup on
  // file. The path stays because a newly imported season has scores before it has
  // been through the lineup importer, and saying so beats an empty table headed
  // "0.00 from starters", which reads as a team that scored nothing.
  if (!side.starters.length && !Object.keys(side.playerPoints).length) {
    return (
      <Panel>
        <PanelHeader title={name} meta={`${fmt.pts(side.points)} total`} />
        <div className="px-4 py-8 text-center text-xs text-chalk-600 sm:px-5">
          No lineup on record for this game yet.
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title={name}
        meta={`${fmt.pts(startersTotal)} from starters`}
        legend={won ? undefined : undefined}
      />
      <ListHeader>
        <Col className="w-10 shrink-0">Slot</Col>
        <Col className="w-8 shrink-0 text-center">Pos</Col>
        <Col className="flex-1">Player</Col>
        <Col className="w-14 shrink-0 text-right" hint="Fantasy points scored in this game">
          Pts
        </Col>
      </ListHeader>
      <div className="divide-y divide-ink-700">
        {side.starters.map((pid, i) => row(pid, slots[i] ?? "FLEX"))}
      </div>

      {bench.length ? (
        <details className="group border-t border-ink-600">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] text-chalk-600 transition-colors hover:bg-ink-700/40 sm:px-5">
            <span>
              Bench · {bench.length} players · {fmt.pts(benchTotal)} left on it
            </span>
            <span className="transition-transform group-open:rotate-90">▸</span>
          </summary>
          <div className="divide-y divide-ink-700 bg-ink-850/60 opacity-70">
            {bench
              .sort((a, b) => (side.playerPoints[b] ?? 0) - (side.playerPoints[a] ?? 0))
              .map((pid) => row(pid, null))}
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

/**
 * A fixture the season has not reached yet.
 *
 * SHARES THE ROUTE WITH THE REPORT ABOVE, deliberately: it is the same game, and
 * a link written before kickoff should still resolve after it. The page simply
 * changes state when the result exists — this version disappears the moment the
 * season is archived and `getAllMeetings()` starts answering for the id.
 *
 * The server half is what does not move: who is playing, and every previous
 * meeting between them. Form and records come from the live layer, since a
 * season in progress has nothing archived to read.
 */
async function UpcomingMatchupPage({ fixture }: { fixture: ScheduledGame }) {
  const owners = getOwnerMap();
  const name = (slug: string) => owners.get(slug)?.name ?? slug;
  const firstName = (slug: string) => owners.get(slug)?.firstName ?? name(slug);

  /**
   * EVERY MEETING BEFORE THIS ONE, including earlier weeks of the season being
   * played — a rivalry that met in week 3 should say so in week 7 rather than
   * waiting for January. This fixture itself is excluded even once it has a
   * score: the tiles describe what both teams bring INTO it.
   */
  const series = (await getMeetingsToDate(fixture.a, fixture.b)).filter(
    (m) => m.id !== fixture.id,
  );
  const tally = seriesTally(series);
  const streak = seriesStreak(series);
  // PRESENT tense: nobody has walked into this game yet, so the run is live.
  const longest = longestStreak(series);
  /**
   * THE LONGEST RUN IN THE RIVALRY, not a restatement of the current one.
   * "Brendon won the last one" is already what the value above says; the record
   * to beat is the thing a reader does not know. Suppressed when the current run
   * IS the record, where naming it twice reads as a mistake.
   */
  const longestText =
    longest.slug && longest.run
      ? longest.slug === streak.slug && longest.run === streak.run
        ? "Longest of the series"
        : `Longest ${firstName(longest.slug)} W${longest.run}`
      : undefined;
  const headline = seriesLine(series, fixture.a, fixture.b, firstName);
  const record = seriesRecord(series, fixture.a, fixture.b, name);
  const last = series[0];

  const pairHref = `/h2h/${[fixture.a, fixture.b].sort().join("-vs-")}/`;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <BackLink
          fallback={{ href: `/history/${fixture.season}/`, label: `${fixture.season} Season` }}
        />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {fixture.season} · Week {fixture.week}
          </h1>
          {/* Says what the page IS, because it looks like a matchup page and a
              reader arriving from a link needs to know there is no result here. */}
          <span className="rounded-full border border-accent-dim px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
            PREVIEW
          </span>
        </div>
        <p className="mt-1 text-sm text-chalk-500">
          {headline} ·{" "}
          <Link href={pairHref} className="hover:text-accent">
            head to head
          </Link>
          {" · "}
          <Link href={`/history/${fixture.season}/`} className="hover:text-accent">
            {fixture.season} season
          </Link>
        </p>
      </div>

      {/* THE STATE OF THE RIVALRY AT KICKOFF, which is the one thing a preview
          can say as confidently as a report can. The finished page carries the
          same two numbers as "Series before this"; here they are the headline,
          because there is no score to lead with. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Head to head" value={record.value} sub={record.sub} />
        <Stat
          label="Streak"
          value={streak.run ? `${firstName(streak.slug!)} W${streak.run}` : "\u2014"}
          sub={longestText ?? (tally.played ? "Last one was a tie" : undefined)}
          tone={streak.run >= 3 ? "accent" : "default"}
        />
        <Stat
          label="Last meeting"
          value={
            last
              ? `${fmt.pts1(Math.max(last.a.points, last.b.points))} \u2013 ${fmt.pts1(
                  Math.min(last.a.points, last.b.points),
                )}`
              : "\u2014"
          }
          sub={last ? `${last.season}${last.week ? ` wk${last.week}` : ""}` : undefined}
          href={last ? `/matchups/${last.id}/` : undefined}
        />
      </div>

      <MatchupPreview
        refBySeason={getLeagueRefs()}
        initial={await getLiveSeason()}
        userIdToSlug={getUserIdToSlug()}
        teamByPlayer={getPlayerTeams()}
        season={fixture.season}
        week={fixture.week}
        a={fixture.a}
        b={fixture.b}
        ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
        seasonWeeks={seasonWeekCount()}
      />

      <SeriesPanel series={series} nameOf={name} pairHref={pairHref} />
    </div>
  );
}
