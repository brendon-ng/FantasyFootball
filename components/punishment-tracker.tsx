"use client";

import { useMemo, useState } from "react";

import { PunishmentLedger, TeamNames } from "@/components/punishment-ledger";
import { SuggestionModal } from "@/components/suggestion-modal";
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
import { usePunishments } from "@/lib/punishments-live";
import { useUrlState } from "@/lib/url-state";
import {
  buildLedger,
  ledgerTotals,
  poolRemaining,
  tallyByOwner,
  PUNISHMENT_PHASES,
  type LedgerRow,
  type PunishmentPhase,
  type SeasonLows,
  type TeamMap,
} from "@/lib/punishments";

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
  src: string;
  /** Bare `/exec` URL for writes; null when reading the bundled sample. */
  endpoint: string | null;
  league: string;
  isMock: boolean;
}) {
  const { status, feed, error, insertSuggestion } = usePunishments(src);
  const [composing, setComposing] = useState(false);

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
  const suggestions = (feedSeason?.suggestions ?? []).filter((s) => !s.vetoed);

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
    () => buildLedger(null, seasons.find((s) => s.season === active)?.lows ?? []),
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
          {overridden && status === "ready" ? <PhaseBadge phase={phase} /> : null}
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
          {/* THE PHASE DECIDES THE PAGE, not the row count. Before the pool is
              set there is no ledger, no remaining pool and nothing to tally —
              the ballot IS the page, and everything else would be a panel
              explaining that it is empty.

              NO TILES BEFORE THE SEASON STARTS. A suggestion count and a running
              vote total are both already legible from the ballot underneath, one
              row per suggestion, and a row of tiles restating them pushes the one
              thing there is to do below the fold. The live phase keeps them
              because they summarise fourteen rows, not nine. */}
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

          {phase !== "live" ? null : rows.length ? (
            <Panel>
              <PanelHeader
                title={`${active} Ledger`}
                meta={`${totals.completed} of ${totals.assigned} served`}
                legend="The score links to the game it happened in."
              />
              <PunishmentLedger rows={rows} teams={teams} names={names} />
            </Panel>
          ) : (
            <Panel>
              <PanelHeader title={`${active} Ledger`} meta="not started" />
              <EmptyState>
                The pool is set. Nobody has lost a week yet.
              </EmptyState>
            </Panel>
          )}

          {phase === "live" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel>
                <PanelHeader
                  title="Still in the pool"
                  meta={pool.length ? `${pool.length} left` : "empty"}
                  legend="What a loser can still draw."
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
                    hint="Assigned but not yet served"
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
            </div>
          ) : null}

          {phase !== "live" ? (
            <PhaseCallout
              phase={phase}
              // Suggesting is wired up; voting is not yet, so its button stays
              // disabled rather than opening a modal that cannot save.
              onAct={
                endpoint && phase === "suggesting"
                  ? () => setComposing(true)
                  : null
              }
            />
          ) : null}

          <Ballot
            suggestions={suggestions}
            names={names}
            poolSize={feedSeason.poolSize}
            phase={phase}
          />
        </>
      )}

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
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
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

      <Panel>
        <PanelHeader
          title={`${rows[0].season} Ledger`}
          legend="The score links to the game it happened in."
        />
        <PunishmentLedger rows={rows} teams={teams} names={names} loading />
      </Panel>

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
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
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
const BALLOT_META: Record<
  PunishmentPhase,
  (n: number, pool: number | null) => string
> = {
  suggesting: (n) => `${n} so far · voting has not opened`,
  voting: (n, pool) =>
    pool
      ? `${n} on the ballot · top ${pool} make the pool`
      : `${n} on the ballot`,
  live: (n, pool) =>
    pool ? `${n} suggestions · top ${pool} made the pool` : `${n} suggestions`,
};

function Ballot({
  suggestions,
  names,
  poolSize,
  phase,
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
}) {
  const showVotes = phase !== "suggesting";
  const showStatus = phase === "live";
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
              className={`text-sm text-chalk-300 sm:truncate ${BALLOT.text}`}
              title={s.text}
            >
              {s.text}
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
  Record<PunishmentPhase, { headline: string; label: string }>
> = {
  suggesting: {
    headline: "Suggestions are open",
    label: "Suggest a punishment",
  },
  voting: { headline: "Voting is open", label: "Cast your votes" },
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
}: {
  phase: PunishmentPhase;
  onAct: (() => void) | null;
}) {
  const action = ACTIONS[phase];
  if (!action) return null;
  return (
    <Panel className="border-accent-dim/70 bg-accent/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
        <div className="text-sm font-bold text-chalk-100">
          {action.headline}
        </div>
        <button
          type="button"
          onClick={onAct ?? undefined}
          disabled={!onAct}
          title={onAct ? undefined : NOT_WIRED}
          className={`shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity ${
            onAct ? "hover:opacity-90" : "cursor-not-allowed opacity-60"
          }`}
        >
          {action.label}
        </button>
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
