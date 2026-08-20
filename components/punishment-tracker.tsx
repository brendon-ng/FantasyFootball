"use client";

import { useMemo } from "react";

import { PunishmentLedger, TeamNames } from "@/components/punishment-ledger";
import { Tip } from "@/components/tooltip";
import { Col, EmptyState, ListHeader, Panel, PanelHeader, Stat } from "@/components/ui";
import { usePunishments } from "@/lib/punishments-live";
import { useUrlState } from "@/lib/url-state";
import {
  buildLedger,
  ledgerTotals,
  poolRemaining,
  tallyByOwner,
  type SeasonLows,
  type TeamMap,
} from "@/lib/punishments";

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
  isMock,
}: {
  /** Derived weekly lows per season, from the build. */
  seasons: SeasonLows[];
  /** Season-scoped team rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  names: Record<string, string>;
  src: string;
  isMock: boolean;
}) {
  const { status, feed, error } = usePunishments(src);

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
  const [param, setParam] = useUrlState("season", options, String(years[0] ?? ""));
  const active = Number(param) || null;
  const feedSeason = feed?.seasons.find((s) => s.season === active) ?? null;

  const rows = useMemo(
    () => buildLedger(feedSeason, seasons.find((s) => s.season === active)?.lows ?? []),
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
  const hasSelection = suggestions.some((s) => s.selected);
  const votes = suggestions.reduce((n, s) => n + s.votes, 0);

  if (status === "loading") {
    return (
      <Panel>
        <EmptyState>Loading punishments…</EmptyState>
      </Panel>
    );
  }

  if (status === "error") {
    return (
      <Panel>
        <EmptyState>
          Could not reach the punishment sheet ({error}). Everything else on the site is
          unaffected — this is the one page that reads it.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Punishments</h1>
          <p className="mt-1 max-w-2xl text-sm text-chalk-500">
            Score the fewest points in a regular-season week and you owe the league a
            punishment, drawn from a pool the whole league votes on.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMock ? <SampleBadge /> : null}
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

      {!feedSeason ? (
        <Panel>
          <EmptyState>Nothing recorded for {active}.</EmptyState>
        </Panel>
      ) : (
        <>
          {rows.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Assigned"
                value={`${totals.assigned}/${feedSeason.poolSize}`}
                sub={`${totals.weeks} weeks lost`}
              />
              <Stat label="Completed" value={totals.completed} tone="accent" />
              <Stat
                label="Outstanding"
                value={totals.outstanding}
                sub={totals.outstanding ? "still owed" : "all square"}
              />
              <Stat label="Pool left" value={pool.length} sub={`of ${feedSeason.poolSize}`} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Suggestions" value={suggestions.length} />
              <Stat label="Votes cast" value={votes} />
              <Stat
                label="Pool size"
                value={feedSeason.poolSize}
                sub={hasSelection ? "selected" : "not picked yet"}
              />
            </div>
          )}

          {rows.length ? (
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
              <PanelHeader title={`${active} Pool`} meta={`${feedSeason.poolSize} to select`} />
              <EmptyState>
                {hasSelection
                  ? "The pool is set. Nobody has lost a week yet."
                  : "Voting is open — the top " +
                    feedSeason.poolSize +
                    " suggestions become this season's pool."}
              </EmptyState>
            </Panel>
          )}

          {rows.length ? (
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
                      <li key={p.id} className="px-4 py-1.5 text-sm text-chalk-300 sm:px-5">
                        {p.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState>Every punishment has been handed out.</EmptyState>
                )}
              </Panel>

              <Panel>
                <PanelHeader title="Who owes what" meta={`${tally.length} owners`} />
                <ListHeader>
                  <Col className="flex-1">Owner</Col>
                  <Col className="w-12 shrink-0 text-right" hint="Weeks finishing lowest">
                    Lost
                  </Col>
                  <Col className="w-12 shrink-0 text-right">Done</Col>
                  <Col className="w-12 shrink-0 text-right" hint="Assigned but not yet served">
                    Owed
                  </Col>
                </ListHeader>
                <ul className="divide-y divide-ink-700">
                  {tally.map((t) => (
                    <li key={t.slug} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
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
                          t.outstanding ? "font-semibold text-loss" : "text-chalk-600"
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

          <Ballot
            suggestions={suggestions}
            names={names}
            poolSize={feedSeason.poolSize}
            // Open when it is the only thing on the page worth reading.
            open={!rows.length}
          />
        </>
      )}
    </div>
  );
}

/**
 * Every suggestion still in contention, with its votes.
 *
 * Collapsed once a season is under way: rows of settled voting are history at
 * that point, and the ledger above them is what anyone came for.
 *
 * Vetoed suggestions are already gone by the time they reach here — filtered at
 * the one place the feed is read, so this does not have to know the rule.
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

function Ballot({
  suggestions,
  names,
  poolSize,
  open,
}: {
  suggestions: Array<{
    id: number;
    text: string;
    suggestedBy: string | null;
    votes: number;
    selected: boolean;
  }>;
  names: Record<string, string>;
  poolSize: number;
  open: boolean;
}) {
  if (!suggestions.length) return null;
  // Votes descending, so the pool cut line is where you would look for it.
  const sorted = [...suggestions].sort((a, b) => b.votes - a.votes || a.id - b.id);

  return (
    <Panel>
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between border-b border-ink-600 px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5">
          <span className="flex items-baseline gap-3">
            <span className="eyebrow">The ballot</span>
            <span className="text-xs text-chalk-600 tabular">
              {suggestions.length} suggestions · top {poolSize} make the pool
            </span>
          </span>
          <span className="text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <ListHeader>
          <Col className={BALLOT.text}>Punishment</Col>
          <Col className={BALLOT.by}>Suggested by</Col>
          <Col className={BALLOT.votes}>Votes</Col>
          <Col className={BALLOT.status}>Status</Col>
        </ListHeader>
        <ul className="divide-y divide-ink-700">
          {sorted.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-1.5 sm:px-5">
              <span className={`truncate text-sm text-chalk-300 ${BALLOT.text}`} title={s.text}>
                {s.text}
              </span>
              <span className={`truncate text-xs text-chalk-500 ${BALLOT.by}`}>
                {s.suggestedBy ? (
                  <span data-owner={s.suggestedBy}>{names[s.suggestedBy] ?? s.suggestedBy}</span>
                ) : (
                  <span className="text-chalk-600">—</span>
                )}
              </span>
              <span className={`tabular text-sm text-chalk-300 ${BALLOT.votes}`}>{s.votes}</span>
              <span className={BALLOT.status}>
                {s.selected ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
                    In pool
                  </span>
                ) : (
                  <span className="text-[11px] text-chalk-600">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
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
