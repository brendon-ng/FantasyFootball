import type { BracketMatch } from "@/lib/types";

/**
 * Visual playoff / toilet-bowl bracket.
 *
 * Two things this has to get right that a generic bracket does not:
 *
 * 1. THE TOILET BOWL IS INVERTED. Sleeper's `winner` is whoever advances, and in
 *    the losers bracket you advance by LOSING. So the advancing team is the
 *    lower scorer, and marking it "W" would be actively wrong. When
 *    `match.inverted` is set we label it "advances" and tint it as a loss.
 *
 * 2. BYES ARE IMPLICIT. Sleeper emits no round-1 match for a bye; the top seeds
 *    just appear in round 2 with no `from` reference. We synthesise a bye slot so
 *    the bracket reads like the one in the Sleeper app.
 *
 * Placement side-games (3rd place, 5th place, the 8th place game) are split out
 * of the main path, matching how Sleeper presents them.
 */

const ROUND_LABEL = (round: number, totalRounds: number) =>
  round === totalRounds ? "Finals" : `Round ${round}`;

function TeamRow({
  slug,
  name,
  points,
  isAdvancing,
  inverted,
  placeholder,
}: {
  slug: string | null;
  name: string;
  points: number | undefined;
  isAdvancing: boolean;
  inverted: boolean;
  placeholder?: boolean;
}) {
  // In a normal bracket advancing is good; in the toilet bowl it is the mark of
  // the team on its way to last place.
  const tone = !slug || placeholder
    ? "text-chalk-600"
    : isAdvancing
      ? inverted
        ? "text-loss font-semibold"
        : "text-accent font-semibold"
      : "text-chalk-400";

  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] ${tone}`}>
      <span className="truncate">{name}</span>
      <span className="tabular shrink-0 text-[12px]">
        {points != null ? points.toFixed(2) : ""}
      </span>
    </div>
  );
}

function MatchCard({
  match,
  label,
  nameOf,
  seedOf,
}: {
  match: BracketMatch;
  label?: string;
  nameOf: (s: string | null | undefined) => string;
  seedOf: (s: string | null) => number | null;
}) {
  const from = (f: BracketMatch["team1From"]) =>
    !f ? "TBD" : f.winnerOf != null ? `Winner of M${f.winnerOf}` : `Loser of M${f.loserOf}`;

  const side = (team: string | null, fromRef: BracketMatch["team1From"]) => {
    const seed = seedOf(team);
    return {
      slug: team,
      name: team ? `${seed ? `${seed}· ` : ""}${nameOf(team)}` : from(fromRef),
      points: team ? match.points[team] : undefined,
      advancing: Boolean(team && match.winner === team),
    };
  };

  const a = side(match.team1, match.team1From);
  const b = side(match.team2, match.team2From);

  return (
    <div className="w-[190px] shrink-0 sm:w-[210px]">
      {label ? (
        <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-chalk-500">
          {label}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-ink-600 bg-ink-850 divide-y divide-ink-700">
        {[a, b].map((s, i) => (
          <TeamRow
            key={i}
            slug={s.slug}
            name={s.name}
            points={s.points}
            isAdvancing={s.advancing}
            inverted={match.inverted}
            placeholder={!s.slug}
          />
        ))}
      </div>
      {match.inverted && match.placesFor ? (
        <div className="mt-1 text-center text-[10px] text-chalk-600">
          lower score finishes {ordinal(match.placesFor[0])}
        </div>
      ) : null}
    </div>
  );
}

/** A first-round bye, which Sleeper omits from the bracket data entirely. */
function ByeCard({ name, seed }: { name: string; seed: number | null }) {
  return (
    <div className="w-[190px] shrink-0 sm:w-[210px]">
      <div className="overflow-hidden rounded-lg border border-ink-600 bg-ink-850 divide-y divide-ink-700">
        <div className="px-2.5 py-1.5 text-[13px] text-chalk-300">
          {seed ? `${seed}· ` : ""}
          {name}
        </div>
        <div className="px-2.5 py-1.5 text-center text-[11px] font-semibold tracking-wide text-chalk-600">
          BYE
        </div>
      </div>
    </div>
  );
}

export function Bracket({
  matches,
  title,
  finalLabel,
  playoffWeekStart,
  nameOf,
  seedOf,
}: {
  matches: BracketMatch[];
  title: string;
  /** e.g. "🏆 Championship" or "💩 King (Last Place)". */
  finalLabel: string;
  playoffWeekStart: number;
  nameOf: (s: string | null | undefined) => string;
  seedOf: (s: string | null) => number | null;
}) {
  if (!matches.length) return null;

  // The main path is everything that feeds forward, plus the final itself.
  // Placement side-games (p present and not the final) are shown separately.
  const isFinal = (m: BracketMatch) => m.placesFor != null && m.matchId === finalMatchId;
  const finalMatchId = matches.reduce<number>((best, m) => {
    if (m.placesFor == null) return best;
    // The final decides the extreme place: 1st in a playoff, last in a toilet bowl.
    const target = m.inverted
      ? Math.max(...matches.flatMap((x) => x.placesFor ?? []))
      : 1;
    return m.placesFor[0] === target ? m.matchId : best;
  }, -1);

  const sideGames = matches.filter((m) => m.placesFor != null && !isFinal(m));
  const mainPath = matches.filter((m) => m.placesFor == null || isFinal(m));

  const rounds = [...new Set(mainPath.map((m) => m.round))].sort((a, b) => a - b);
  const totalRounds = rounds.length;

  // Teams that appear in round 2 without a feeder had a first-round bye.
  const firstRound = Math.min(...rounds);
  const byes: Array<{ slug: string; round: number }> = [];
  for (const m of mainPath) {
    if (m.round !== firstRound + 1) continue;
    if (m.team1 && !m.team1From) byes.push({ slug: m.team1, round: firstRound });
    if (m.team2 && !m.team2From) byes.push({ slug: m.team2, round: firstRound });
  }

  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>

      {/* Horizontal scroll rather than reflow: a bracket that wraps stops being
          a bracket. 190px cards mean two rounds fit on a phone. */}
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex min-w-max items-stretch gap-4 sm:gap-6">
          {rounds.map((round) => {
            const inRound = mainPath.filter((m) => m.round === round);
            const roundByes = round === firstRound ? byes : [];
            return (
              <div key={round} className="flex flex-col">
                <div className="mb-2 text-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-chalk-300">
                    {ROUND_LABEL(round, totalRounds)}
                  </div>
                  <div className="text-[10px] text-chalk-600">
                    Week {playoffWeekStart + round - 1}
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-around gap-4">
                  {roundByes.map((b) => (
                    <ByeCard key={b.slug} name={nameOf(b.slug)} seed={seedOf(b.slug)} />
                  ))}
                  {inRound.map((m) => (
                    <MatchCard
                      key={m.matchId}
                      match={m}
                      label={isFinal(m) ? finalLabel : undefined}
                      nameOf={nameOf}
                      seedOf={seedOf}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {sideGames.length ? (
        <div className="mt-5">
          <div className="eyebrow mb-2 text-[10px]">Placement games</div>
          <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-4">
              {sideGames.map((m) => (
                <MatchCard
                  key={m.matchId}
                  match={m}
                  label={m.placesFor ? `${ordinal(m.placesFor[0])} place` : undefined}
                  nameOf={nameOf}
                  seedOf={seedOf}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
