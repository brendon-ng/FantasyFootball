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
 * SHADED ON TWO CHANNELS: hue for who is winning, brightness for how many games
 * back it. The record is printed in every cell, so colour is never the only
 * encoding.
 */

/**
 * Two independent channels, because a record carries two facts.
 *
 * HUE SAYS WHO IS WINNING, from a neutral grey at dead even to full green or
 * full red at a sweep. BRIGHTNESS SAYS HOW MUCH EVIDENCE there is, rising with
 * the number of meetings.
 *
 * Splitting them fixes what a single channel cannot: 1-0 and 9-1 are both
 * "winning", and one of them is an accident. Here 1-0 is unmistakably green and
 * barely there, while 9-1 is green and solid. A long dead-even series is its own
 * signal too — 6-6 over twelve games shows as a distinctly grey cell rather than
 * fading into the ones nobody has played.
 */
const WIN: RGB = [53, 208, 127]; // --color-win
const LOSS: RGB = [255, 92, 108]; // --color-loss
/** The diverging midpoint. Grey, never a third hue. */
const EVEN: RGB = [110, 110, 124];

type RGB = [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

/**
 * How much a series leans, -1 to +1. Ties count as half, as everywhere else.
 *
 * RAW, not shrunk: small samples are handled by the brightness channel now, so
 * flattening them into the colour as well would say the same thing twice and
 * leave a sweep looking tentative.
 */
function lean(w: number, l: number, t: number): number {
  const games = w + l + t;
  return games ? ((w + t / 2) / games) * 2 - 1 : 0;
}

/**
 * Confidence from sample size, saturating.
 *
 * `n / (n + 4)` rather than a share of the maximum: it does not move when the
 * league's busiest pairing gains a game, and the interesting range is the low
 * end — one meeting against four is a real difference, twelve against sixteen
 * is not.
 */
const confidence = (n: number): number => n / (n + 4);

function cellColour(w: number, l: number, t: number): string {
  const n = w + l + t;
  const score = lean(w, l, t);
  const rgb = lerp(EVEN, score >= 0 ? WIN : LOSS, Math.abs(score));
  // Capped at 0.55 so `chalk-100` clears 4.5:1 on the strongest cell.
  const alpha = 0.1 + 0.45 * confidence(n);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
}

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
                className="eyebrow px-1.5 py-2 text-center text-[10px] font-bold"
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
                      className="border-t border-ink-700 bg-ink-850/60 px-1.5 py-1.5 text-center text-chalk-700"
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
                      className="border-t border-ink-700 px-1.5 py-1.5 text-center text-[11px] text-chalk-700"
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

                return (
                  <td key={col.slug} className="border-t border-ink-700 p-0 text-center">
                    <Link
                      href={`/h2h/${[row.slug, col.slug].sort().join("-vs-")}/`}
                      title={`${row.name} vs ${col.name} — ${record} in ${n} meeting${n === 1 ? "" : "s"}`}
                      style={{ backgroundColor: cellColour(v.wins, v.losses, v.ties) }}
                      // The cell colour carries the encoding, so the text stays
                      // an ink token. Coloured text on a coloured tint would fight
                      // it and cost contrast for nothing.
                      className="tabular block px-1.5 py-1.5 text-[13px] text-chalk-200 transition-colors hover:brightness-125"
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
