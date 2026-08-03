import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, Panel, PanelHeader, Stat, fmt } from "@/components/ui";
import { getMatchupHistory, getOwnerMap, getOwnerRecords, getOwners, getPlayers } from "@/lib/data";

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
  const records = getOwnerRecords();
  const h2h = records.find((r) => r.ownerSlug === a)?.vs[b];

  const games = getMatchupHistory()
    .filter(
      (m) =>
        [m.home.ownerSlug, m.away.ownerSlug].includes(a) &&
        [m.home.ownerSlug, m.away.ownerSlug].includes(b),
    )
    .sort((x, y) => y.season - x.season || y.week - x.week);

  const players = getPlayers();

  const aWins = games.filter((g) => g.winner === a).length;
  const bWins = games.filter((g) => g.winner === b).length;
  const ties = games.filter((g) => g.winner === null).length;
  const aPts = games.reduce(
    (t, g) => t + (g.home.ownerSlug === a ? g.home.points : g.away.points),
    0,
  );
  const bPts = games.reduce(
    (t, g) => t + (g.home.ownerSlug === b ? g.home.points : g.away.points),
    0,
  );

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
          label="Series"
          value={`${aWins}–${bWins}${ties ? `–${ties}` : ""}`}
          sub={aWins === bWins ? "Dead even" : `${name(aWins > bWins ? a : b)} leads`}
          tone="accent"
        />
        <Stat label="Meetings" value={games.length} />
        <Stat label={`${owners.get(a)?.firstName} pts`} value={fmt.pts1(aPts)} />
        <Stat label={`${owners.get(b)?.firstName} pts`} value={fmt.pts1(bPts)} />
      </div>

      {h2h ? (
        <Panel>
          <PanelHeader title="Regular Season Only" />
          <div className="px-4 py-3 text-sm text-chalk-300 sm:px-5">
            {name(a)} {fmt.record(h2h.wins, h2h.losses, h2h.ties)} · avg{" "}
            {fmt.pts1(h2h.pointsFor / Math.max(1, h2h.wins + h2h.losses + h2h.ties))} to{" "}
            {fmt.pts1(h2h.pointsAgainst / Math.max(1, h2h.wins + h2h.losses + h2h.ties))}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Every Meeting" meta={`${games.length} games`} />
        {games.length === 0 ? (
          <EmptyState>These two have never played.</EmptyState>
        ) : (
          <div className="divide-y divide-ink-700">
            {games.map((g) => {
              const sideA = g.home.ownerSlug === a ? g.home : g.away;
              const sideB = g.home.ownerSlug === b ? g.home : g.away;
              const topScorer = (side: typeof sideA) => {
                const starters = new Set(side.starters);
                const entries = Object.entries(side.playerPoints).filter(([pid]) =>
                  starters.has(pid),
                );
                if (!entries.length) return null;
                return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
              };
              const ta = topScorer(sideA);
              const tb = topScorer(sideB);

              return (
                <details key={`${g.season}-${g.week}`} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-700/40 sm:px-5">
                    <span className="tabular w-20 shrink-0 text-[11px] text-chalk-600">
                      {g.season} wk{g.week}
                    </span>
                    <div className="min-w-0 flex-1">
                      {[sideA, sideB].map((s) => (
                        <div
                          key={s.ownerSlug}
                          className={`flex items-center justify-between gap-2 text-sm ${
                            g.winner === s.ownerSlug
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
                        {g.kind}
                      </span>
                    ) : null}
                    <span className="w-3 shrink-0 text-[10px] text-chalk-600 transition-transform group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
                    {[
                      [sideA, ta],
                      [sideB, tb],
                    ].map(([side, top]) => {
                      const s = side as typeof sideA;
                      const t = top as [string, number] | null;
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
