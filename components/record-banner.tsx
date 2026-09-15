import Link from "next/link";

/**
 * The "Record book" banner a matchup page carries when the game made a list.
 *
 * ONE RENDERER FOR BOTH STATES, like `LineupPanel` beside it. An archived game
 * reads its marks out of derived data and a live one computes them against the
 * archive's cut lines, but the claim is the same claim and must look the same —
 * a reader should not have to notice which kind of page they are on.
 *
 * Deliberately NOT the strip's `RecordChip`. That one is 9px and sits in a card
 * the width of a thumb; this is a banner with room to name who did it.
 */

export interface RecordBannerItem {
  /** e.g. "#3 highest score". */
  short: string;
  /** Full sentence, for the tooltip. */
  full: string;
  tone: "good" | "bad";
  /**
   * Who it was, in lighter type after the label — a player, or "Jake def. Sam".
   * A whole-game record names BOTH sides: one name is only half the fact about
   * a blowout or a combined total.
   */
  detail?: string | null;
  /** Appended to the tooltip, where `detail` is too long for the chip. */
  titleSuffix?: string;
  /** The record-book list this belongs to, so the chip can link into it. */
  href?: string;
}

export function RecordBanner({ items }: { items: RecordBannerItem[] }) {
  if (!items.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/35 bg-gold/[0.07] px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gold">
        Record book
      </span>
      {items.map((f, i) => {
        const cls = `rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
          f.tone === "bad"
            ? "border-loss/40 bg-loss/10 text-loss"
            : "border-gold/40 bg-gold/10 text-gold"
        }`;
        const body = (
          <>
            {f.short}
            {f.detail ? <span className="ml-1 font-normal opacity-80">{f.detail}</span> : null}
          </>
        );
        const title = `${f.full}${f.titleSuffix ?? ""}`;
        // LINKED WHERE THE LIST IS KNOWN. A chip names a record and the obvious
        // question is "against what?", which is a page away — the fragment
        // lands on the list itself rather than the top of the record book.
        return f.href ? (
          <Link
            key={i}
            href={f.href}
            title={title}
            className={`${cls} transition-opacity hover:opacity-80`}
          >
            {body}
          </Link>
        ) : (
          <span key={i} title={title} className={cls}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
