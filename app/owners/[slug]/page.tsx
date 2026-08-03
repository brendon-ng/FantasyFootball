import Link from "next/link";
import { notFound } from "next/navigation";

import { KeepPips, PositionPill } from "@/components/keeper-table";
import { Panel, PanelHeader, Stat, fmt, placeColor } from "@/components/ui";
import {
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
  const contracts = getKeepers().final.filter((c) => c.ownerSlug === slug);
  const name = (s: string | null | undefined) => (s && owners.get(s)?.name) || "—";

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
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{owner.name}</h1>
        {owner.coOwners.length ? (
          <p className="mt-1 text-sm text-chalk-500">Co-owned with {owner.coOwners.join(", ")}</p>
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
            <Stat label="Points for" value={fmt.pts1(record.pointsFor)} />
            <Stat label="Last places" value={record.lastPlaces} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Season by Season" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-600">
                    {["Season", "Seed", "Record", "PF", "Finish"].map((h, i) => (
                      <th
                        key={h}
                        className={`eyebrow px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}
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
                        <td className="tabular px-3 py-2 text-right text-chalk-300">
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
              <PanelHeader title="Head to Head" meta="regular season · best first" />
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
                      <span className="tabular w-14 shrink-0 text-right text-sm text-chalk-300">
                        {fmt.record(h.wins, h.losses, h.ties)}
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

      <Panel>
        <PanelHeader
          title="Keeper Contracts"
          meta={`${contracts.filter((c) => !c.expired).length} eligible`}
          href="/keepers/"
          hrefLabel="Full tracker"
        />
        <div className="grid gap-px bg-ink-600 sm:grid-cols-2">
          {contracts
            .slice()
            .sort((a, b) => Number(a.expired) - Number(b.expired) || a.round - b.round)
            .map((c) => (
              <div
                key={c.playerId}
                className={`flex items-center gap-2.5 bg-ink-800 px-3 py-2 ${c.expired ? "opacity-50" : ""}`}
              >
                <PositionPill position={players[c.playerId]?.position ?? null} />
                <Link
                  href={`/players/${c.playerId}/`}
                  className="min-w-0 flex-1 truncate text-sm font-medium transition-colors hover:text-accent"
                >
                  {players[c.playerId]?.full_name ?? c.playerId}
                </Link>
                <KeepPips used={c.keepsUsed} total={c.keepsUsed + c.keepsRemaining} />
                <span
                  className={`tabular w-9 shrink-0 text-right text-sm font-bold ${c.expired ? "text-loss" : "text-accent"}`}
                >
                  {c.expired ? "ADP" : `R${c.round}`}
                </span>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
