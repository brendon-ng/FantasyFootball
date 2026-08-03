import Link from "next/link";

import { Panel, PanelHeader, fmt } from "@/components/ui";
import { getOwnerMap, getPlayers, getRecords } from "@/lib/data";
import type { ScoreRecord } from "@/lib/types";

export const metadata = { title: "Records · Den Ops" };

export default function RecordsPage() {
  const records = getRecords();
  const owners = getOwnerMap();
  const players = getPlayers();
  const name = (slug: string | null | undefined) => (slug && owners.get(slug)?.name) || "—";

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Record Book</h1>
        <p className="mt-1 text-sm text-chalk-500">
          Extremes across every finalized week, regular season and playoffs.{" "}
          <span className="text-chalk-600">
            2024 onward only — the imported 2020–2023 ESPN seasons have no weekly matchup data.
          </span>
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ScoreList
          title="Highest Weekly Scores"
          rows={records.weeklyHigh}
          name={name}
          tone="text-accent"
        />
        <ScoreList
          title="Lowest Weekly Scores"
          rows={records.weeklyLow}
          name={name}
          tone="text-loss"
        />

        <Panel>
          <PanelHeader
            title="Best Player Weeks"
            meta="started only"
            legend="Highest single-week scores by a started player. Bench performances are excluded."
          />
          <ol className="divide-y divide-ink-700">
            {records.playerHigh.slice(0, 20).map((r, i) => (
              <li key={`${r.season}-${r.week}-${r.playerId}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/players/${r.playerId}/`}
                    className="block truncate text-sm font-medium transition-colors hover:text-accent"
                  >
                    {players[r.playerId]?.full_name ?? r.playerId}
                  </Link>
                  <div className="truncate text-[11px] text-chalk-600">
                    {name(r.ownerSlug)} · {r.season} wk{r.week}
                  </div>
                </div>
                <span className="tabular shrink-0 text-sm font-bold text-accent">
                  {fmt.pts(r.points)}
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="space-y-5">
          <MarginList title="Biggest Blowouts" rows={records.biggestBlowout} name={name} />
          <MarginList title="Narrowest Wins" rows={records.narrowestWin} name={name} />
        </div>
      </div>
    </div>
  );
}

function ScoreList({
  title,
  rows,
  name,
  tone,
}: {
  title: string;
  rows: ScoreRecord[];
  name: (s: string | null | undefined) => string;
  tone: string;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        meta={`top ${Math.min(rows.length, 20)}`}
        legend="Rank · owner · season, week and opponent (their score in brackets) · points scored"
      />
      <ol className="divide-y divide-ink-700">
        {rows.slice(0, 20).map((r, i) => (
          <li key={`${r.season}-${r.week}-${r.ownerSlug}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="tabular w-5 shrink-0 text-[11px] text-chalk-600">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/owners/${r.ownerSlug}/`}
                className="block truncate text-sm font-medium transition-colors hover:text-accent"
              >
                {name(r.ownerSlug)}
              </Link>
              <div className="truncate text-[11px] text-chalk-600">
                {r.season} wk{r.week} vs {name(r.opponentSlug)}
                {r.opponentPoints != null ? ` (${fmt.pts1(r.opponentPoints)})` : ""}
              </div>
            </div>
            <span className={`tabular shrink-0 text-sm font-bold ${tone}`}>{fmt.pts(r.points)}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function MarginList({
  title,
  rows,
  name,
}: {
  title: string;
  rows: Array<ScoreRecord & { margin: number }>;
  name: (s: string | null | undefined) => string;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        legend="Winner def. loser · season, week and final score · margin of victory"
      />
      <ol className="divide-y divide-ink-700">
        {rows.slice(0, 8).map((r) => (
          <li key={`${r.season}-${r.week}-${r.ownerSlug}`} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {name(r.ownerSlug)}{" "}
                <span className="text-chalk-600">def.</span> {name(r.opponentSlug)}
              </div>
              <div className="text-[11px] text-chalk-600">
                {r.season} wk{r.week} · {fmt.pts1(r.points)}–{fmt.pts1(r.opponentPoints ?? 0)}
              </div>
            </div>
            <span className="tabular shrink-0 text-sm font-bold text-chalk-300">
              +{fmt.pts(r.margin)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
