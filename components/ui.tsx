import Link from "next/link";
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
    <section
      className={`rounded-xl border border-ink-600 bg-ink-800/80 ${className}`}
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
}: {
  title: string;
  meta?: ReactNode;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <header className="flex items-baseline justify-between gap-3 border-b border-ink-600 px-4 py-3 sm:px-5">
      <div className="flex items-baseline gap-3">
        <h2 className="eyebrow">{title}</h2>
        {meta ? <span className="text-xs text-chalk-600 tabular">{meta}</span> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="text-xs font-medium text-chalk-500 transition-colors hover:text-accent"
        >
          {hrefLabel} <span aria-hidden>→</span>
        </Link>
      ) : null}
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
      <div className={`tabular text-xl font-semibold leading-none sm:text-2xl ${toneClass}`}>
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
