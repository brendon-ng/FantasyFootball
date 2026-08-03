import Link from "next/link";

/**
 * An owner's honours, as physical-looking medals rather than a table.
 *
 * Deliberately NOT a chart. Four counts with no trend and no comparison have no
 * magnitude to encode — a bar chart of "1 title, 0 seconds" is noise. Medals
 * read instantly and each carries its season, which a count alone throws away.
 *
 * Every medal is labelled in text, so identity never rests on colour alone.
 */

export interface Honour {
  season: number;
  place: number;
}

const TIERS = [
  {
    place: 1,
    label: "Champion",
    icon: "🏆",
    ring: "border-gold/45",
    glow: "shadow-[0_0_18px_-6px_var(--color-gold)]",
    text: "text-gold",
  },
  {
    place: 2,
    label: "Runner-up",
    icon: "🥈",
    ring: "border-silver/35",
    glow: "",
    text: "text-silver",
  },
  {
    place: 3,
    label: "Third",
    icon: "🥉",
    ring: "border-bronze/35",
    glow: "",
    text: "text-bronze",
  },
] as const;

export function TrophyCase({
  honours,
  lastPlaces,
}: {
  honours: Honour[];
  /** Seasons finished dead last. Shown too — this league cares about it. */
  lastPlaces: number[];
}) {
  const byTier = TIERS.map((t) => ({
    ...t,
    seasons: honours.filter((h) => h.place === t.place).map((h) => h.season).sort(),
  }));

  const anything = byTier.some((t) => t.seasons.length) || lastPlaces.length;
  if (!anything) {
    return (
      <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
        No podium finishes yet.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 p-4 sm:p-5">
      {byTier.flatMap((tier) =>
        tier.seasons.map((season) => (
          <Link
            key={`${tier.place}-${season}`}
            href={`/history/${season}/`}
            title={`${tier.label} in ${season}`}
            className={`group flex w-[88px] flex-col items-center gap-0.5 rounded-xl border bg-ink-850 px-2 py-2.5 transition-colors hover:bg-ink-700/50 ${tier.ring} ${tier.glow}`}
          >
            <span className="text-xl leading-none" aria-hidden>
              {tier.icon}
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${tier.text}`}>
              {tier.label}
            </span>
            <span className="tabular text-sm font-bold text-chalk-100">{season}</span>
          </Link>
        )),
      )}

      {lastPlaces.sort().map((season) => (
        <Link
          key={`last-${season}`}
          href={`/history/${season}/`}
          title={`Finished last in ${season}`}
          className="group flex w-[88px] flex-col items-center gap-0.5 rounded-xl border border-loss/30 bg-ink-850 px-2 py-2.5 transition-colors hover:bg-ink-700/50"
        >
          <span className="text-xl leading-none" aria-hidden>
            🚽
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-loss">
            Last place
          </span>
          <span className="tabular text-sm font-bold text-chalk-100">{season}</span>
        </Link>
      ))}
    </div>
  );
}
