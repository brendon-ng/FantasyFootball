import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Col,
  EmptyState,
  ListHeader,
  Panel,
  PanelHeader,
  Stat,
  fmt,
  verboseKind,
} from "@/components/ui";
import {
  getMeetings,
  getOwnerMap,
  getOwners,
  weeklyCoverage,
} from "@/lib/data";

export const dynamicParams = false;

/**
 * Every unordered owner pairing gets a page. The slug is the two slugs sorted
 * and joined with "-vs-", so both directions resolve to the same URL and the
 * page count stays at C(n,2) rather than n².
 */
export function generateStaticParams() {
  const slugs = getOwners().map((o) => o.slug);
  const pairs: Array<{ pair: string }> = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      pairs.push({ pair: [slugs[i], slugs[j]].sort().join("-vs-") });
    }
  }
  return pairs;
}

const coverage = weeklyCoverage();

export default async function H2HPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  const [a, b] = pair.split("-vs-");
  const owners = getOwnerMap();
  if (!a || !b || !owners.has(a) || !owners.has(b)) notFound();

  const name = (s: string) => owners.get(s)?.name ?? s;


  // Both eras. Sleeper weeks plus playoff games recovered from imported ESPN
  // seasons — reading only the weekly matchups under-reports the series.
  const games = getMeetings(a, b);

  const tally = (subset: typeof games) => {
    let w = 0, l = 0, t = 0, pf = 0, pa = 0;
    for (const g of subset) {
      pf += g.a.points;
      pa += g.b.points;
      if (g.a.points === g.b.points) t++;
      else if (g.a.points > g.b.points) w++;
      else l++;
    }
    return { w, l, t, pf: Number(pf.toFixed(2)), pa: Number(pa.toFixed(2)), n: subset.length };
  };

  const overall = tally(games);
  const regular = tally(games.filter((g) => g.kind === "regular"));
  const post = tally(games.filter((g) => g.kind !== "regular"));

  /**
   * The run of wins the series is currently on, and the longest it has ever been.
   *
   * `getMeetings` returns newest first, so the current streak walks forward from
   * the top. A TIE ENDS A STREAK rather than extending it — nobody won, so nobody
   * can still be winning. Postseason games count: they are meetings between these
   * two like any other, and a playoff loss very much ends a run.
   */
  const winnerOf = (g: (typeof games)[number]) =>
    g.a.points === g.b.points ? null : g.a.points > g.b.points ? a : b;

  let streakSlug: string | null = null;
  let streak = 0;
  for (const g of games) {
    const w = winnerOf(g);
    if (!w) break;
    if (streakSlug === null) streakSlug = w;
    else if (w !== streakSlug) break;
    streak += 1;
  }

  let bestSlug: string | null = null;
  let best = 0;
  let runSlug: string | null = null;
  let run = 0;
  for (const g of games) {
    const w = winnerOf(g);
    if (!w) {
      runSlug = null;
      run = 0;
      continue;
    }
    run = w === runSlug ? run + 1 : 1;
    runSlug = w;
    if (run > best) {
      best = run;
      bestSlug = w;
    }
  }

  const rec = (x: { w: number; l: number; t: number }) =>
    x.t ? `${x.w}-${x.l}-${x.t}` : `${x.w}-${x.l}`;
  const avg = (total: number, n: number) => (n ? (total / n).toFixed(1) : "—");

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <Link href="/history/" className="text-xs text-chalk-600 hover:text-accent">
          ← History
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          <Link href={`/owners/${a}/`} className="hover:text-accent">
            {name(a)}
          </Link>
          <span className="mx-2 text-chalk-600">vs</span>
          <Link href={`/owners/${b}/`} className="hover:text-accent">
            {name(b)}
          </Link>
        </h1>
        <p className="mt-1 text-sm text-chalk-500">
          Every matchup between these two, including playoffs and the toilet bowl.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat
          label="All-time series"
          value={rec(overall)}
          sub={
            overall.w === overall.l
              ? "Dead even"
              : `${owners.get(overall.w > overall.l ? a : b)?.firstName} leads`
          }
          tone="accent"
        />
        <Stat label="Matchups" value={overall.n} sub="regular season + postseason" />
        <Stat
          label="Current streak"
          value={
            streak ? (
              <span className="text-base sm:text-lg">
                {owners.get(streakSlug!)?.firstName} <span className="tabular">W{streak}</span>
              </span>
            ) : (
              "—"
            )
          }
          sub={
            streak
              ? `since ${games[streak - 1].season} week ${games[streak - 1].week}`
              : games.length
                ? "last meeting was a tie"
                : undefined
          }
          tone={streak ? "accent" : undefined}
        />
        <Stat
          label="Longest streak"
          value={
            best ? (
              <span className="text-base sm:text-lg">
                {owners.get(bestSlug!)?.firstName} <span className="tabular">W{best}</span>
              </span>
            ) : (
              "—"
            )
          }
        />
        <Stat
          label={`${owners.get(a)?.firstName} pts`}
          value={fmt.pts1(overall.pf)}
          sub={`${avg(overall.pf, overall.n)} per game`}
        />
        <Stat
          label={`${owners.get(b)?.firstName} pts`}
          value={fmt.pts1(overall.pa)}
          sub={`${avg(overall.pa, overall.n)} per game`}
        />
      </div>

      <Panel>
        <PanelHeader
          title="Record Splits"
          meta={`from ${name(a)}'s perspective`}
          legend={
            coverage.missing.length
              ? `Week-by-week scores exist for ${coverage.label}. For ${coverage.missingLabel} only the postseason survived, so ${coverage.missing.length === 1 ? "that year contributes" : "those years contribute"} playoff and ladder matchups only.`
              : undefined
          }
        />
        {/* Fixed-width numeric columns plus a label that will not wrap short
            enough to fit a phone — scroll instead of clipping "Avg PA". */}
        <div className="overflow-x-auto">
        <div className="max-sm:min-w-[30rem]">
        <ListHeader>
          <Col className="flex-1">Split</Col>
          <Col className="w-16 shrink-0 text-right" hint="Wins-losses in this split">
            Record
          </Col>
          <Col className="w-12 shrink-0 text-right" hint="Games played in this split">
            GP
          </Col>
          <Col className="w-20 shrink-0 text-right" hint="Average points scored per game">
            Avg PF
          </Col>
          <Col className="w-20 shrink-0 text-right" hint="Average points allowed per game">
            Avg PA
          </Col>
        </ListHeader>
        {(
          [
            ["Regular season", regular],
            ["Playoffs & consolation", post],
            ["Overall", overall],
          ] as const
        ).map(([label, s], i) => (
          <div
            key={label}
            className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${
              i === 2 ? "border-t border-ink-600 bg-ink-850/50" : "border-b border-ink-700"
            }`}
          >
            <span className={`flex-1 text-sm ${i === 2 ? "font-semibold" : "text-chalk-300"}`}>
              {label}
            </span>
            <span
              className={`tabular w-16 shrink-0 text-right text-sm ${
                i === 2 ? "font-bold text-accent" : "text-chalk-100"
              }`}
            >
              {s.n ? rec(s) : "—"}
            </span>
            <span className="tabular w-12 shrink-0 text-right text-sm text-chalk-500">{s.n}</span>
            <span className="tabular w-20 shrink-0 text-right text-sm text-chalk-500">
              {avg(s.pf, s.n)}
            </span>
            <span className="tabular w-20 shrink-0 text-right text-sm text-chalk-500">
              {avg(s.pa, s.n)}
            </span>
          </div>
        ))}
        </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Every Matchup"
          meta={`${games.length} matchups`}
          legend="Open a matchup for lineups and per-player scores."
        />
        {games.length === 0 ? (
          <EmptyState>These two have never played.</EmptyState>
        ) : (
          <div className="divide-y divide-ink-700">
            {games.map((g) => {
              const winner =
                g.a.points === g.b.points ? null : g.a.points > g.b.points ? g.a : g.b;
              return (
                <Link
                  key={g.id}
                  href={`/matchups/${g.id}/`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5"
                >
                  {/* Below sm the postseason chip column is hidden, so the label
                      rides under the date instead. sm:hidden keeps it from
                      double-labelling once that column reappears. */}
                  <span className="w-24 shrink-0 text-[11px] text-chalk-600">
                    <span className="tabular">
                      {g.season}
                      {g.week ? ` wk${g.week}` : ""}
                    </span>
                    {g.kind !== "regular" ? (
                      <span className="mt-0.5 block truncate text-[9px] uppercase tracking-wide text-chalk-500 sm:hidden">
                        {verboseKind(g.label ?? g.kind)}
                      </span>
                    ) : null}
                  </span>
                  {/* Names, badge and scores are separate columns so the badge
                      sits LEFT of the numbers and the numbers stay aligned
                      whether or not a row carries one. */}
                  <div className="min-w-0 flex-1">
                    {[g.a, g.b].map((s) => (
                      <div
                        key={s.ownerSlug}
                        className={`truncate text-sm ${
                          winner?.ownerSlug === s.ownerSlug
                            ? "font-semibold text-chalk-100"
                            : "text-chalk-500"
                        }`}
                      >
                        <span data-owner={s.ownerSlug}>{name(s.ownerSlug)}</span>
                      </div>
                    ))}
                  </div>
                  <span className="hidden w-[92px] shrink-0 text-right sm:block">
                    {g.kind !== "regular" ? (
                      <span className="rounded border border-ink-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-chalk-500">
                        {g.label ?? g.kind}
                      </span>
                    ) : null}
                  </span>
                  <div className="w-20 shrink-0 text-right">
                    {[g.a, g.b].map((s) => (
                      <div
                        key={s.ownerSlug}
                        className={`tabular text-sm ${
                          winner?.ownerSlug === s.ownerSlug
                            ? "font-semibold text-chalk-100"
                            : "text-chalk-500"
                        }`}
                      >
                        {fmt.pts(s.points)}
                      </div>
                    ))}
                  </div>
                  <span aria-hidden className="shrink-0 text-[10px] text-chalk-600">
                    →
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
