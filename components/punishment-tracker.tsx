"use client";

import { useMemo, useState } from "react";

import { PunishmentLedger, TeamNames } from "@/components/punishment-ledger";
import { SeasonPunishmentPanel } from "@/components/season-punishment";
import { CloseVoteModal } from "@/components/close-vote-modal";
import { CompleteModal } from "@/components/complete-modal";
import {
  PunishmentMedia,
  WeekMediaSheet,
  useSeasonMedia,
} from "@/components/punishment-media";
import { DrawModal } from "@/components/draw-modal";
import { SuggestionModal } from "@/components/suggestion-modal";
import { VoteModal } from "@/components/vote-modal";
import { Tip } from "@/components/tooltip";
import {
  Col,
  EmptyState,
  ListHeader,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
} from "@/components/ui";
import { useIdentity } from "@/components/identity";
import { useBallots, usePunishments } from "@/lib/punishments-live";
import {
  resolveSeasonPunishment,
  type SeasonPunishment,
} from "@/lib/season-punishment";
import type { LeagueRef } from "@/lib/league-ref";
import { useUrlState } from "@/lib/url-state";
import {
  buildLedger,
  hasVoted,
  ledgerTotals,
  poolRemaining,
  primaryOwner,
  PUNISHMENT_PHASES,
  tallyByOwner,
  type Ballot,
  type LedgerRow,
  type PunishmentPhase,
  type PunishmentSuggestion,
  type SeasonLows,
  type TeamMap,
} from "@/lib/punishments";

/** `?draw=1` opens the wheel; anything else, including absent, does not. */
const DRAW_FLAG = ["", "1"] as const;

/** Any plausible week. Whether it is a real one is the feed's business. */
const WEEK_OPTIONS = [
  "",
  ...Array.from({ length: 25 }, (_, i) => String(i + 1)),
];

/** The phases plus "unset", which is what an absent `?phase=` resolves to. */
const PHASE_OPTIONS = [...PUNISHMENT_PHASES, ""] as const;

/**
 * The whole punishment record, for the league that punishes its weekly low.
 *
 * ADAPTS TO WHERE THE YEAR IS, the way the home page does. Before a season the
 * league is still collecting suggestions and voting, so the ballot is the page
 * and there is no ledger to show; during and after one the ledger leads and the
 * ballot collapses to a footnote. Both states come out of the same feed with
 * nothing to configure — a season with no assignments is a season not yet
 * played.
 */
