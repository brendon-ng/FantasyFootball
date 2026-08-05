import Link from "next/link";

import type { DraftPickRecord, PlayerMeta, Trade, TradeLeg } from "@/lib/types";

/**
 * One trade, grouped by who RECEIVED what.
 *
 * BY RECIPIENT, NOT BY SENDER. "What did I get" is the question people actually
 * ask, and it is the only framing that survives a three-team deal: Den Ops has
 * one where David sends picks to two different owners while receiving a player
 * from a third, which no "A gave X for Y" layout can state without lying.
 *
 * A column per party, so a two-team trade reads as the familiar two sides and a
 * three-team trade simply has three columns rather than a different component.
 */
export function TradeCard({
  trade,
  players,
  ownerNames,
  outcomes = {},
  showSeason = true,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  /** What each traded pick became, keyed `season:round:originalOwner`. */
  outcomes?: Record<string, DraftPickRecord>;
  showSeason?: boolean;
}) {
  const name = (slug: string | null) => (slug && ownerNames[slug]) || "—";

  // Every party gets a column even if they only sent — a team that received
  // nothing still took part, and omitting them makes the trade unreadable.
  const received = new Map<string, TradeLeg[]>(trade.ownerSlugs.map((s) => [s, []]));
  for (const leg of trade.legs) {
    if (leg.toSlug && received.has(leg.toSlug)) received.get(leg.toSlug)!.push(leg);
  }

  return (
    <div className="border-b border-ink-700 px-4 py-3 last:border-0 sm:px-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] text-chalk-600">
        {showSeason ? (
          <Link
            href={`/history/${trade.season}/`}
            className="font-semibold text-chalk-400 transition-colors hover:text-accent"
          >
            {trade.season}
          </Link>
        ) : null}
        <span>{trade.preseason ? "Preseason" : `Week ${trade.week}`}</span>
        {trade.ownerSlugs.length > 2 ? (
          <span className="rounded border border-me-dim px-1 text-[9px] font-bold uppercase tracking-wide text-me">
            {trade.ownerSlugs.length}-team
          </span>
        ) : null}
      </div>

      <div
        className="grid gap-2.5 sm:gap-4"
        style={{
          // A column per party. Inline because the count is dynamic, and a
          // `repeat(var(--n), …)` template is invalid — browsers reject a var()
          // as a repeat count and drop the whole declaration.
          gridTemplateColumns: `repeat(${Math.min(trade.ownerSlugs.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {trade.ownerSlugs.map((slug) => (
          <div key={slug} className="min-w-0">
            <Link
              href={`/owners/${slug}/`}
              data-owner={slug}
              className="block truncate text-sm font-semibold transition-colors hover:text-accent"
            >
              {name(slug)}
            </Link>
            <ul className="mt-1 space-y-0.5">
              {received.get(slug)!.length ? (
                received.get(slug)!.map((leg, i) => (
                  <li key={i} className="text-[13px] leading-snug text-chalk-300">
                    <LegText
                      leg={leg}
                      players={players}
                      ownerNames={ownerNames}
                      outcomes={outcomes}
                    />
                  </li>
                ))
              ) : (
                <li className="text-[13px] text-chalk-600">nothing</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Ja'Marr Chase", "2026 4th (Reagan's)", "$12 FAAB". */
function LegText({
  leg,
  players,
  ownerNames,
  outcomes,
}: {
  leg: TradeLeg;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
}) {
  if (leg.kind === "faab") {
    return <span className="text-accent">${leg.amount} FAAB</span>;
  }
  if (leg.kind === "pick") {
    const p = leg.pick!;
    // WHOSE pick it originally is, not who sent it. A pick can change hands more
    // than once, and "Reagan's 2026 4th" is how the league refers to it however
    // many owners it has passed through.
    const from = p.originalSlug ? (ownerNames[p.originalSlug] ?? p.originalSlug) : null;
    // Absent until that draft has actually run — a pick traded for a future year
    // has no outcome, and guessing one would be inventing history.
    const became = outcomes[`${p.season}:${p.round}:${p.originalSlug}`];
    // WHO ACTUALLY PICKED, when it is not the team that received it here. A pick
    // can be traded again afterwards, so the receiver is not always the user, and
    // "we got their 9th" reads very differently once you know it was flipped on.
    const usedBy =
      became && became.ownerSlug && became.ownerSlug !== leg.toSlug
        ? (ownerNames[became.ownerSlug] ?? became.ownerSlug)
        : null;
    return (
      <span className="block">
        {p.season} {`${p.round}${ordinal(p.round)}`}
        {from ? <span className="text-chalk-600"> ({from.split(" ")[0]}&apos;s)</span> : null}
        {became ? (
          /* Indented under its pick with a turnstile, so it reads as a note ABOUT
             the line above rather than another thing received. Without either cue
             a two-line leg looks like two legs. */
          <span className="mt-0.5 flex gap-1 pl-2 text-[11px] leading-snug text-chalk-600">
            <span aria-hidden className="shrink-0 text-chalk-700">
              &#8627;
            </span>
            <span className="min-w-0">
            <span className="tabular">
              {became.round}.{String(became.draftSlot).padStart(2, "0")}
            </span>{" "}
            <Link
              href={`/players/${became.playerId}/`}
              className="transition-colors hover:text-accent"
            >
              {players[became.playerId]?.full_name ?? became.playerId}
            </Link>
            {usedBy ? (
              <>
                {" "}
                <span className="text-loss">· picked by {usedBy.split(" ")[0]}</span>
              </>
            ) : null}
            </span>
          </span>
        ) : null}
      </span>
    );
  }
  const meta = players[leg.playerId!];
  return (
    <Link
      href={`/players/${leg.playerId}/`}
      className="transition-colors hover:text-accent"
    >
      {meta?.full_name ?? leg.playerId}
      {meta?.position ? <span className="ml-1 text-[11px] text-chalk-600">{meta.position}</span> : null}
    </Link>
  );
}

const ordinal = (n: number): string =>
  n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
