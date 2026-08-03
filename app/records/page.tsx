import Link from "next/link";

import { Panel, PanelHeader, fmt } from "@/components/ui";
import {
  getAllMeetings,
  getMatchupHistory,
  getOwnerMap,
  getPlayers,
  getRecords,
  meetingId,
} from "@/lib/data";
import type { CombinedRecord, ScoreRecord } from "@/lib/types";

export const metadata = { title: "Records · Den Ops" };

export default function RecordsPage() {
  const records = getRecords();
  const owners = getOwnerMap();
  const players = getPlayers();
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  /**
   * Deep-link into the head-to-head page's matching meeting.
   *
   * The pair slug is sorted so both directions resolve to the same page, and
   * the fragment targets the anchor that page puts on every meeting.
   */
  const meetingHref = (a: string, b: string | null, season: number, week: number) =>
    b ? `/matchups/${meetingId(season, week, a, b)}/` : null;

  /**
   * Postseason label for a matchup, so the record book reads the same as the
   * head-to-head page: Championship, 3rd place, toilet bowl rather than a bare
   * week number.
   */
  const kindByMeeting = new Map(
    getAllMeetings().map((m) => [
      m.id,
      m.kind === "regular" ? null : (m.label ?? (m.kind === "consolation" ? "toilet bowl" : m.kind)),
    ]),
  );
  const kindOf = (a: string, b: string | null, season: number, week: number) =>
    b ? (kindByMeeting.get(meetingId(season, week, a, b)) ?? null) : null;

  // Player records store no opponent, so recover it from the matchup that week.
  const opponentOf = new Map<string, string>();
  for (const m of getMatchupHistory()) {
    opponentOf.set(`${m.season}:${m.week}:${m.home.ownerSlug}`, m.away.ownerSlug);
    opponentOf.set(`${m.season}:${m.week}:${m.away.ownerSlug}`, m.home.ownerSlug);
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Record Book</h1>
        <p className="mt-1 text-sm text-chalk-500">
          Extremes across every finalized matchup on record.{" "}
          <span className="text-chalk-600">
            Weekly scores are complete from 2024. For 2020–2023 only ESPN playoff and ladder
            matchups survived, so those seasons are represented but under-counted — and player
            records are 2024 onward, since ESPN kept no lineups.
          </span>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ScoreList
          title="Highest Weekly Scores"
          rows={records.weeklyHigh}
          name={name}
          tone="text-accent"
          meetingHref={meetingHref}
          kindOf={kindOf}
        />
        <ScoreList
          title="Lowest Weekly Scores"
          rows={records.weeklyLow}
          name={name}
          tone="text-loss"
          meetingHref={meetingHref}
          kindOf={kindOf}
        />

        <Panel>
          <PanelHeader
            title="Best Player Weeks"
            meta="started only"
            legend="Highest single-week scores by a started player. Bench performances are excluded, and this list is 2024 onward — the imported ESPN seasons kept no lineups."
          />
          <ol className="divide-y divide-ink-700">
            {records.playerHigh.slice(0, 20).map((r, i) => {
              const opp = opponentOf.get(`${r.season}:${r.week}:${r.ownerSlug}`) ?? null;
              const href = meetingHref(r.ownerSlug, opp, r.season, r.week);
              return (
                <li
                  key={`${r.season}-${r.week}-${r.playerId}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/players/${r.playerId}/`}
                      className="block truncate text-sm font-medium transition-colors hover:text-accent"
                    >
                      {players[r.playerId]?.full_name ?? r.playerId}
                    </Link>
                    {/* Two destinations in one row, so each is its own link
                        rather than nesting anchors, which is invalid HTML. */}
                    {href ? (
                      <Link
                        href={href}
                        className="block truncate text-[11px] text-chalk-600 transition-colors hover:text-accent"
                      >
                        <span data-owner={r.ownerSlug}>{name(r.ownerSlug)}</span> · {r.season} wk
                        {r.week}
                        {opp ? (
                          <>
                            {" vs "}
                            <span data-owner={opp}>{name(opp)}</span>
                          </>
                        ) : null}{" "}
                        <span aria-hidden>→</span>
                      </Link>
                    ) : (
                      <div className="truncate text-[11px] text-chalk-600">
                        {name(r.ownerSlug)} · {r.season} wk{r.week}
                      </div>
                    )}
                  </div>
                  <KindChip kind={kindOf(r.ownerSlug, opp, r.season, r.week)} />
                  <span className="tabular shrink-0 text-sm font-bold text-accent">
                    {fmt.pts(r.points)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>

        <CombinedList
          title="Highest Scoring Matchups"
          rows={records.highestCombined}
          name={name}
          tone="text-accent"
          meetingHref={meetingHref}
          kindOf={kindOf}
        />
        <CombinedList
          title="Lowest Scoring Matchups"
          rows={records.lowestCombined}
          name={name}
          tone="text-loss"
          meetingHref={meetingHref}
          kindOf={kindOf}
        />

        <div className="space-y-5">
          <MarginList
            title="Biggest Blowouts"
            rows={records.biggestBlowout}
            name={name}
            meetingHref={meetingHref}
            kindOf={kindOf}
          />
          <MarginList
            title="Narrowest Wins"
            rows={records.narrowestWin}
            name={name}
            meetingHref={meetingHref}
            kindOf={kindOf}
          />
        </div>
      </div>
    </div>
  );
}

type MeetingHref = (a: string, b: string | null, season: number, week: number) => string | null;
type KindOf = (a: string, b: string | null, season: number, week: number) => string | null;

/**
 * Postseason chip in a fixed slot, always rendered so the numbers beside it
 * stay in column whether or not a row carries one.
 */
function KindChip({ kind }: { kind: string | null }) {
  return (
    <span className="hidden w-[86px] shrink-0 text-right sm:block">
      {kind ? (
        <span className="rounded border border-ink-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-chalk-500">
          {kind}
        </span>
      ) : null}
    </span>
  );
}

function ScoreList({
  title,
  rows,
  name,
  tone,
  meetingHref,
  kindOf,
}: {
  title: string;
  rows: ScoreRecord[];
  name: (s: string | null | undefined) => string;
  tone: string;
  meetingHref: MeetingHref;
  kindOf: KindOf;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        meta={`top ${Math.min(rows.length, 20)}`}
        legend="Rank · owner · season, week and opponent (their score in brackets) · points scored"
      />
      <ol className="divide-y divide-ink-700">
        {rows.slice(0, 20).map((r, i) => {
          const href = meetingHref(r.ownerSlug, r.opponentSlug, r.season, r.week);
          const body = (
            <>
              <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <span data-owner={r.ownerSlug} className="block truncate text-sm font-medium">
                  {name(r.ownerSlug)}
                </span>
                <div className="truncate text-[11px] text-chalk-600">
                  {r.season} wk{r.week} vs{" "}
                  <span data-owner={r.opponentSlug ?? undefined}>{name(r.opponentSlug)}</span>
                  {r.opponentPoints != null ? ` (${fmt.pts1(r.opponentPoints)})` : ""}
                </div>
              </div>
              <KindChip kind={kindOf(r.ownerSlug, r.opponentSlug, r.season, r.week)} />
              <span className={`tabular shrink-0 text-sm font-bold ${tone}`}>
                {fmt.pts(r.points)}
              </span>
            </>
          );
          return (
            <li key={`${r.season}-${r.week}-${r.ownerSlug}`}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40"
                >
                  {body}
                  <span aria-hidden className="shrink-0 text-[10px] text-chalk-600">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  {body}
                  <span className="w-3 shrink-0" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/**
 * Matchups ranked by both scores added together — a whole-matchup list, so one
 * row per matchup rather than one per team.
 */
function CombinedList({
  title,
  rows,
  name,
  tone,
  meetingHref,
  kindOf,
}: {
  title: string;
  rows: CombinedRecord[];
  name: (s: string | null | undefined) => string;
  tone: string;
  meetingHref: MeetingHref;
  kindOf: KindOf;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        meta={`top ${Math.min(rows.length, 20)}`}
        legend="Both teams' scores added together. Rank · the matchup · combined total."
      />
      <ol className="divide-y divide-ink-700">
        {rows.slice(0, 20).map((r, i) => {
          const href = meetingHref(r.ownerSlug, r.opponentSlug, r.season, r.week);
          const body = (
            <>
              <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  <span data-owner={r.ownerSlug}>{name(r.ownerSlug)}</span>{" "}
                  <span className="text-chalk-600">vs</span>{" "}
                  <span data-owner={r.opponentSlug}>{name(r.opponentSlug)}</span>
                </div>
                <div className="truncate text-[11px] text-chalk-600">
                  {r.season} wk{r.week} · {fmt.pts1(r.points)}–{fmt.pts1(r.opponentPoints)}
                </div>
              </div>
              <KindChip kind={kindOf(r.ownerSlug, r.opponentSlug, r.season, r.week)} />
              <span className={`tabular shrink-0 text-sm font-bold ${tone}`}>
                {fmt.pts(r.total)}
              </span>
            </>
          );
          return (
            <li key={`${r.season}-${r.week}-${r.ownerSlug}`}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40"
                >
                  {body}
                  <span aria-hidden className="shrink-0 text-[10px] text-chalk-600">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function MarginList({
  title,
  rows,
  name,
  meetingHref,
  kindOf,
}: {
  title: string;
  rows: Array<ScoreRecord & { margin: number }>;
  name: (s: string | null | undefined) => string;
  meetingHref: MeetingHref;
  kindOf: KindOf;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        legend="Winner def. loser · season, week and final score · margin of victory"
      />
      <ol className="divide-y divide-ink-700">
        {rows.slice(0, 8).map((r, i) => {
          const href = meetingHref(r.ownerSlug, r.opponentSlug, r.season, r.week);
          const body = (
            <>
              <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  <span data-owner={r.ownerSlug}>{name(r.ownerSlug)}</span>{" "}
                  <span className="text-chalk-600">def.</span>{" "}
                  <span data-owner={r.opponentSlug ?? undefined}>{name(r.opponentSlug)}</span>
                </div>
                <div className="text-[11px] text-chalk-600">
                  {r.season} wk{r.week} · {fmt.pts1(r.points)}–{fmt.pts1(r.opponentPoints ?? 0)}
                </div>
              </div>
              <KindChip kind={kindOf(r.ownerSlug, r.opponentSlug, r.season, r.week)} />
              <span className="tabular shrink-0 text-sm font-bold text-chalk-300">
                +{fmt.pts(r.margin)}
              </span>
            </>
          );
          return (
            <li key={`${r.season}-${r.week}-${r.ownerSlug}`}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40"
                >
                  {body}
                  <span aria-hidden className="shrink-0 text-[10px] text-chalk-600">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
