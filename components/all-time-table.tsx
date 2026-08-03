"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { byAllTimeRank } from "@/lib/ranking";
import type { Owner, OwnerRecord } from "@/lib/types";

/**
 * The all-time table, sortable on every column.
 *
 * Client-side because sorting is pure interaction — the data is baked at build
 * time and never refetched, so this ships the rows once and re-orders them in
 * place.
 *
 * Each column declares its own accessor and default direction. Direction
 * matters: clicking "Win%" should show the best first, but clicking "Avg Finish"
 * should also show the best first, and those are opposite numeric orders. A
 * single global default would make half the columns open backwards.
 */

interface Column {
  key: string;
  label: string;
  hint?: string;
  /** Value used for sorting; strings compare alphabetically. */
  value: (r: OwnerRecord) => number | string;
  /** Direction applied on first click. "desc" = biggest first. */
  firstClick: "asc" | "desc";
  render: (r: OwnerRecord) => React.ReactNode;
  className?: string;
}

const fmtPts = (n: number) => n.toFixed(1);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function AllTimeTable({
  records,
  owners,
  weeklyLows,
}: {
  records: OwnerRecord[];
  owners: Record<string, Owner>;
  /**
   * Career weekly-low counts by owner slug, or null for a league that does not
   * punish the weekly low — in which case the column is absent rather than a
   * row of zeroes.
   */
  weeklyLows: Record<string, number> | null;
}) {
  const columns: Column[] = useMemo(
    () => [
      {
        key: "owner",
        label: "Owner",
        value: (r) => owners[r.ownerSlug]?.name ?? r.ownerSlug,
        firstClick: "asc",
        className: "text-left",
        render: (r) => (
          <>
            <Link
              href={`/owners/${r.ownerSlug}/`}
              className="font-medium transition-colors hover:text-accent"
            >
              {owners[r.ownerSlug]?.name ?? r.ownerSlug}
            </Link>
            {owners[r.ownerSlug]?.active === false ? (
              <span className="ml-1.5 text-[10px] text-chalk-600" title="Former owner">
                ·former
              </span>
            ) : null}
          </>
        ),
      },
      {
        key: "record",
        label: "W-L",
        hint: "All-time record across every game, regular season and postseason. Sorts by wins.",
        value: (r) => r.wins,
        firstClick: "desc",
        render: (r) => (
          <span className="whitespace-nowrap text-chalk-300">
            {r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`}
          </span>
        ),
      },
      {
        key: "winPct",
        label: "Win%",
        hint: "Win percentage across every game, counting a tie as half a win",
        value: (r) => r.winPct,
        firstClick: "desc",
        render: (r) => <span className="font-semibold">{fmtPct(r.winPct)}</span>,
      },
      {
        key: "pf",
        label: "PF",
        hint: "Points For — every point scored, regular season and postseason, across all seasons",
        value: (r) => r.pointsFor,
        firstClick: "desc",
        render: (r) => <span className="text-chalk-500">{fmtPts(r.pointsFor)}</span>,
      },
      {
        key: "pfg",
        label: "PF/G",
        hint: "Points scored per game played — comparable across seasons of different length",
        value: (r) => r.pointsForPerGame,
        firstClick: "desc",
        render: (r) => (
          <span className="font-medium text-chalk-300">{fmtPts(r.pointsForPerGame)}</span>
        ),
      },
      {
        key: "pa",
        label: "PA",
        hint: "Points Against — every point their opponents scored, regular season and postseason",
        value: (r) => r.pointsAgainst,
        firstClick: "desc",
        render: (r) => <span className="text-chalk-500">{fmtPts(r.pointsAgainst)}</span>,
      },
      {
        key: "pag",
        label: "PA/G",
        hint: "Points against per game played. Lowest first — fewer is better.",
        value: (r) => r.pointsAgainstPerGame,
        firstClick: "asc",
        render: (r) => <span className="text-chalk-500">{fmtPts(r.pointsAgainstPerGame)}</span>,
      },
      {
        key: "titles",
        label: "🏆",
        hint: "Championships won",
        value: (r) => r.championships,
        firstClick: "desc",
        render: (r) => <span className="text-gold">{r.championships || "—"}</span>,
      },
      {
        key: "second",
        label: "2nd",
        hint: "Runner-up finishes",
        value: (r) => r.runnerUps,
        firstClick: "desc",
        render: (r) => <span className="text-chalk-500">{r.runnerUps || "—"}</span>,
      },
      {
        key: "third",
        label: "3rd",
        hint: "Third-place finishes",
        value: (r) => r.thirdPlaces,
        firstClick: "desc",
        render: (r) => <span className="text-chalk-500">{r.thirdPlaces || "—"}</span>,
      },
      {
        key: "last",
        label: "Last",
        hint: "Last-place finishes. Lowest first — fewer is better.",
        value: (r) => r.lastPlaces,
        firstClick: "asc",
        render: (r) => <span className="text-loss">{r.lastPlaces || "—"}</span>,
      },
      ...(weeklyLows
        ? [
            {
              key: "weeklyLows",
              label: "🚽",
              hint: "Weeks finishing lowest in the league — punishments owed. Lowest first, fewer is better.",
              value: (r: OwnerRecord) => weeklyLows[r.ownerSlug] ?? 0,
              firstClick: "asc" as const,
              render: (r: OwnerRecord) => (
                <span className="text-loss">{weeklyLows[r.ownerSlug] || "—"}</span>
              ),
            },
          ]
        : []),
      {
        key: "playoffs",
        label: "Playoffs",
        hint: "Playoff appearances out of seasons played. Sorts by rate.",
        value: (r) => (r.seasonsPlayed ? r.playoffAppearances / r.seasonsPlayed : 0),
        firstClick: "desc",
        render: (r) => (
          <span className="whitespace-nowrap text-chalk-500">
            {r.playoffAppearances}/{r.seasonsPlayed}
          </span>
        ),
      },
      {
        key: "avgFinish",
        label: "Avg Finish",
        hint: "Mean final placement. Lowest first — 1 is best.",
        value: (r) => r.averageFinish ?? 99,
        firstClick: "asc",
        render: (r) => (
          <span className="font-semibold">{r.averageFinish?.toFixed(1) ?? "—"}</span>
        ),
      },
    ],
    [owners, weeklyLows],
  );

  // Default view: hardware first, wins breaking ties. See byAllTimeRank. Keyed to
  // the titles column so the sort indicator sits on what actually leads the order.
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "titles",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0];
    const rows = [...records];
    // The titles column IS the default ranking, so it uses the shared chain
    // rather than falling through to the generic win% tie-break.
    if (col.key === "titles") {
      rows.sort(byAllTimeRank);
      return sort.dir === "desc" ? rows : rows.reverse();
    }
    rows.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      let cmp: number;
      if (typeof va === "string" || typeof vb === "string") {
        cmp = String(va).localeCompare(String(vb));
      } else {
        cmp = va - vb;
      }
      // Win% breaks ties on every numeric column so ordering is deterministic
      // rather than dependent on the input array's order.
      if (cmp === 0 && col.key !== "winPct") cmp = a.winPct - b.winPct;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [records, sort, columns]);

  const toggle = (col: Column) =>
    setSort((prev) =>
      prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.firstClick },
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead>
          <tr className="border-b border-ink-600">
            {columns.map((col, i) => {
              const active = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`px-0 py-0 ${i === 0 ? "text-left" : "text-right"}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col)}
                    title={col.hint}
                    aria-label={col.hint ? `${col.label} — ${col.hint}` : col.label}
                    className={`eyebrow flex w-full items-center gap-1 px-3 py-2.5 text-[10px] font-semibold transition-colors hover:text-chalk-100 ${
                      i === 0 ? "justify-start" : "justify-end"
                    } ${active ? "text-accent" : ""}`}
                  >
                    {col.label}
                    <span
                      aria-hidden
                      className={`text-[8px] leading-none ${active ? "opacity-100" : "opacity-0"}`}
                    >
                      {active && sort.dir === "asc" ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.ownerSlug} className="border-b border-ink-700 last:border-0">
              {columns.map((col, i) => (
                <td
                  key={col.key}
                  className={`px-3 py-2.5 ${i === 0 ? "" : "tabular text-right"} ${
                    sort.key === col.key ? "bg-ink-700/25" : ""
                  }`}
                >
                  {col.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
