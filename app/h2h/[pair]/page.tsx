import Link from "next/link";
import { notFound } from "next/navigation";

import { Col, EmptyState, ListHeader, Panel, PanelHeader, Stat, fmt } from "@/components/ui";
import { getMeetings, getOwnerMap, getOwners, getPlayers } from "@/lib/data";

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

export default async function H2HPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  const [a, b] = pair.split("-vs-");
  const owners = getOwnerMap();
  if (!a || !b || !owners.has(a) || !owners.has(b)) notFound();

  const name = (s: string) => owners.get(s)?.name ?? s;


  // Both eras. Sleeper weeks plus playoff games recovered from imported ESPN
  // seasons — reading only the weekly matchups under-reports the series.
  const games = getMeetings(a, b);
  const players = getPlayers();

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
          All meetings, including playoffs and consolation games.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
        <Stat label="Meetings" value={overall.n} sub="regular season + postseason" />
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
          legend="Regular-season games exist only for 2024 onward; imported ESPN seasons kept no weekly matchups, but their playoff games are counted."
        />
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
      </Panel>

      <Panel>
        <PanelHeader title="Every Meeting" meta={`${games.length} games`} />
        {games.length === 0 ? (
          <EmptyState>These two have never played.</EmptyState>
        ) : (
          <div className="divide-y divide-ink-700">
            {games.map((g) => {
              const top = (side: typeof g.a) => {
                const starters = new Set(side.starters);
                const entries = Object.entries(side.playerPoints).filter(([pid]) =>
                  starters.has(pid),
                );
                if (!entries.length) return null;
                return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
              };
              const winner =
                g.a.points === g.b.points ? null : g.a.points > g.b.points ? g.a : g.b;

              const row = (
                <>
                  <span className="tabular w-24 shrink-0 text-[11px] text-chalk-600">
                    {g.season}
                    {g.week ? ` wk${g.week}` : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    {[g.a, g.b].map((s) => (
                      <div
                        key={s.ownerSlug}
                        className={`flex items-center justify-between gap-2 text-sm ${
                          winner?.ownerSlug === s.ownerSlug
                            ? "font-semibold text-chalk-100"
                            : "text-chalk-500"
                        }`}
                      >
                        <span className="truncate">{name(s.ownerSlug)}</span>
                        <span className="tabular">{fmt.pts(s.points)}</span>
                      </div>
                    ))}
                  </div>
                  {g.kind !== "regular" ? (
                    <span className="shrink-0 rounded border border-ink-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-chalk-500">
                      {g.label ?? g.kind}
                    </span>
                  ) : null}
                </>
              );

              // Imported ESPN games have scores but no lineups, so there is
              // nothing to expand into — render them as a plain row instead of
              // a disclosure that opens onto an empty panel.
              if (!g.hasLineups) {
                return (
                  <div
                    key={`${g.season}-${g.week}-${g.label ?? ""}`}
                    className="flex items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    {row}
                    <span className="w-3 shrink-0" />
                  </div>
                );
              }

              return (
                <details key={`${g.season}-${g.week}`} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5">
                    {row}
                    <span className="w-3 shrink-0 text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
                    {[g.a, g.b].map((s) => {
                      const t = top(s);
                      return (
                        <div key={s.ownerSlug} className="bg-ink-850 px-4 py-3">
                          <div className="eyebrow mb-2">{name(s.ownerSlug)}</div>
                          {t ? (
                            <div className="mb-2 text-[11px] text-chalk-500">
                              Top starter:{" "}
                              <Link
                                href={`/players/${t[0]}/`}
                                className="text-chalk-300 hover:text-accent"
                              >
                                {players[t[0]]?.full_name ?? t[0]}
                              </Link>{" "}
                              <span className="tabular text-accent">{fmt.pts(t[1])}</span>
                            </div>
                          ) : null}
                          <ol className="space-y-0.5">
                            {s.starters.map((pid) => (
                              <li
                                key={pid}
                                className="flex items-center justify-between gap-2 text-[12px]"
                              >
                                <Link
                                  href={`/players/${pid}/`}
                                  className="min-w-0 truncate text-chalk-400 transition-colors hover:text-accent"
                                >
                                  {players[pid]?.full_name ?? pid}
                                </Link>
                                <span className="tabular shrink-0 text-chalk-500">
                                  {fmt.pts(s.playerPoints[pid] ?? 0)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
