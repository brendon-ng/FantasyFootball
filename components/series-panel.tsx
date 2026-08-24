import Link from "next/link";

import { Panel, PanelHeader, fmt, verboseKind } from "@/components/ui";
import { matchupChip, type Meeting } from "@/lib/data";

/**
 * Every meeting between two owners, newest first.
 *
 * ONE RENDERER FOR BOTH MATCHUP STATES — the report of a finished game and the
 * preview of a fixture. It is the same list answering the same question, and the
 * only difference is whether one of the rows is the game being looked at.
 *
 * THE CURRENT GAME STAYS IN THE LIST rather than being cut from it, so the series
 * reads as a sequence with a "you are here" instead of a run of games with a hole
 * where the one you are looking at should be. A fixture has no row yet, so it
 * simply passes no `currentId`.
 */
export function SeriesPanel({
  series,
  currentId,
  nameOf,
  pairHref,
  title = "The Series",
}: {
  series: Meeting[];
  /** The game being viewed, when it is one of these. */
  currentId?: string;
  nameOf: (slug: string) => string;
  pairHref: string;
  title?: string;
}) {
  if (!series.length) return null;
  return (
    <Panel>
      <PanelHeader
        title={title}
        meta={`${series.length} meeting${series.length === 1 ? "" : "s"}`}
        href={pairHref}
        hrefLabel="Head to head"
      />
      <div className="divide-y divide-ink-700">
        {series.map((g) => {
          const gw = g.a.points === g.b.points ? null : g.a.points > g.b.points ? g.a : g.b;
          const here = g.id === currentId;
          return (
            <Link
              key={g.id}
              href={`/matchups/${g.id}/`}
              aria-current={here ? "page" : undefined}
              className={`flex items-center gap-3 px-4 py-2.5 transition-colors sm:px-5 ${
                here ? "border-l-2 border-l-accent bg-accent/[0.07]" : "hover:bg-ink-700/40"
              }`}
            >
              {/* Below sm the postseason chip column is hidden, so the label
                  rides under the date instead. sm:hidden keeps it from
                  double-labelling once that column reappears. */}
              <span className="w-20 shrink-0 text-[11px] text-chalk-600">
                <span className="tabular">
                  {g.season}
                  {g.week ? ` wk${g.week}` : ""}
                </span>
                {g.kind !== "regular" ? (
                  <span className="mt-0.5 block truncate text-[9px] uppercase tracking-wide text-chalk-500 sm:hidden">
                    {verboseKind(matchupChip(g.label, g.kind))}
                  </span>
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                {[g.a, g.b].map((s) => (
                  <div
                    key={s.ownerSlug}
                    className={`truncate text-sm ${
                      gw?.ownerSlug === s.ownerSlug
                        ? "font-semibold text-chalk-100"
                        : "text-chalk-500"
                    }`}
                  >
                    <span data-owner={s.ownerSlug}>{nameOf(s.ownerSlug)}</span>
                  </div>
                ))}
              </div>
              {/* Badge left of the numbers, in a slot that is always there. */}
              <span className="hidden w-[92px] shrink-0 text-right sm:block">
                {g.kind !== "regular" ? (
                  <span className="rounded border border-ink-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-chalk-500">
                    {matchupChip(g.label, g.kind)}
                  </span>
                ) : null}
              </span>
              <div className="w-20 shrink-0 text-right">
                {[g.a, g.b].map((s) => (
                  <div
                    key={s.ownerSlug}
                    className={`tabular text-sm ${
                      gw?.ownerSlug === s.ownerSlug
                        ? "font-semibold text-chalk-100"
                        : "text-chalk-500"
                    }`}
                  >
                    {fmt.pts(s.points)}
                  </div>
                ))}
              </div>
              <span
                aria-hidden
                className={`shrink-0 text-[10px] ${here ? "text-accent" : "text-chalk-600"}`}
              >
                {here ? "●" : "→"}
              </span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}
