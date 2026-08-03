import Link from "next/link";

import type { BracketMatch } from "@/lib/types";

/**
 * Visual playoff / toilet-bowl bracket.
 *
 * LAYOUT. The whole bracket is ONE CSS grid — columns are rounds, rows are leaf
 * slots. Per-column grids were tried first and cannot work: rows only line up
 * across columns if they share a grid, otherwise a round-2 match can't sit
 * centred between the two round-1 matches that feed it.
 *
 * Slots are assigned by depth-first traversal from the final, so the two matches
 * feeding a given match always land in adjacent rows. Ordering round 1 by seed
 * instead (the obvious approach) scatters feeders apart and the bracket stops
 * reading as a bracket.
 *
 * A parent spans its children's rows and centres itself, which is what produces
 * the staircase.
 *
 * TWO DOMAIN QUIRKS:
 *
 * 1. THE TOILET BOWL IS INVERTED. Sleeper's `winner` is whoever advances, and in
 *    the losers bracket you advance by LOSING. The advancing team is therefore
 *    the lower scorer, and marking it "W" would be actively wrong — when
 *    `match.inverted` is set it is tinted as a loss instead.
 *
 * 2. BYES ARE IMPLICIT. Sleeper emits no round-1 match for a bye; top seeds just
 *    appear in round 2 with no `from` reference. We synthesise a bye leaf so the
 *    bracket reads like the Sleeper app.
 *
 * Placement games (3rd place, 5th place, the 8th place game) sit in the column
 * for the week they were actually played, below the main path.
 */

/** Grid row height. Must exceed a two-row card so spans centre cleanly. */
const ROW_H = 76;
const COL_W = 200;

interface Positioned {
  match: BracketMatch;
  /** Inclusive leaf-slot range this match spans. */
  start: number;
  end: number;
}