export function PunishmentTracker({
  seasons,
  teams,
  names,
  activeOwners,
  leagueRefs,
  userIdToSlug,
  drawTitle,
  commissioner,
  seasonPunishments,
  lastPlaceBySeason,
  cloudinaryCloud,
  cloudinaryPreset,
  src,
  endpoint,
  league,
  isMock,
}: {
  /** Derived weekly lows per season, from the build. */
  seasons: SeasonLows[];
  /** Season-scoped team rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  names: Record<string, string>;
  /** Turnout denominator — the people who could vote, not everyone on record. */
  activeOwners: number;
  /** Per-season provider refs, for the draw screen's live scoreline. */
  leagueRefs: Record<string, LeagueRef>;
  userIdToSlug: Record<string, string>;
  /** Tab title while the wheel is open, composed with the league's name. */
  drawTitle: string;
  /**
   * Owner slug allowed to log completions, or null for none.
   *
   * ONLY THE COMPLETION IS RESTRICTED. Anyone can read the ledger and anyone
   * can spin a wheel — the draw is random and the sheet refuses a second one —
   * but ticking a punishment off is a claim that something happened in the real
   * world, and one person should be making it.
   */
  commissioner: string | null;
  /**
   * The last-place punishment per season, from config.
   *
   * NOT FROM THE FEED. It is committed rather than fetched — see
   * lib/season-punishment — so it needs no skeleton and survives the sheet
   * being down, which is why it is rendered outside the loading split rather
   * than inside the branch that waits on it.
   *
   * It still follows the SEASON SWITCHER, so an untouched page showing the
   * newest season shows nothing until a year with an entry is selected. That is
   * the same rule the ledger below it obeys, and the reason this is keyed by
   * season rather than pinned to the latest one that has a record.
   */
  seasonPunishments: Record<number, SeasonPunishment>;
  /**
   * Who finished last, per season, so a punishment voted in the SHEET resolves
   * the same way a configured one does. Derived from the toilet bowl at build
   * time — never written down, here or anywhere.
   */
  lastPlaceBySeason: Record<number, string | null>;
  /**
   * Cloudinary, for punishment photos and video.
   *
   * Either being absent means the feature is not configured and the panel is
   * not rendered — the same switch as an empty `appsScriptEndpoint`.
   */
  cloudinaryCloud: string | null;
  cloudinaryPreset: string | null;
  src: string;
  /** Bare `/exec` URL for writes; null when reading the bundled sample. */
  endpoint: string | null;
  league: string;
  isMock: boolean;
}) {
  const {
    status,
    feed,
    error,
    insertSuggestion,
    recordDraw,
    recordCompletion,
  } = usePunishments(src);
  const [composing, setComposing] = useState(false);
  const [voting, setVoting] = useState(false);
  /** The ledger row whose completion date is being edited. */
  const [completing, setCompleting] = useState<LedgerRow | null>(null);
  /** The ledger row whose photos are open. */
  const [mediaRow, setMediaRow] = useState<LedgerRow | null>(null);
  const [seasonVoting, setSeasonVoting] = useState(false);
  /** Local echo of the viewer's season ballot, so the ticks update on save. */
  const [myLastPlace, setMyLastPlace] = useState<number[] | null>(null);
  const [closing, setClosing] = useState(false);
  /**
   * Counts from the last save, laid over the feed's.
   *
   * The feed was fetched before the vote and will not be refetched; the save
   * came back with the server's recomputation over every ballot, so it is both
   * newer and more correct than anything derivable here.
   */
  const [freshVotes, setFreshVotes] = useState<Record<number, number> | null>(
    null,
  );
  const { identity, ready: identityReady, openPicker } = useIdentity();
  const me = identityReady && identity.kind === "owner" ? identity.slug : null;

  // Every season either source knows about, newest first. Taking the union means
  // a season the sheet has but the site has not played yet (this one, right now)
  // still gets a tab.
  const years = useMemo(() => {
    const all = new Set<number>([
      ...seasons.map((s) => s.season),
      ...(feed?.seasons ?? []).map((s) => s.season),
    ]);
    return [...all].sort((a, b) => b - a);
  }, [seasons, feed]);

  /**
   * WHICH SEASON, IN THE QUERY STRING rather than in `useState`.
   *
   * A season page links straight in at its own year — "Full tracker" from 2025
   * has to land on 2025, not on whatever happens to be newest — and that only
   * works if the selection is addressable. It also makes the view shareable and
   * survives a reload, which is the whole argument in `useUrlState`.
   *
   * The newest season is the fallback, so it leaves no `?season=` behind and an
   * untouched page has a clean URL. A year that is not in the list — a stale
   * link, a hand-typed URL — falls back to the newest rather than showing
   * nothing.
   */
  const options = useMemo(() => years.map(String), [years]);
  const [param, setParam] = useUrlState(
    "season",
    options,
    String(years[0] ?? ""),
  );
  const active = Number(param) || null;
  const feedSeason = feed?.seasons.find((s) => s.season === active) ?? null;

  /**
   * `?phase=voting` forces a phase, for looking at one the league is not in.
   *
   * A season is only ever in one phase at a time and each one is a different
   * page, so without this two thirds of the layout can only be seen by editing
   * the sheet. Same argument as `?mockPhase=` for the league's own phase, and
   * badged for the same reason — a forced phase renders identically to a real
   * one, and "voting is open" is exactly the sort of thing that gets believed.
   *
   * It only changes the LAYOUT, never the data: the numbers underneath are
   * whatever the sheet actually says.
   */
  const [phaseParam] = useUrlState("phase", PHASE_OPTIONS, "");
  const phase: PunishmentPhase =
    phaseParam !== "" ? phaseParam : (feedSeason?.phase ?? "suggesting");
  const overridden = phaseParam !== "";

  const rows = useMemo(
    () =>
      buildLedger(
        feedSeason,
        seasons.find((s) => s.season === active)?.lows ?? [],
      ),
    [feedSeason, seasons, active],
  );
  const totals = ledgerTotals(rows);
  const pool = poolRemaining(feedSeason, rows);
  const tally = tallyByOwner(rows);

  // A VETOED SUGGESTION IS NOT SHOWN ANYWHERE. It was struck from contention, so
  // listing it — even greyed out — invites the reader to weigh something that
  // cannot be drawn, and puts a rejected idea on a permanent public page.
  // Filtered once, here, so no panel below has to remember.
  const suggestions = (feedSeason?.suggestions ?? [])
    .filter((s) => !s.vetoed)
    .map((s) =>
      freshVotes && s.id in freshVotes ? { ...s, votes: freshVotes[s.id] } : s,
    );

  /*
   * CONFIG WINS, THE SHEET FILLS IN. A league with no Apps Script — den-ops,
   * apartment-401 — keeps its committed history exactly as before; a league that
   * VOTES has no config entry, so the winner it just elected is resolved from the
   * feed through the same `resolveSeasonPunishment` and lands in the same four
   * states. Nothing downstream can tell which source it came from.
   */
  const votedPunishment =
    active && feedSeason?.seasonVote.winnerId != null
      ? resolveSeasonPunishment(
          active,
          {
            punishment:
              suggestions.find((x) => x.id === feedSeason.seasonVote.winnerId)
                ?.text ?? "",
            completed: feedSeason.seasonVote.completed,
          },
          lastPlaceBySeason[active] ?? null,
        )
      : null;
  const shownPunishment =
    (active ? seasonPunishments[active] : null) ?? votedPunishment;

  const seasonVoters = feedSeason?.seasonVote.voters ?? [];

  const ballots = useBallots({
    endpoint,
    league,
    season: active,
    voter: me,
    /*
     * BOTH VOTING PHASES, not just the weekly one. This is what the season
     * ballot's own state arrives on — `seasonPick` rides the same response — so
     * gating it on `voting` alone left `ready` permanently false in
     * `last-place-voting` and the modal sat on "Loading your ballot…" for ever.
     */
    enabled: phase === "voting" || phase === "last-place-voting",
  });
  // ONE FETCH, SHARED. The ledger wants a count per row and the panel wants
  // everything grouped; both come off the same list.
  const media = useSeasonMedia(cloudinaryCloud, league, active);

  const myPicks = new Set(ballots.mine?.punishmentIds ?? []);
  const iVoted = hasVoted(ballots.mine);

  const onSaved = (ballot: Ballot, votes: Record<number, number>) => {
    ballots.applySaved(ballot);
    setFreshVotes(votes);
  };

  /**
   * THE DRAW IS ADDRESSED BY URL — `?draw=1&week=5&loser=<slug>`.
   *
   * Which means it can be linked to before any navigation exists for it, and a
   * half-finished draw survives a reload. The flag is separate from the week so
   * the modal is explicitly opened rather than appearing because a stray `week`
   * lingered in the address bar.
   *
   * AN ALREADY-DRAWN WEEK IS A VIEW, NOT A REFUSAL — the wheel opens resting on
   * the punishment that was drawn. Restricting the week list to UNDRAWN weeks
   * closed the dialog the instant a draw landed, because the week stopped
   * matching and `useUrlState` fell back to empty: no stop, no reveal, no
   * confetti.
   */
  /**
   * VALIDATED AS A WEEK NUMBER, NOT AGAINST THE LEDGER.
   *
   * The dialog has to open the instant the URL is followed, and the ledger
   * needs the feed — a list built from it is empty on the first render, so the
   * week fell back to nothing and the dialog waited a second before appearing.
   * Whether the week is real, and whether it can be drawn for, is checked once
   * the feed lands and reported inside the dialog.
   */
  const ownerSlugs = useMemo(() => ["", ...Object.keys(names)], [names]);
  const [drawFlag, setDrawFlag] = useUrlState("draw", DRAW_FLAG, "");
  const [drawWeek, setDrawWeek] = useUrlState("week", WEEK_OPTIONS, "");
  const [drawLoser, setDrawLoser] = useUrlState("loser", ownerSlugs, "");

  const drawRow = rows.find((r) => String(r.week) === drawWeek) ?? null;
  /**
   * THE URL NAMES THE LOSER, and the ledger is only the fallback.
   *
   * The other way round everywhere else on this page — a derived low beats the
   * sheet — but a draw is opened deliberately, for a week that has usually just
   * finished and not been archived, by somebody who knows who lost. Deferring
   * to a stale or absent derived value would name the wrong person on the one
   * screen that is entirely about naming a person. It is also the name the live
   * scoreline is looked up by, so both agree by construction.
   */
  const drawLosers = drawLoser
    ? // Normalised to the primary owner, because that is the key a team-season
      // has everywhere else — the sheet, the derived lows, the ledger. Recording
      // a co-owner's slug would write a loser the ledger could not resolve back
      // to the team.
      [primaryOwner(teams, active ?? 0, drawLoser)]
    : (drawRow?.losers ?? []);
  /**
   * OPENS ON THE FLAG ALONE, so following a link puts the dialog on screen at
   * once and the waiting happens inside it. Gating on the phase or on the week
   * existing meant a second of the punishments page before the wheel appeared,
   * which reads as a mis-click.
   */
  const drawOpen = drawFlag === "1" && Boolean(endpoint);
  const drawUnavailable =
    status !== "ready"
      ? null
      : phase !== "live"
        ? `Draws open once the ${active} pool is set.`
        : !drawWeek
          ? "No week to draw for."
          : !drawRow
            ? `Nothing recorded for week ${drawWeek} yet.`
            : null;

  const closeDraw = () => {
    setDrawFlag("");
    setDrawWeek("");
    setDrawLoser("");
  };

  /**
   * Open the wheel from a ledger row, by writing the address it lives at.
   *
   * Sets the params rather than navigating, because this page already has the
   * dialog: a `<Link>` to the same route pushes state without firing
   * `popstate`, which is what `useUrlState` listens for, so the address bar
   * would change and nothing would open. A row on the SEASON page has no
   * dialog to open and links across instead — see `PunishmentLedger`.
   */
  const openDraw = (row: LedgerRow) => {
    setDrawWeek(String(row.week));
    setDrawLoser(row.losers[0] ?? "");
    setDrawFlag("1");
  };

  /**
   * The ledger as far as the BUILD knows it, for the wait.
   *
   * `buildLedger` with no feed still produces a row per week the league lost,
   * carrying the loser, the score and the link to the game — everything except
   * what the sheet holds. Which also settles the shape of the skeleton: a season
   * with weeks on the board is `live`, and one with none has not been played, so
   * it is collecting suggestions or voting. Both guesses are the same rule the
   * phase clamp uses, so the layout does not rearrange when the feed lands.
   */
  const pendingRows = useMemo(
    () =>
      buildLedger(null, seasons.find((s) => s.season === active)?.lows ?? []),
    [seasons, active],
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Punishments
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-chalk-500">
            Score the fewest points in a regular-season week and you owe the
            league a punishment, drawn from a pool the whole league votes on.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMock ? <SampleBadge /> : null}
          {overridden && status === "ready" ? (
            <PhaseBadge phase={phase} />
          ) : null}
          {years.length > 1 ? (
            <div className="flex items-center gap-1">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setParam(String(y))}
                  aria-current={y === active ? "true" : undefined}
                  className={`tabular rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    y === active
                      ? "bg-ink-700 text-chalk-100"
                      : "text-chalk-500 hover:bg-ink-700/60 hover:text-chalk-300"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ABOVE THE LEDGER, AND OUTSIDE THE FEED'S LOADING SPLIT. One record a
          year against fourteen rows, and the bigger punishment of the two, so
          it leads. It comes from config rather than the sheet — see
          lib/season-punishment — so it has nothing to wait for and no skeleton
          to draw, and it is still here when the sheet is down and everything
          below this is an error panel.

          Not gated on `phase` either: the yearly punishment has a lifecycle of
          its own and can be decided, owed or done while the weekly pool is
          still being voted on. */}
      {active && shownPunishment ? (
        <SeasonPunishmentPanel
          league={league}
          punishment={shownPunishment}
          teams={teams}
          names={names}
          cloud={cloudinaryCloud}
          preset={cloudinaryPreset}
        />
      ) : null}

      {status === "loading" ? (
        <TrackerSkeleton rows={pendingRows} teams={teams} names={names} />
      ) : status === "error" ? (
        <Panel>
          <EmptyState>
            Could not reach the punishment sheet ({error}). Everything else on
            the site is unaffected — this is the one page that reads it.
          </EmptyState>
        </Panel>
      ) : !feedSeason ? (
        <Panel>
          <EmptyState>Nothing recorded for {active}.</EmptyState>
        </Panel>
      ) : (
        <>
          {phase !== "live" ? null : rows.length ? (
            <Panel>
              <PanelHeader
                title={`${active} Ledger`}
                meta={`${totals.completed} of ${totals.assigned} completed`}
                legend="The score links to the game it happened in."
              />
              <PunishmentLedger
                rows={rows}
                teams={teams}
                names={names}
                onDraw={endpoint ? openDraw : undefined}
                onComplete={
                  // A PERSON, not a team: a co-owner does not inherit this, so
                  // the slug is compared raw rather than through `primaryOwner`.
                  endpoint && me && me === commissioner
                    ? setCompleting
                    : undefined
                }
                onMedia={
                  cloudinaryCloud && cloudinaryPreset ? setMediaRow : undefined
                }
                media={media.previewFor}
              />
            </Panel>
          ) : (
            <Panel>
              <PanelHeader title={`${active} Ledger`} meta="not started" />
              <EmptyState>
                The pool is set. Nobody has lost a week yet.
              </EmptyState>
            </Panel>
          )}

          {/* THE TILES SIT UNDER THE LEDGER, not above it.

              They SUMMARISE the fourteen rows above, so they read as a total
              rather than as a preamble — and putting them first pushed the
              ledger, which is the thing people come here for, below the fold on
              a phone. Under it they also lead into the pool and the tally, which
              are the same kind of season-wide accounting.

              NOT BEFORE THE SEASON STARTS. A suggestion count and a running vote
              total are both already legible from the ballot, one row per
              suggestion, so a row of tiles restating them is noise. The live
              phase keeps all four because they summarise fourteen rows, not
              nine. */}
          {phase === "live" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Assigned"
                value={
                  feedSeason.poolSize
                    ? `${totals.assigned}/${feedSeason.poolSize}`
                    : totals.assigned
                }
                sub={`${totals.weeks} weeks lost`}
              />
              <Stat label="Completed" value={totals.completed} tone="accent" />
              <Stat
                label="Outstanding"
                value={totals.outstanding}
                sub={totals.outstanding ? "still owed" : "all square"}
              />
              <Stat
                label="Pool left"
                value={pool.length}
                sub={
                  feedSeason.poolSize ? `of ${feedSeason.poolSize}` : undefined
                }
              />
            </div>
          ) : null}


          {/* Only once there is something to photograph. */}
          {phase === "live" && cloudinaryCloud && cloudinaryPreset && active ? (
            <PunishmentMedia
              cloud={cloudinaryCloud}
              seasonPunishment={shownPunishment}
              items={media.items}
              season={active}
              rows={rows}
              teams={teams}
              names={names}
            />
          ) : null}

          {phase !== "live" ? (
            <PhaseCallout
              phase={phase}
              // VOTING NEEDS AN IDENTITY, unlike suggesting: one ballot per
              // person needs a key, and localStorage is where the site keeps it.
              //
              // Someone browsing anonymously gets the picker AND THEN THE BALLOT
              // — the button said "Cast your votes", so stopping at a team picker
              // would be a bait and switch and would need a second tap nobody
              // would know to make. Picking "just browsing" instead resumes
              // nothing, which is the right answer to declining to say who you
              // are.
              onAct={
                !endpoint
                  ? null
                  : phase === "suggesting"
                    ? () => setComposing(true)
                    : (() => {
                        // BOTH VOTES NEED AN IDENTITY, and both resume straight
                        // into the ballot for somebody who picks a team — the
                        // button said "Cast your votes", so stopping at a picker
                        // would need a second tap nobody would know to make.
                        const open =
                          phase === "last-place-voting"
                            ? () => setSeasonVoting(true)
                            : () => setVoting(true);
                        return me
                          ? open
                          : () =>
                              openPicker((chosen) => {
                                if (chosen.kind === "owner") open();
                              });
                      })()
              }
              acted={
                phase === "last-place-voting"
                  ? Boolean(myLastPlace ?? ballots.seasonPick)
                  : phase === "voting" && iVoted
              }
              // Suggestions stay open through both votes, as a quieter second
              // action — a late idea is a candidate for the last-place ballot the
              // moment it is added, since that ballot is defined as whatever the
              // weekly pool did not take.
              onSuggest={
                endpoint && phase !== "suggesting" ? () => setComposing(true) : null
              }
              turnout={
                phase === "last-place-voting"
                  ? {
                      /*
                       * FROM THE FEED, so it does not wait on the ballot fetch —
                       * and counting the viewer in the moment they save, because
                       * the feed will not know until it is refetched and seeing
                       * your own vote not register reads as a failure.
                       */
                      voted:
                        seasonVoters.length +
                        (myLastPlace && me && !seasonVoters.includes(me)
                          ? 1
                          : 0),
                      of: activeOwners,
                    }
                  : phase === "voting" && ballots.ready
                    ? { voted: ballots.voters.length, of: activeOwners }
                    : null
              }
            />
          ) : null}

          {/* THE LEFTOVERS ARE THE POINT, not a consolation bracket. What loses
              a weekly vote usually loses it for being too much for one week,
              which is exactly what a whole season deserves. So the candidates
              are precisely the suggestions the weekly pool did not take. */}
          {phase === "last-place-voting" ? (
            <LastPlaceBallot
              candidates={suggestions.filter((x) => !x.selected)}
              names={names}
              mine={myLastPlace ?? ballots.seasonPick}
              onClose={
                // COMMISSIONER ONLY, like logging a completion: declaring a
                // winner is a claim the whole league is held to.
                endpoint && me && me === commissioner
                  ? () => setClosing(true)
                  : undefined
              }
            />
          ) : null}

          {/* THE POOL IS WORTH SEEING AS SOON AS IT IS SET, which is a phase
              earlier than it was shown. In `last-place-voting` nothing has been
              drawn yet, so this is the whole weekly pool — and it is the natural
              companion to the last-place ballot beside it, which holds exactly
              the suggestions this panel does not.

              The tally keeps its `live` gate: nobody has lost a week yet, so
              "who owes what" has nothing to count. */}
          {phase === "live" || phase === "last-place-voting" ? (
            <div
              className={
                phase === "live" ? "grid gap-5 lg:grid-cols-2" : "grid gap-5"
              }
            >
              <Panel>
                <PanelHeader
                  // "Still in the pool" and "left" both imply some have gone.
                  // Before the season none have, so it is simply the pool.
                  title={
                    phase === "live" ? "Still in the pool" : "The weekly pool"
                  }
                  meta={
                    phase === "live"
                      ? pool.length
                        ? `${pool.length} left`
                        : "empty"
                      : `${pool.length} punishment${pool.length === 1 ? "" : "s"}`
                  }
                  legend={
                    phase === "live"
                      ? "What a loser can still draw."
                      : "What a weekly loser will draw from. The last-place ballot holds everything this does not."
                  }
                />
                {pool.length ? (
                  <ul className="divide-y divide-ink-700">
                    {pool.map((p) => (
                      <li
                        key={p.id}
                        className="px-4 py-1.5 text-sm text-chalk-300 sm:px-5"
                      >
                        {p.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState>Every punishment has been handed out.</EmptyState>
                )}
              </Panel>

              {phase === "live" ? (
                <Panel>
                  <PanelHeader
                    title="Who owes what"
                    meta={`${tally.length} owners`}
                  />
                  <ListHeader>
                    <Col className="flex-1">Owner</Col>
                    <Col
                      className="w-12 shrink-0 text-right"
                      hint="Weeks finishing lowest"
                    >
                      Lost
                    </Col>
                    <Col className="w-12 shrink-0 text-right">Done</Col>
                    <Col
                      className="w-12 shrink-0 text-right"
                      hint="Assigned but not yet completed"
                    >
                      Owed
                    </Col>
                  </ListHeader>
                  <ul className="divide-y divide-ink-700">
                    {tally.map((t) => (
                      <li
                        key={t.slug}
                        className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
                      >
                        {/* A co-owned team is one row and both names — the tally
                            counts weeks a TEAM lost, and both of them owe it. */}
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <TeamNames
                            season={active ?? 0}
                            slugs={[t.slug]}
                            teams={teams}
                            names={names}
                          />
                        </span>
                        <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-300">
                          {t.lost}
                        </span>
                        <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-500">
                          {t.completed || "—"}
                        </span>
                        <span
                          className={`tabular w-12 shrink-0 text-right text-sm ${
                            t.outstanding
                              ? "font-semibold text-loss"
                              : "text-chalk-600"
                          }`}
                        >
                          {t.outstanding || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </div>
          ) : null}

          <Ballot
            myPicks={myPicks}
            suggestions={suggestions}
            names={names}
            poolSize={feedSeason.poolSize}
            phase={phase}
          />
        </>
      )}

      {mediaRow && cloudinaryCloud && cloudinaryPreset && active ? (
        <WeekMediaSheet
          cloud={cloudinaryCloud}
          preset={cloudinaryPreset}
          league={league}
          season={active}
          row={mediaRow}
          items={(media.items ?? []).filter((m) => m.week === mediaRow.week)}
          teams={teams}
          names={names}
          onAdded={media.add}
          onClose={() => setMediaRow(null)}
        />
      ) : null}

      {completing && endpoint && active ? (
        <CompleteModal
          endpoint={endpoint}
          league={league}
          season={active}
          row={completing}
          teams={teams}
          names={names}
          onSaved={(completed) =>
            recordCompletion(active, completing.week, completed)
          }
          onClose={() => setCompleting(null)}
        />
      ) : null}

      {drawOpen && endpoint && active ? (
        <DrawModal
          endpoint={endpoint}
          league={league}
          season={active}
          week={Number(drawWeek) || 0}
          losers={drawLosers}
          pool={pool}
          teams={teams}
          names={names}
          leagueRef={leagueRefs[String(active)] ?? null}
          userIdToSlug={userIdToSlug}
          documentTitle={drawTitle}
          loading={status !== "ready"}
          unavailable={drawUnavailable}
          alreadyDrawn={drawRow?.punishment ?? null}
          onDrawn={(punishmentId) =>
            recordDraw(active, Number(drawWeek), drawLosers, punishmentId)
          }
          onClose={closeDraw}
        />
      ) : null}

      {voting && endpoint && active && me ? (
        <VoteModal
          endpoint={endpoint}
          league={league}
          season={active}
          voter={me}
          suggestions={suggestions}
          current={ballots.mine?.punishmentIds ?? []}
          ready={ballots.ready}
          onSaved={onSaved}
          onClose={() => setVoting(false)}
        />
      ) : null}

      {seasonVoting && endpoint && active && me ? (
        <VoteModal
          kind="last-place"
          endpoint={endpoint}
          league={league}
          season={active}
          voter={me}
          // The candidates, not the whole list — the same filter the panel uses,
          // and the server refuses anything outside it anyway.
          suggestions={suggestions.filter((x) => !x.selected)}
          current={myLastPlace ?? ballots.seasonPick ?? []}
          ready={ballots.ready}
          onSaved={(ballot) => setMyLastPlace(ballot.punishmentIds)}
          onClose={() => setSeasonVoting(false)}
        />
      ) : null}

      {closing && endpoint && active ? (
        <CloseVoteModal
          endpoint={endpoint}
          league={league}
          season={active}
          candidates={suggestions.filter((x) => !x.selected)}
          turnout={{
            voted: (feedSeason?.seasonVote.voters ?? []).length,
            of: activeOwners,
          }}
          onClose={() => setClosing(false)}
        />
      ) : null}

      {composing && endpoint && active ? (
        <SuggestionModal
          endpoint={endpoint}
          league={league}
          season={active}
          names={names}
          onAdded={(created) => insertSuggestion(active, created)}
          onClose={() => setComposing(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The page while the sheet is still answering.
 *
 * NOT A SPINNER, and not a single grey slab either. The chrome above this — the
 * title, the description, the season switcher — is real from the first paint,
 * and so is half of the ledger, because who lost each week and by how much comes
 * out of the build rather than the sheet. Only the punishment and whether it has
 * been served are actually pending, so only those shimmer.
 *
 * THE SHAPE IS A GUESS, but a principled one: a season with weeks on the board
 * is live, one with none has not been played. Both are the rule the phase clamp
 * uses, so when the feed lands the panels are already in the right places and
 * nothing jumps — which is the entire reason to draw a skeleton rather than
 * nothing.
 */
function TrackerSkeleton({
  rows,
  teams,
  names,
}: {
  rows: LedgerRow[];
  teams: TeamMap;
  names: Record<string, string>;
}) {
  if (!rows.length) {
    // Pre-season: a call to action and a ballot, neither of whose contents are
    // knowable yet.
    return (
      <div className="space-y-5 sm:space-y-6" aria-busy="true">
        <Panel className="border-accent-dim/70 bg-accent/[0.06]">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-44 rounded-lg" />
          </div>
        </Panel>
        <Panel>
          <div className="border-b border-ink-600 px-4 py-3 sm:px-5">
            <Skeleton className="h-3 w-32" />
          </div>
          <ul className="divide-y divide-ink-700">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
              >
                <Skeleton
                  className={`h-3.5 ${["w-1/2", "w-3/4", "w-2/3", "w-5/6"][i % 4]}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6" aria-busy="true">
      <Panel>
        <PanelHeader
          title={`${rows[0].season} Ledger`}
          legend="The score links to the game it happened in."
        />
        <PunishmentLedger rows={rows} teams={teams} names={names} loading />
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["Assigned", "Completed", "Outstanding", "Pool left"].map((label) => (
          <div
            key={label}
            className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-3"
          >
            <div className="eyebrow mb-1.5 text-[10px]">{label}</div>
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Still in the pool" />
          <ul className="divide-y divide-ink-700">
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-4 py-2 sm:px-5">
                <Skeleton
                  className={`h-3.5 ${["w-2/3", "w-5/6", "w-1/2"][i]}`}
                />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Who owes what" />
          <ul className="divide-y divide-ink-700">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
              >
                <Skeleton className="h-3.5 w-32" />
                <span className="flex-1" />
                <Skeleton className="h-3.5 w-6" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/**
 * Every suggestion still in contention.
 *
 * THE COLUMNS FOLLOW THE PHASE, because a column that cannot mean anything yet
 * is worse than an absent one — a votes column of zeros reads as "nobody likes
 * these", and an empty status column reads as "nothing made the pool".
 *
 * | Phase | Columns | Order |
 * | --- | --- | --- |
 * | suggesting | punishment, by | newest first |
 * | voting | punishment, by, votes | most votes first |
 * | live | punishment, by, votes, status | most votes first |
 *
 * Newest first while suggestions are open so a submission lands where the person
 * who just made it is looking; by votes thereafter, so the pool cut line is
 * where you would expect it.
 *
 * IT IS THE PAGE until the pool is set, and a footnote after — collapsed once a
 * season is under way, because settled voting is history and the ledger above it
 * is what anyone came for.
 *
 * Vetoed suggestions are already gone by the time they reach here, filtered at
 * the one place the feed is read.
 *
 * Column widths are named because a `ListHeader` cell must repeat the width
 * class of the row cell beneath it; these are flex rows, not a `<table>`.
 */
const BALLOT = {
  text: "min-w-0 flex-1",
  by: "hidden w-28 shrink-0 sm:block",
  votes: "w-12 shrink-0 text-right",
  status: "w-16 shrink-0 text-right",
};

/**
 * The cut line is only mentioned when the sheet has said where it is — "top null
 * make the pool" being the alternative.
 */
/**
 * The candidates for the season-long punishment.
 *
 * NO VOTES COLUMN, unlike the weekly ballot at the same stage. The league chose
 * turnout-only for this one, and a column that cannot mean anything yet is worse
 * than an absent one — so the list is ordered by id, which is also the order the
 * vote modal uses, rather than leaking the ranking through the sort.
 *
 * The viewer's own picks are ticked. Their ballot on their own screen is not what
 * secrecy covers, and without it nothing on the page says what the button opens.
 */
function LastPlaceBallot({
  candidates,
  names,
  mine,
  onClose,
}: {
  candidates: PunishmentSuggestion[];
  names: Record<string, string>;
  /** The viewer's own picks, ticked. Null when they have not voted. */
  mine: number[] | null;
  /** Commissioner only. Absent for everyone else. */
  onClose?: () => void;
}) {
  const picked = new Set(mine ?? []);
  return (
    <Panel>
      <PanelHeader
        title="Last Place Punishment"
        meta={
          onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-ink-500 px-2 py-0.5 text-[10px] font-semibold text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Close voting
            </button>
          ) : (
            `${candidates.length} on the ballot`
          )
        }
        legend="Whoever finishes bottom does one of these. They are the suggestions the weekly pool did not take — usually the ones too much for a single week."
      />
      {candidates.length ? (
        <ul className="divide-y divide-ink-700">
          {candidates
            .slice()
            .sort((a, b) => a.id - b.id)
            .map((c) => (
              <li
                key={c.id}
                className="flex items-baseline gap-3 px-4 py-1.5 sm:px-5"
              >
                {/* The viewer's own picks are ticked. Their ballot on their
                    own screen is not what secrecy covers, and without this
                    nothing says what the button would open. */}
                <span
                  aria-hidden
                  className={`w-3 shrink-0 text-[11px] ${
                    picked.has(c.id) ? "text-accent" : "text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1 text-sm text-chalk-300">
                  {c.text}
                </span>
                {c.suggestedBy ? (
                  <span
                    data-owner={c.suggestedBy}
                    className="hidden w-28 shrink-0 truncate text-right text-[11px] text-chalk-600 sm:block"
                  >
                    {names[c.suggestedBy] ?? c.suggestedBy}
                  </span>
                ) : null}
              </li>
            ))}
        </ul>
      ) : (
        <EmptyState>
          Every suggestion made the weekly pool, so there is nothing left to vote
          on. Put another one forward.
        </EmptyState>
      )}
    </Panel>
  );
}

const BALLOT_META: Record<
  PunishmentPhase,
  (n: number, pool: number | null) => string
> = {
  suggesting: (n) => `${n} so far · voting has not opened`,
  voting: (n, pool) =>
    pool
      ? `${n} on the ballot · top ${pool} make the pool`
      : `${n} on the ballot`,
  // The weekly pool is already set by now, so this reads like `live` — the
  // weekly ballot below is a record of what was decided, not a live vote.
  "last-place-voting": (n, pool) =>
    pool ? `${n} suggestions · top ${pool} made the pool` : `${n} suggestions`,
  live: (n, pool) =>
    pool ? `${n} suggestions · top ${pool} made the pool` : `${n} suggestions`,
};

function Ballot({
  suggestions,
  names,
  poolSize,
  phase,
  myPicks,
}: {
  suggestions: Array<{
    id: number;
    text: string;
    suggestedBy: string | null;
    votes: number;
    selected: boolean;
  }>;
  names: Record<string, string>;
  poolSize: number | null;
  phase: PunishmentPhase;
  /**
   * The viewer's own approvals.
   *
   * Their own ballot on their own screen, which secrecy does not cover — and
   * without it the list gives no clue what "Edit your votes" would open.
   */
  myPicks: Set<number>;
}) {
  const showVotes = phase !== "suggesting";
  /*
   * THE WEEKLY VOTE IS OVER BY `last-place-voting`, so the pool is settled and
   * the status column can say who made it. Showing it only in `live` withheld a
   * decided result for no reason — and it is the column that explains why the
   * last-place ballot holds the suggestions it does.
   */
  const showStatus = phase === "live" || phase === "last-place-voting";
  const title = phase === "suggesting" ? "Suggestions" : "The ballot";
  const meta = BALLOT_META[phase](suggestions.length, poolSize);

  const sorted = [...suggestions].sort((a, b) =>
    showVotes ? b.votes - a.votes || a.id - b.id : b.id - a.id,
  );

  const body = !suggestions.length ? (
    <EmptyState>
      {phase === "suggesting"
        ? "Nobody has suggested anything yet."
        : "No suggestions on the ballot."}
    </EmptyState>
  ) : (
    <>
      <ListHeader>
        <Col className={BALLOT.text}>Punishment</Col>
        <Col className={BALLOT.by}>Suggested by</Col>
        {showVotes ? <Col className={BALLOT.votes}>Votes</Col> : null}
        {showStatus ? <Col className={BALLOT.status}>Status</Col> : null}
      </ListHeader>
      <ul className="divide-y divide-ink-700">
        {sorted.map((s) => (
          <li
            key={s.id}
            className="flex items-start gap-3 px-4 py-1.5 sm:items-center sm:px-5"
          >
            <span
              className={`text-sm sm:truncate ${BALLOT.text}`}
              title={s.text}
            >
              {myPicks.has(s.id) ? (
                <span
                  aria-label="You voted for this"
                  className="mr-1.5 font-bold text-accent"
                >
                  ✓
                </span>
              ) : null}
              <span className="text-chalk-300">{s.text}</span>
            </span>
            <span className={`truncate text-xs text-chalk-500 ${BALLOT.by}`}>
              {s.suggestedBy ? (
                <span data-owner={s.suggestedBy}>
                  {names[s.suggestedBy] ?? s.suggestedBy}
                </span>
              ) : (
                <span className="text-chalk-600">—</span>
              )}
            </span>
            {showVotes ? (
              <span
                className={`tabular text-sm text-chalk-300 ${BALLOT.votes}`}
              >
                {s.votes}
              </span>
            ) : null}
            {showStatus ? (
              <span className={BALLOT.status}>
                {s.selected ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                    In pool
                  </span>
                ) : (
                  <span className="text-[11px] text-chalk-600">—</span>
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );

  // Not collapsible while it is the whole page: a disclosure triangle on the one
  // thing there is to read invites closing it onto an empty screen.
  if (phase !== "live") {
    return (
      <Panel>
        <PanelHeader title={title} meta={meta} />
        {body}
      </Panel>
    );
  }

  return (
    <Panel>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between border-b border-ink-600 px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5">
          <span className="flex items-baseline gap-3">
            <span className="eyebrow">{title}</span>
            <span className="text-xs text-chalk-600 tabular">{meta}</span>
          </span>
          <span className="text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        {body}
      </details>
    </Panel>
  );
}

/**
 * The thing to do in this phase.
 *
 * DISABLED UNTIL THE WRITE ENDPOINTS EXIST. The button is here rather than added
 * later because its absence is the layout question — where a call to action sits
 * changes how the page reads — and a placeholder that says why is better than a
 * page that quietly offers no way to take part. The tooltip is the whole
 * explanation; there is no dead click.
 */
const ACTIONS: Partial<
  Record<PunishmentPhase, { headline: string; label: string; done?: string }>
> = {
  suggesting: {
    headline: "Suggestions are open",
    label: "Suggest a punishment",
  },
  voting: {
    headline: "Voting is open",
    label: "Cast your votes",
    // The button is the same control either way — it opens the same pre-filled
    // ballot — but "Cast" reads as something still owed once you have voted.
    done: "Edit your votes",
  },
  "last-place-voting": {
    headline: "Last-place voting is open",
    label: "Cast your votes",
    done: "Edit your votes",
  },
};

/** On the button's `title`, for the phase whose write endpoint does not exist. */
const NOT_WIRED = "Not wired up yet — send it to the commissioner for now.";

/**
 * The thing to do this phase, as a banner rather than a chip.
 *
 * IT IS THE POINT OF THE PAGE while the pool is being decided, so it gets a full
 * row above the ballot instead of a place in the row of badges beside the title,
 * where it read as one more label. Tinted with the accent, which is what the site
 * uses for live state everywhere else.
 *
 * A HEADLINE AND A BUTTON, nothing else. Explaining what "suggestions are open"
 * means costs a line of prose to tell people something the button already says.
 *
 * `onAct` NULL MEANS THIS PHASE HAS NO WRITE ENDPOINT YET — the button stays
 * disabled and says why, rather than opening a modal that cannot save. Voting is
 * in that state today; suggesting is live. It renders either way because its
 * absence is the layout question: where the call to action sits changes how the
 * page reads, and wiring the second one in should not move anything.
 */
function PhaseCallout({
  phase,
  onAct,
  acted = false,
  onSuggest = null,
  turnout = null,
}: {
  phase: PunishmentPhase;
  onAct: (() => void) | null;
  /** This viewer has already done the thing; the button edits rather than casts. */
  acted?: boolean;
  /** The quieter second action — suggesting stays open during voting. */
  onSuggest?: (() => void) | null;
  turnout?: { voted: number; of: number } | null;
}) {
  const action = ACTIONS[phase];
  if (!action) return null;
  return (
    <Panel className="border-accent-dim/70 bg-accent/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
        <div>
          <div className="text-sm font-bold text-chalk-100">
            {action.headline}
          </div>
          {turnout ? (
            // Counted against ACTIVE owners: someone who left the league cannot
            // vote, so including them would make full turnout unreachable.
            <div className="mt-0.5 text-xs text-chalk-500 tabular">
              {turnout.voted} of {turnout.of} have voted
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {onSuggest ? (
            <button
              type="button"
              onClick={onSuggest}
              className="shrink-0 rounded-lg border border-ink-500 px-3 py-2 text-xs font-medium text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Suggest another
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAct ?? undefined}
            disabled={!onAct}
            title={onAct ? undefined : NOT_WIRED}
            className={`shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity ${
              onAct ? "hover:opacity-90" : "cursor-not-allowed opacity-60"
            }`}
          >
            {(acted && action.done) || action.label}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** Marks a phase forced by `?phase=`, for the same reason `<MockBadge />` exists. */
function PhaseBadge({ phase }: { phase: PunishmentPhase }) {
  return (
    <Tip
      text={`Showing the ${phase} layout because ?phase=${phase} is set. The numbers are real; the phase is not.`}
      className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gold"
    >
      {phase} view
    </Tip>
  );
}

/**
 * Says the numbers are made up.
 *
 * Same reasoning as `<MockBadge />`: sample data renders identically to real
 * data, and "the punishments are logged" is exactly the sort of thing that gets
 * screenshotted and believed.
 */
export function SampleBadge() {
  return (
    <Tip
      text="No punishment sheet is connected yet, so this page is showing bundled sample data."
      className="shrink-0 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gold"
    >
      Sample data
    </Tip>
  );
}
