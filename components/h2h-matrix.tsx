import Link from "next/link";

import type { OwnerRecord } from "@/lib/types";

/**
 * Every active pairing at once, each cell a link into that series.
 *
 * The site generates a page per pairing — 120 of them for Den Ops — and until
 * this existed two paths reached any of them: through a matchup, or through an
 * owner profile. A grid makes every rivalry one click from the history page, and
 * answers a question no other page does: who owns whom.
 *
 * ACTIVE OWNERS ONLY. Departed owners have no current rivalry, and including
 * them makes a 16-wide grid to carry four columns nobody will click. Their
 * records survive on the all-time table and their own profiles.
 *
 * ALPHABETICAL, unlike the all-time table above it, which ranks. A matrix is
 * looked up rather than read down — you arrive knowing the name you want.
 *
 * COLOURED TEXT, NOT FILLED CELLS. Two shaded versions came before this one and
 * both read worse: tinting the cells turned every near-even record — which is
 * most of them — into brown-olive mud, and forcing equal squares to fix the
 * resulting ragged patches squeezed the names and made the rows too tall. Green
 * and red on the numbers themselves says the same thing and leaves the grid
 * quiet enough to scan.
 */

export function H2HMatrix({
  owners,
  records,
}: {
  /** Active owners, in the order the axes should read. */
  owners: Array<{ slug: string; name: string; firstName: string }>;
  records: OwnerRecord[];
}) {
  const byOwner = new Map(records.map((r) => [r.ownerSlug, r]));

  return (
    // The whole grid scrolls sideways rather than squeezing: twelve columns of
    // records cannot fit a phone, and shrinking them to fit makes every cell
    // unreadable instead of some of them off-screen.
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {/* Sticky, so the name stays put while the records scroll under it —
                a record with no row label is unreadable. */}
            <th className="sticky left-0 z-10 bg-ink-800 px-4 py-2 text-left sm:px-5" />
            {owners.map((o) => (
              <th
                key={o.slug}
                title={o.name}
                className="eyebrow px-2 py-2 text-center text-[10px] font-bold"
              >
                {o.firstName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {owners.map((row) => (
            <tr key={row.slug} className="border-t border-ink-700">
              <th
                scope="row"
                className="sticky left-0 z-10 whitespace-nowrap border-t border-ink-700 bg-ink-800 px-4 py-1.5 text-left text-[13px] font-medium sm:px-5"
              >
                <Link
                  href={`/owners/${row.slug}/`}
                  data-owner={row.slug}
                  className="transition-colors hover:text-accent"
                >
                  {row.name}
                </Link>
              </th>
              {owners.map((col) => {
                if (col.slug === row.slug) {
                  return (
                    <td
                      key={col.slug}
                      className="border-t border-ink-700 bg-ink-850/60 px-2 py-1.5 text-center text-chalk-700"
                    >
                      ·
                    </td>
                  );
                }
                const v = byOwner.get(row.slug)?.vs[col.slug];
                const n = v ? v.wins + v.losses + v.ties : 0;
                if (!v || !n) {
                  return (
                    <td
                      key={col.slug}
                      className="border-t border-ink-700 px-2 py-1.5 text-center text-[11px] text-chalk-700"
                    >
                      —
                    </td>
                  );
                }
                const record = v.ties
                  ? `${v.wins}-${v.losses}-${v.ties}`
                  : `${v.wins}-${v.losses}`;
                // Read from the ROW's side, so a row scans as "how I do against
                // everyone" — the reason to have a grid rather than a list.
                const tone =
                  v.wins > v.losses
                    ? "text-accent"
                    : v.losses > v.wins
                      ? "text-loss"
                      : "text-chalk-400";

                return (
                  <td key={col.slug} className="border-t border-ink-700 p-0 text-center">
                    <Link
                      href={`/h2h/${[row.slug, col.slug].sort().join("-vs-")}/`}
                      title={`${row.name} vs ${col.name} — ${record} in ${n} meeting${n === 1 ? "" : "s"}`}
                      className={`tabular block px-2 py-1.5 text-[13px] transition-colors hover:bg-ink-700/60 ${tone}`}
                    >
                      {record}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