interface ByeLeaf {
  slug: string;
  round: number;
  slot: number;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function TeamRow({
  slug,
  label,
  points,
  advancing,
  inverted,
  muted,
}: {
  slug: string | null;
  label: string;
  points: number | undefined;
  advancing: boolean;
  inverted: boolean;
  muted?: boolean;
}) {
  const tone = muted
    ? "text-chalk-600"
    : advancing
      ? inverted
        ? "text-loss font-semibold"
        : "text-accent font-semibold"
      : "text-chalk-300";

  return (
    <div
      data-owner={slug ?? undefined}
      // The bracket marks identity with a tint, because text colour here
      // already means won or lost.
      data-owner-tint={slug ?? undefined}
      data-me-exempt=""
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] ${tone}`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular shrink-0 text-[12px]">
        {points != null ? points.toFixed(2) : ""}
      </span>
    </div>
  );
}

function MatchCard({
  match,
  heading,
  note,
  nameOf,
  seedOf,
  hasFeeders,
  href,
  current,
}: {
  match: BracketMatch;
  heading?: string;
  note?: string;
  nameOf: (s: string | null | undefined) => string;
  seedOf: (s: string | null) => number | null;
  hasFeeders: boolean;
  /** Set only when a matchup page exists for this game. */
  href?: string | null;
  /** The match being viewed, when the bracket is shown in context. */
  current?: boolean;
}) {
  const from = (f: BracketMatch["team1From"]) =>
    !f ? "TBD" : f.winnerOf != null ? `Winner of M${f.winnerOf}` : `Loser of M${f.loserOf}`;

  const side = (team: string | null, fromRef: BracketMatch["team1From"]) => {
    const seed = seedOf(team);
    return {
      slug: team,
      label: team ? `${seed ? `${seed}· ` : ""}${nameOf(team)}` : from(fromRef),
      points: team ? match.points[team] : undefined,
      advancing: Boolean(team && match.winner === team),
      muted: !team,
    };
  };

  const sides = match.isBye
    ? [
        side(match.team1, match.team1From),
        { slug: null, label: "BYE", points: undefined, advancing: false, muted: true },
      ]
    : [side(match.team1, match.team1From), side(match.team2, match.team2From)];

  const shell = current
    ? "border-me bg-me/[0.12] ring-2 ring-me/40"
    : "border-ink-600 bg-ink-850";

  return (
    <div className="relative">
      {heading ? (
        <div className="mb-1 truncate text-center text-[10px] font-semibold uppercase tracking-wide text-chalk-500">
          {heading}
        </div>
      ) : null}
      {/* Short stub into the card's left edge, so a match visibly receives its
          feeders without needing full SVG connectors. */}
      {hasFeeders ? (
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 h-px w-3 bg-ink-500"
          style={{ marginTop: heading ? "0.5rem" : 0 }}
        />
      ) : null}
      {/* Only games that were actually played get a page, so an undecided or
          bye card stays inert rather than becoming a dead link. */}
      {href ? (
        <Link
          href={href}
          className={`block divide-y divide-ink-700 overflow-hidden rounded-lg border transition-colors hover:border-ink-400 ${shell}`}
        >
          {sides.map((s, i) => (
            <TeamRow key={i} {...s} inverted={match.inverted} />
          ))}
        </Link>
      ) : (
        <div className={`divide-y divide-ink-700 overflow-hidden rounded-lg border ${shell}`}>
          {sides.map((s, i) => (
            <TeamRow key={i} {...s} inverted={match.inverted} />
          ))}
        </div>
      )}
      {note || match.label ? (
        <div className="mt-1 text-center text-[10px] text-chalk-600">
          {[match.label, note].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function ByeCard({ name, seed }: { name: string; seed: number | null }) {
  return (
    <div className="divide-y divide-ink-700 overflow-hidden rounded-lg border border-dashed border-ink-500 bg-ink-850/50">
      <div className="truncate px-2.5 py-1.5 text-[13px] text-chalk-300">
        {seed ? `${seed}· ` : ""}
        {name}
      </div>
      <div className="px-2.5 py-1.5 text-center text-[11px] font-semibold tracking-wide text-chalk-600">
        BYE
      </div>
    </div>
  );
}

export function Bracket({
  matches,
  finalLabel,
  finalPlace,
  nameOf,
  seedOf,
  hrefFor,
  isCurrent,
}: {
  matches: BracketMatch[];
  /** e.g. "🏆 Championship" or "💩 King (Last Place)". */
  finalLabel: string;
  /** The placement the marquee game decides — 1 for a title, 12 for last. */
  finalPlace: number;
  nameOf: (s: string | null | undefined) => string;
  seedOf: (s: string | null) => number | null;
  /** Returns the matchup-page href for a game, or null if none exists. */
  hrefFor?: (match: BracketMatch) => string | null;
  /** Marks the match currently being viewed, when shown in context. */
  isCurrent?: (match: BracketMatch) => boolean;
}) {
  if (!matches.length) return null;

  const byId = new Map(matches.map((m) => [m.matchId, m]));

  // Which game is the marquee one differs per bracket: the championship decides
  // 1st, a toilet bowl or ladder decides last, a consolation ladder decides 3rd.
  // The caller knows; guessing from placesFor alone picks the wrong game.
  const final = matches.find((m) => !m.isBye && m.placesFor?.includes(finalPlace)) ?? null;

  // Anything with a placement that isn't the final is a side game.
  const sideGames = matches.filter((m) => m.placesFor != null && m.matchId !== final?.matchId);

  /**
   * Only invent byes when the data cannot express them and everyone starts in
   * round 1. Sleeper omits byes entirely, so they must be inferred there. ESPN
   * publishes them as real one-team games, and its winner's consolation ladder
   * starts at round 2 with teams dropping in from the main bracket — inferring
   * byes in either case conjures a phantom bye for every unlinked team.
   */
  const hasRouting = matches.some((m) => m.team1From || m.team2From);
  const firstRoundInData = Math.min(...matches.map((m) => m.round));
  const synthesiseByes =
    hasRouting && !matches.some((m) => m.isBye) && firstRoundInData === 1;

  // --- depth-first slot assignment -----------------------------------------
  const positioned: Positioned[] = [];
  const byes: ByeLeaf[] = [];
  let nextSlot = 0;
  const visiting = new Set<number>();

  function place(match: BracketMatch): { start: number; end: number } {
    // Cycles are impossible in well-formed data, but a guard beats a hang.
    if (visiting.has(match.matchId)) return { start: nextSlot, end: nextSlot };
    visiting.add(match.matchId);

    const refs: Array<{ team: string | null; ref: BracketMatch["team1From"] }> = [
      { team: match.team1, ref: match.team1From },
      { team: match.team2, ref: match.team2From },
    ];

    const spans: Array<{ start: number; end: number }> = [];
    for (const { team, ref } of refs) {
      const feederId = ref?.winnerOf ?? ref?.loserOf;
      const feeder = feederId != null ? byId.get(feederId) : undefined;
      if (feeder) {
        spans.push(place(feeder));
      } else if (synthesiseByes && match.round > 1 && team) {
        // With routing present, no feeder in a later round means a bye.
        const slot = nextSlot++;
        byes.push({ slug: team, round: match.round - 1, slot });
        spans.push({ start: slot, end: slot });
      }
    }

    const span = spans.length
      ? { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) }
      : (() => {
          const slot = nextSlot++;
          return { start: slot, end: slot };
        })();

    positioned.push({ match, ...span });
    return span;
  }

  if (final) place(final);
  // Any main-path match not reachable from the final (shouldn't happen, but an
  // in-progress bracket can be sparse) still gets a slot.
  for (const m of matches) {
    if (m.placesFor != null && m.matchId !== final?.matchId) continue;
    if (!positioned.some((p) => p.match.matchId === m.matchId)) place(m);
  }

  const totalLeaves = Math.max(1, nextSlot);
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const roundIndex = new Map(rounds.map((r, i) => [r, i]));
  const weekOf = (round: number) =>
    matches.find((m) => m.round === round)?.week ?? null;

  // Side games stack below the main bracket, in their own week's column.
  const sideByRound = new Map<number, BracketMatch[]>();
  for (const g of sideGames) {
    sideByRound.set(g.round, [...(sideByRound.get(g.round) ?? []), g]);
  }
  const maxSideInAnyRound = Math.max(0, ...[...sideByRound.values()].map((v) => v.length));

  const headerRows = 1;
  const totalRows = headerRows + totalLeaves + maxSideInAnyRound;

  return (
    // A bracket that reflows stops being a bracket, so it scrolls horizontally
    // on narrow screens instead of wrapping.
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <div
        className="grid min-w-max gap-x-6 gap-y-2"
        style={{
          gridTemplateColumns: `repeat(${rounds.length}, ${COL_W}px)`,
          gridTemplateRows: `auto repeat(${totalRows - 1}, minmax(${ROW_H}px, auto))`,
        }}
      >
        {rounds.map((round, i) => (
          <div key={`h${round}`} className="text-center" style={{ gridColumn: i + 1, gridRow: 1 }}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-chalk-300">
              {i === rounds.length - 1 ? "Finals" : `Round ${round}`}
            </div>
            <div className="text-[10px] text-chalk-600">Week {weekOf(round) ?? "—"}</div>
          </div>
        ))}

        {byes.map((b) => (
          <div
            key={`bye-${b.round}-${b.slot}-${b.slug}`}
            className="self-center"
            style={{
              gridColumn: (roundIndex.get(b.round) ?? 0) + 1,
              gridRow: headerRows + b.slot + 1,
            }}
          >
            <ByeCard name={nameOf(b.slug)} seed={seedOf(b.slug)} />
          </div>
        ))}

        {positioned.map(({ match, start, end }) => {
          const isFinal = match.matchId === final?.matchId;
          return (
            <div
              key={match.matchId}
              className="self-center"
              style={{
                gridColumn: (roundIndex.get(match.round) ?? 0) + 1,
                gridRow: `${headerRows + start + 1} / ${headerRows + end + 2}`,
              }}
            >
              <MatchCard
                match={match}
                heading={isFinal ? finalLabel : undefined}
                note={
                  match.inverted && match.placesFor
                    ? `lower score finishes ${ordinal(match.placesFor[0])}`
                    : undefined
                }
                hasFeeders={Boolean(match.team1From || match.team2From)}
                href={hrefFor?.(match) ?? null}
                current={isCurrent?.(match) ?? false}
                nameOf={nameOf}
                seedOf={seedOf}
              />
            </div>
          );
        })}

        {[...sideByRound.entries()].flatMap(([round, games]) =>
          games.map((g, k) => (
            <div
              key={`side-${g.matchId}`}
              className="self-center"
              style={{
                gridColumn: (roundIndex.get(round) ?? 0) + 1,
                gridRow: headerRows + totalLeaves + k + 1,
              }}
            >
              <MatchCard
                match={g}
                heading={g.placesFor ? `${ordinal(g.placesFor[0])} place` : undefined}
                note={
                  g.inverted && g.placesFor
                    ? `lower score finishes ${ordinal(g.placesFor[0])}`
                    : undefined
                }
                hasFeeders={false}
                href={hrefFor?.(g) ?? null}
                current={isCurrent?.(g) ?? false}
                nameOf={nameOf}
                seedOf={seedOf}
              />
            </div>
          )),
        )}
      </div>
    </div>
  );
}
