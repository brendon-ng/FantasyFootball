import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftPicks } from "@/components/draft-picks";
import { FinishChart } from "@/components/finish-chart";
import { OwnerContracts } from "@/components/owner-contracts";
import { TrophyCase } from "@/components/trophy-case";
import { Col, ListHeader, Panel, PanelHeader, Stat, fmt, placeColor } from "@/components/ui";
import {
  features,
  getAdp,
  getConfig,
  getKeepers,
  getOwnerMap,
  getOwnerRecords,
  getOwners,
  getPlayers,
  getSeasons,
} from "@/lib/data";

export const dynamicParams = false;
export function generateStaticParams() {
  return getOwners().map((o) => ({ slug: o.slug }));
}

export default async function OwnerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const owners = getOwnerMap();
  const owner = owners.get(slug);
  if (!owner) notFound();

  const record = getOwnerRecords().find((r) => r.ownerSlug === slug);
  const seasons = getSeasons().filter((s) => s.finalized).sort((a, b) => b.season - a.season);
  const players = getPlayers();
  const adp = getAdp();
  const cfg = getConfig();
  const upcoming = Math.max(...getSeasons().map((x) => x.season), 0) + 1;
  const upcomingLeagueId = cfg.knownLeagueIds[String(upcoming)] ?? null;
  const contracts = getKeepers().final.filter((c) => c.ownerSlug === slug);
  const name = (s: string | null | undefined) => (s && owners.get(s)?.name) || "—";

  // Placement history needs each season's team count: 10th of 12 and 10th of 10
  // are very different results, and the chart has to say which.
  const teamsBySeason = new Map(getSeasons().map((x) => [x.season, x.teams]));
  const finishPoints = (record?.finishes ?? [])
    .slice()
    .sort((a, b) => a.season - b.season)
    .map((f) => ({
      season: f.season,
      place: f.place,
      teams: teamsBySeason.get(f.season) ?? 10,
    }));

  const honours = (record?.finishes ?? [])
    .filter((f) => f.place != null && f.place <= 3)
    .map((f) => ({ season: f.season, place: f.place as number }));
  const lastPlaceSeasons = (record?.finishes ?? [])
    .filter((f) => f.place != null && f.place === (teamsBySeason.get(f.season) ?? 10))
    .map((f) => f.season);

  // Sort opponents by how well this owner does against them.
  const vs = Object.entries(record?.vs ?? {}).sort(([, a], [, b]) => {
    const pa = a.wins / Math.max(1, a.wins + a.losses + a.ties);
    const pb = b.wins / Math.max(1, b.wins + b.losses + b.ties);
    return pb - pa;
  });

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <Link href="/history/" className="text-xs text-chalk-600 hover:text-accent">
          ← History
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{owner.name}</h1>
          {!owner.active ? (
            <span
              className="rounded-full border border-ink-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chalk-500"
              title="No longer in the league; kept for the historical record"
            >
              Former owner
            </span>
          ) : null}
        </div>
        {owner.coOwnedWith.length ? (
          <p className="mt-1 text-sm text-chalk-500">
            Co-owned with{" "}
            {owner.coOwnedWith.map((c, i) => (
              <span key={c}>
                {i > 0 ? ", " : ""}
                <Link href={`/owners/${c}/`} className="hover:text-accent">
                  {name(c)}
                </Link>
              </span>
            ))}
            . Their record is credited to both.
          </p>
        ) : null}
      </div>

      {record ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            <Stat
              label="All-time"
              value={fmt.record(record.wins, record.losses, record.ties)}
              sub={fmt.pct(record.winPct)}
            />
            <Stat label="Titles" value={record.championships} tone="gold" />
            <Stat
              label="Avg finish"
              value={record.averageFinish?.toFixed(1) ?? "—"}
              sub={`best ${record.bestFinish ?? "—"} · worst ${record.worstFinish ?? "—"}`}
            />
            <Stat
              label="Playoffs"
              value={`${record.playoffAppearances}/${record.seasonsPlayed}`}
            />
            <Stat
              label="Points for"
              value={fmt.pts1(record.pointsFor)}
              // Per-game is the comparable figure: seasons have run 13 and 14
              // weeks, and co-owners share a total across differing tenures.
              sub={`${fmt.pts1(record.pointsForPerGame)} per game`}
            />
            <Stat label="Last places" value={record.lastPlaces} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Trophy Case"
                meta={`${record.championships} title${record.championships === 1 ? "" : "s"}`}
              />
              <TrophyCase honours={honours} lastPlaces={lastPlaceSeasons} />
            </Panel>

            <Panel>
              <PanelHeader
                title="Finish by Season"
                meta={`${finishPoints.length} season${finishPoints.length === 1 ? "" : "s"}`}
              />
              <div className="px-4 pb-3 pt-2 sm:px-5">
                <FinishChart points={finishPoints} />
              </div>
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Season by Season" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-600">
                    {(
                      [
                        ["Season", ""],
                        ["Seed", "Playoff seed, by wins then points for"],
                        ["Record", "Regular-season wins-losses-ties"],
                        ["PF", "Points For — total points scored that season"],
                        ["Finish", "Final placement after playoffs"],
                      ] as const
                    ).map(([h, hint], i) => (
                      <th
                        key={h}
                        title={hint || undefined}
                        className={`eyebrow px-3 py-2 ${i === 0 ? "text-left" : "text-right"} ${hint ? "cursor-help" : ""}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasons.map((s) => {
                    const row = s.standings.find((r) => r.ownerSlug === slug);
                    if (!row) return null;
                    return (
                      <tr key={s.season} className="border-b border-ink-700 last:border-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/history/${s.season}/`}
                            className="tabular font-medium transition-colors hover:text-accent"
                          >
                            {s.season}
                          </Link>
                        </td>
                        <td className="tabular px-3 py-2 text-right text-chalk-500">{row.seed}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-right text-chalk-300">
                          {fmt.record(row.wins, row.losses, row.ties)}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-chalk-500">
                          {fmt.pts1(row.pointsFor)}
                        </td>
                        <td
                          className={`tabular px-3 py-2 text-right font-bold ${placeColor(row.finalPlace)}`}
                        >
                          {row.finalPlace ? fmt.ordinal(row.finalPlace) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            <Panel>
              <PanelHeader
                title="Head to Head"
                meta="all matchups · best first"
                legend="Every matchup, regular season and postseason combined. A ✻ marks a head-to-head record that includes playoff or toilet-bowl matchups. Regular-season data starts in 2024 — the imported ESPN seasons kept no weekly matchups — so a pre-2024 opponent's record is postseason only."
              />
              <ListHeader>
                <Col className="flex-1">Opponent</Col>
                <Col className="hidden w-20 shrink-0 text-center sm:block" hint="Share of meetings won">
                  Win share
                </Col>
                <Col
                  className="w-[74px] shrink-0 text-right"
                  hint="Wins-losses against this opponent, all meetings. ✻ marks a record that includes postseason games."
                >
                  W-L
                </Col>
                <Col
                  className="hidden w-16 shrink-0 text-right sm:block"
                  hint="Points For — total scored against this opponent"
                >
                  PF
                </Col>
              </ListHeader>
              <ul className="divide-y divide-ink-700">
                {vs.map(([opp, h]) => {
                  const games = h.wins + h.losses + h.ties;
                  const pct = games ? h.wins / games : 0;
                  return (
                    <li key={opp} className="flex items-center gap-3 px-4 py-2.5">
                      <Link
                        href={`/h2h/${[slug, opp].sort().join("-vs-")}/`}
                        className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                      >
                        {name(opp)}
                      </Link>
                      {/* Bar makes the split scannable without reading digits. */}
                      <span className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-loss/30 sm:block">
                        <span
                          className="block h-full rounded-full bg-win"
                          style={{ width: `${pct * 100}%` }}
                        />
                      </span>
                      {/* Marker sits LEFT of the value in its own fixed slot,
                          so the numbers stay in a straight column whether or
                          not a row carries one. */}
                      <span
                        className="flex shrink-0 items-baseline gap-1"
                        title={
                          h.playoff.wins + h.playoff.losses + h.playoff.ties
                            ? `${fmt.record(h.playoff.wins, h.playoff.losses, h.playoff.ties)} of these were postseason meetings`
                            : "No postseason meetings"
                        }
                      >
                        <span className="w-2 text-right text-[10px] text-chalk-600" aria-hidden>
                          {h.playoff.wins + h.playoff.losses + h.playoff.ties ? "✻" : ""}
                        </span>
                        <span className="tabular w-16 whitespace-nowrap text-right text-sm text-chalk-300">
                          {fmt.record(h.wins, h.losses, h.ties)}
                        </span>
                      </span>
                      <span className="tabular hidden w-16 shrink-0 text-right text-[11px] text-chalk-600 sm:block">
                        {fmt.pts1(h.pointsFor)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}

      {features().keepers ? (
        <Panel>
          <PanelHeader
            title="Keeper Contracts"
            meta={`${contracts.filter((c) => !c.expired).length} eligible`}
            href="/keepers/"
            hrefLabel="Full tracker"
            legend={
              <>
                Columns: <span className="text-chalk-400">position</span> ·{" "}
                <span className="text-chalk-400">player</span> ·{" "}
                <span className="text-chalk-400">ADP and value vs market</span> ·{" "}
                <span className="text-chalk-400">keeps left</span> ·{" "}
                <span className="text-chalk-400">round it costs to keep</span>
              </>
            }
          />
          <OwnerContracts
            ownerSlug={slug}
            contracts={contracts}
            players={players}
            adp={Object.fromEntries(adp.byPlayer)}
            userIdToSlug={Object.fromEntries(
              getOwners().filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
            )}
            leagueId={upcomingLeagueId}
            maxKeepers={4}
          />
        </Panel>
      ) : null}

      <DraftPicks
        ownerSlug={slug}
        leagueId={upcomingLeagueId}
        season={upcoming}
        draftRounds={17}
        maxKeepers={4}
        contracts={contracts}
        players={players}
        userIdToSlug={Object.fromEntries(
          getOwners().filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
        )}
        ownerNames={Object.fromEntries(getOwners().map((o) => [o.slug, o.name]))}
      />
    </div>
  );
}
