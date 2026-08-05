"use client";

import { useState } from "react";

import Link from "next/link";

import { TradeReturns } from "@/components/trade-returns";
import type {
  DraftPickRecord,
  PlayerMeta,
  Trade,
  TradeLeg,
  TradeReturn,
} from "@/lib/types";

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
 *
 * A CLIENT COMPONENT ONLY FOR THE ANONYMISE TOGGLE, and it costs nothing: the
 * trade list and the modal are both client components already, so this code was
 * in the bundle whatever the trade page did with it.
 */
export function TradeCard({
  trade,
  players,
  ownerNames,
  outcomes = {},
  returns,
  handoffs = {},
  showSeason = true,
  showTreeLink = true,
  onOpen,
  onOpenTrade,
}: {
  trade: Trade;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  /** What each traded pick became, keyed `season:round:originalOwner`. */
  outcomes?: Record<string, DraftPickRecord>;
  /** What each side got for the rest of that season, by owner slug. */
  returns?: TradeReturn;
  /** `season|round|originalOwner|from` -> the trade that moved that pick on. */
  handoffs?: Record<string, string>;
  showSeason?: boolean;
  /**
   * Off on the trade's own page, where the link would point at the page being
   * read. Separate from `showSeason`, which is off there for its own reason —
   * one flag doing both jobs breaks the moment either is wanted alone.
   */
  showTreeLink?: boolean;
  /** Set in a list, where the detail lives behind a click rather than inline. */
  onOpen?: () => void;
  /** Jump to another trade — the one that moved a pick on, or moved a player. */
  onOpenTrade?: (tradeId: string) => void;
}) {
  /**
   * FOR SCREENSHOTS. The point of sending a deal round is to argue about who won
   * it, and that argument is worthless once everyone can see whose it was. Local
   * state, not the URL: you turn it on, take the picture, and it is done.
   */
  const [anon, setAnon] = useState(false);
  const names = anon ? aliases(trade, ownerNames) : ownerNames;
  const name = (slug: string | null) => (slug && names[slug]) || "—";

  // Every party gets a column even if they only sent — a team that received
  // nothing still took part, and omitting them makes the trade unreadable.
  const received = new Map<string, TradeLeg[]>(trade.ownerSlugs.map((s) => [s, []]));
  for (const leg of trade.legs) {
    if (leg.toSlug && received.has(leg.toSlug)) received.get(leg.toSlug)!.push(leg);
  }

  return (
    <div
      className={`border-b border-ink-700 px-4 py-3 last:border-0 sm:px-5 ${
        // Dimmed, because none of it happened. Still legible — it is a real thing
        // the league did and then undid — but it must not read as a result.
        trade.vetoed ? "opacity-60" : ""
      }`}
    >
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
        {trade.vetoed ? (
          <span className="rounded border border-loss/60 bg-loss/10 px-1 text-[9px] font-bold uppercase tracking-wide text-loss">
            Vetoed
          </span>
        ) : null}
        {trade.ownerSlugs.length > 2 ? (
          <span className="rounded border border-me-dim px-1 text-[9px] font-bold uppercase tracking-wide text-me">
            {trade.ownerSlugs.length}-team
          </span>
        ) : null}
        {/* Only where the deal is the subject — a list of nine is not what anyone
            screenshots, and nine toggles in a column is noise. */}
        {!onOpen ? (
          <button
            type="button"
            onClick={() => setAnon(!anon)}
            aria-pressed={anon}
            title="Hide who is who, so a screenshot can be argued about on its merits"
            className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              anon
                ? "border-accent-dim bg-accent/10 text-accent"
                : "border-ink-600 text-chalk-500 hover:border-ink-500 hover:text-chalk-300"
            }`}
          >
            {anon ? "Show names" : "Hide names"}
          </button>
        ) : null}
        {!onOpen && showTreeLink ? (
          // Only in the modal, where "Details" has already been used to get here.
          <Link
            href={`/trades/${trade.id}/`}
            className="shrink-0 text-[11px] text-chalk-500 transition-colors hover:text-accent"
          >
            Trade tree <span aria-hidden>→</span>
          </Link>
        ) : null}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="ml-auto shrink-0 text-[11px] text-chalk-500 transition-colors hover:text-accent"
          >
            Details <span aria-hidden>→</span>
          </button>
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
            {/* NOT A LINK WHEN HIDDEN. The href carries the slug and the identity
                rule matches on it — either one names the team the label is
                hiding, and a screenshot would show it painted violet. */}
            {anon ? (
              <span className="block truncate text-sm font-semibold text-chalk-300">
                {name(slug)}
              </span>
            ) : (
              <Link
                href={`/owners/${slug}/`}
                data-owner={slug}
                className="block truncate text-sm font-semibold transition-colors hover:text-accent"
              >
                {name(slug)}
              </Link>
            )}
            <ul className="mt-1 space-y-0.5">
              {received.get(slug)!.length ? (
                received.get(slug)!.map((leg, i) => (
                  <li key={i} className="text-[13px] leading-snug text-chalk-300">
                    <LegText
                      leg={leg}
                      anon={anon}
                      players={players}
                      ownerNames={names}
                      outcomes={outcomes}
                      handoff={
                        leg.kind === "pick" && leg.pick && leg.toSlug
                          ? handoffs[
                              `${leg.pick.season}|${leg.pick.round}|${leg.pick.originalSlug}|${leg.toSlug}`
                            ]
                          : undefined
                      }
                      onOpenTrade={onOpenTrade}
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

      {returns ? (
        <TradeReturns
          players={players}
          ownerNames={names}
          returns={returns}
          onOpenTrade={onOpenTrade}
        />
      ) : null}
    </div>
  );
}

/**
 * How the incoming players actually did, for the rest of that season.
 *
 * THE NEAREST THING TO "WHO WON", and deliberately not a verdict. It counts what
 * the players returned and nothing else: a pick pays off in a different season,
 * and a team that traded for a position it was short of may have won a deal it
 * lost on points.
 *
 * A TABLE AT THE FOOT rather than a line under each player. Hung off the legs it
 * doubled the height of every row and buried the deal itself.
 *
 * SIDE BY SIDE FOR A TWO-TEAM TRADE, under the columns the players are listed in,
 * so each side's return sits beneath that side. Three or more parties STACK: a
 * third column leaves nothing for the names, and a three-way is read one leg at a
 * time anyway.
 *
 * Per player AND totalled: a two-for-two where one player carried the whole
 * return is a different deal from one where both did, and a total hides that.
 */
/** "Ja'Marr Chase", "2026 4th (Reagan's)", "$12 FAAB". */
function LegText({
  leg,
  anon,
  players,
  ownerNames,
  outcomes,
  handoff,
  onOpenTrade,
}: {
  leg: TradeLeg;
  /** Names are aliases, so do not shorten them — "Team A" shortens to "Team". */
  anon: boolean;
  players: Record<string, PlayerMeta>;
  ownerNames: Record<string, string>;
  outcomes: Record<string, DraftPickRecord>;
  /** The trade this owner sent the pick on in, when they did. */
  handoff?: string;
  onOpenTrade?: (tradeId: string) => void;
}) {
  const short = (n: string) => (anon ? n : n.split(" ")[0]);

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
        {from ? <span className="text-chalk-600"> ({short(from)}&apos;s)</span> : null}
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
                {/* The obvious next question is "so who did they send it to" —
                    which is a different trade, one click away. */}
                {handoff && onOpenTrade ? (
                  <button
                    type="button"
                    onClick={() => onOpenTrade(handoff)}
                    className="text-loss underline decoration-dotted underline-offset-2 transition-colors hover:text-chalk-100"
                    title="See the trade that moved this pick on"
                  >
                    · picked by {short(usedBy)}
                  </button>
                ) : (
                  <span className="text-loss">· picked by {short(usedBy)}</span>
                )}
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
    <span className="block">
      <Link href={`/players/${leg.playerId}/`} className="transition-colors hover:text-accent">
        {meta?.full_name ?? leg.playerId}
        {meta?.position ? (
          <span className="ml-1 text-[11px] text-chalk-600">{meta.position}</span>
        ) : null}
      </Link>
    </span>
  );
}

const ordinal = (n: number): string =>
  n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";

/**
 * Every owner relabelled, this trade's parties first so they read A, B, C down
 * the columns.
 *
 * EVERY OWNER, not just the parties. A pick names whoever it originally belonged
 * to and, once the draft has run, whoever actually used it — both can be someone
 * who was not in the deal. Left out of the map they fall through to the raw slug,
 * which is a name with a hyphen in it.
 */
function aliases(trade: Trade, ownerNames: Record<string, string>): Record<string, string> {
  const order = [...trade.ownerSlugs, ...Object.keys(ownerNames).sort()];
  const out: Record<string, string> = {};
  let i = 0;
  for (const slug of order) {
    if (out[slug]) continue;
    // Past Z it wraps rather than walking into the punctuation after it. No
    // league is that big, but a label reading "Team [" would be a puzzle.
    out[slug] =
      `Team ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) + 1 : ""}`;
    i++;
  }
  return out;
}
