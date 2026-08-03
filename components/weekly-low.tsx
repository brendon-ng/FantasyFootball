import { Tip } from "@/components/tooltip";

/**
 * Marks the lowest-scoring team of a regular-season week.
 *
 * Only rendered where `features.weeklyLowPunishment` is on — leagues that attach
 * a punishment to finishing last that week. `getWeeklyLowKeys()` returns an empty
 * set otherwise, so callers do not each re-check the flag.
 *
 * Two sizes because the same fact appears at very different scales: a full chip
 * beside a scoreboard, and a bare glyph in a dense list where a word of text
 * would push the score out of column.
 */
export function WeeklyLowBadge({ size = "chip" }: { size?: "chip" | "glyph" }) {
  const text =
    "Lowest score in the league that week — this team owed the weekly punishment.";

  if (size === "glyph") {
    return (
      <Tip text={text} className="shrink-0 text-loss">
        <span aria-label="Lowest score of the week">🚽</span>
      </Tip>
    );
  }
  return (
    <Tip
      text={text}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-loss/40 bg-loss/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-loss"
    >
      <span aria-hidden>🚽</span> Weekly low
    </Tip>
  );
}
