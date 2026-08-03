"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Site nav. Horizontal and scrollable on mobile, so it never wraps or collapses
 * into a hamburger — with four destinations a drawer would cost a tap for nothing.
 */
const LINKS = [
  { href: "/", label: "League" },
  { href: "/keepers/", label: "Keepers" },
  { href: "/history/", label: "History" },
  { href: "/records/", label: "Records" },
];

export function Nav({ subtitle }: { subtitle: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-ink-600 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2.5 shrink-0">
          <span className="text-base font-bold tracking-tight text-chalk-100 transition-colors group-hover:text-accent sm:text-lg">
            DEN OPS
          </span>
          <span className="hidden text-[11px] font-medium tracking-wide text-chalk-600 sm:inline">
            {subtitle}
          </span>
        </Link>

        <nav className="no-scrollbar -mx-1 flex items-center gap-0.5 overflow-x-auto">
          {LINKS.map((l) => {
            // `trailingSlash: true` means every route ends in "/", so an exact
            // match is correct for "/" and a prefix match for the rest.
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                  active
                    ? "bg-ink-700 text-chalk-100"
                    : "text-chalk-500 hover:bg-ink-700/60 hover:text-chalk-300"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
