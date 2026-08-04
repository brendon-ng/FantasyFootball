import Link from "next/link";

import { Tip } from "@/components/tooltip";
import type { ReactNode } from "react";

/** Card surface used for every panel on the site. */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    // overflow-hidden clips full-bleed children (row backgrounds, divide-y
    // borders, the last row in a list) to the rounded corners. Without it the
    // final row's square corners bleed past the border and read as a cut-off.
    <section
      className={`overflow-hidden rounded-xl border border-ink-600 bg-ink-800/80 ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * Section header. `href` turns the title into a link out to the fuller page,
 * which is how the home page stays a summary rather than a dumping ground.
 */
export function PanelHeader({
  title,
  meta,
  href,
  hrefLabel = "View all",
  legend,
}: {
  title: string;
  meta?: ReactNode;
  href?: string;
  hrefLabel?: string;
  /**
   * Explains the columns for panels whose rows are too compact to carry their
   * own header row — the keeper cards, mainly.
   */
  legend?: ReactNode;
}) {
  return (
    <header className="border-b border-ink-600 px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="eyebrow">{title}</h2>
          {meta ? <span className="text-xs text-chalk-600 tabular">{meta}</span> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="shrink-0 text-xs font-medium text-chalk-500 transition-colors hover:text-accent"
          >
            {hrefLabel} <span aria-hidden>→</span>
          </Link>
        ) : null}
      </div>
      {legend ? <div className="mt-1.5 text-[11px] text-chalk-600">{legend}</div> : null}
    </header>
  );
}

export function LiveBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-dim bg-accent/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {label}
    </span>
  );
}

/** Medal colouring for finishing places; null for everything outside the top 3. */
export function placeColor(place: number | null | undefined): string {
  if (place === 1) return "text-gold";
  if (place === 2) return "text-silver";
  if (place === 3) return "text-bronze";
  return "text-chalk-300";
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "accent" | "gold";
}) {
  const toneClass =
    tone === "accent" ? "text-accent" : tone === "gold" ? "text-gold" : "text-chalk-100";
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-3">
      <div className="eyebrow mb-1.5 text-[10px]">{label}</div>
      <div
        // A gold or accent tile already encodes something; identity must not
        // repaint it.
        data-me-exempt={tone === "default" ? undefined : ""}
        className={`tabular text-xl font-semibold leading-none sm:text-2xl ${toneClass}`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-chalk-600">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-chalk-600 sm:px-5">{children}</div>
  );
}

/**
 * A terse postseason label, spelled out for the narrow layouts.
 *
 * The wide layouts show these in a fixed-width chip beside a bracket, where "3RD
 * PLACE" is unambiguous. On a phone the label stands alone on its own line, where
 * it reads as a FINISH rather than the game that decided it — so placement labels
 * gain "matchup" there. Named labels ("Championship", "Toilet bowl") already say
 * what they are.
 */
export const verboseKind = (kind: string): string =>
  /^\d+(st|nd|rd|th) place$/i.test(kind) ? `${kind} matchup` : kind;

export const fmt = {
  pts: (n: number) => n.toFixed(2),
  pts1: (n: number) => n.toFixed(1),
  record: (w: number, l: number, t: number) => (t ? `${w}-${l}-${t}` : `${w}-${l}`),
  pct: (n: number) => (n * 100).toFixed(1) + "%",
  ordinal: (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
};

/**
 * Column header for the flex-row "tables" used throughout the site.
 *
 * These lists aren't <table>s (they need links, bars, and pills per cell), so
 * headers can't come for free — the header cell must repeat the same width class
 * as the row cell below it. Keeping both in one place per list is the trade-off
 * for rows that can hold arbitrary content.
 */
export function ListHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-ink-600 bg-ink-850/60 px-4 py-1.5 sm:px-5">
      {children}
    </div>
  );
}

/**
 * A header cell. `hint` becomes a native tooltip — used for anything a newcomer
 * wouldn't decode, like PF or the keeper value delta.
 */
export function Col({
  children,
  hint,
  className = "",
}: {
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  if (!hint) return <span className={`eyebrow text-[10px] ${className}`}>{children}</span>;
  return (
    <span className={`eyebrow text-[10px] ${className}`}>
      <Tip text={hint}>{children}</Tip>
    </span>
  );
}

/** Inline abbreviation with an explanatory tooltip, for jargon inside prose. */
export function Abbr({ short, long }: { short: string; long: string }) {
  return <Tip text={long}>{short}</Tip>;
}
