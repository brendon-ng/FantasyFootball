import type { RecordMark } from "@/lib/record-marks";

/**
 * A record this game entered, as a chip.
 *
 * Tone carries the direction — green for a peak, red for a floor — and the
 * title spells the rank out, since "#3 low" is terse.
 *
 * SHARED BY THE STRIP AND THE MATCHUP PAGE. Both show the same claim about the
 * same game, decided by the same `useMatchupSettled` tier, so they must look
 * the same; a card that says "#2 low" and a page that renders it differently
 * reads as two different facts.
 */
export function RecordChip({ mark }: { mark: RecordMark }) {
  return (
    <span
      title={mark.full}
      className={`rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wide ${
        mark.tone === "good"
          ? "border-accent-dim/60 bg-accent/10 text-accent"
          : "border-loss/50 bg-loss/10 text-loss"
      }`}
    >
      {mark.short}
    </span>
  );
}
