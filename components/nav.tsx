"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IdentityBadge, useIdentity } from "@/components/identity";
import type { LeagueFeatures } from "@/lib/data";

/**
 * Site nav. Horizontal and scrollable on mobile, so it never wraps or collapses
 * into a hamburger — with a handful of destinations a drawer costs a tap for
 * nothing.
 *
 * Identity lives in a single circular badge at the end — one control, always
 * visible, in every state.
 */
const LINKS: Array<{ href: string; label: string; needs?: keyof LeagueFeatures }> = [
  { href: "/", label: "League" },
  { href: "/keepers/", label: "Keepers", needs: "keepers" },
  { href: "/history/", label: "History" },
  { href: "/records/", label: "Records" },
];

export interface NavOwner {
  slug: string;
  name: string;
}

export function Nav({
  subtitle,
  owners,
  wordmark,
  features,
}: {
  subtitle: string;
  owners: NavOwner[];
  wordmark: string;
  features: LeagueFeatures;
}) {
  const pathname = usePathname();
  const links = LINKS.filter((l) => !l.needs || features[l.needs]);
  const { identity, ready } = useIdentity();
  const mySlug = identity.kind === "owner" ? identity.slug : null;

  return (
    <header className="sticky top-0 z-50 border-b border-ink-600 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-baseline gap-2.5">
          <span className="text-base font-bold tracking-tight text-chalk-100 transition-colors group-hover:text-accent sm:text-lg">
            {wordmark}
          </span>
          <span className="hidden text-[11px] font-medium tracking-wide text-chalk-600 sm:inline">
            {subtitle}
          </span>
        </Link>

        <nav className="no-scrollbar -mx-1 flex items-center gap-0.5 overflow-x-auto">
          {links.map((l) => {
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

          {/* data-me-ignore, not just exempt: this is chrome representing you,
              so it should get neither the tint nor the recolour. It styles
              itself. */}
          {ready && mySlug ? (
            <Link
              href={`/owners/${mySlug}/`}
              data-me-ignore=""
              aria-current={pathname.startsWith(`/owners/${mySlug}/`) ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                pathname.startsWith(`/owners/${mySlug}/`)
                  ? "bg-ink-700 text-me"
                  : "text-me hover:bg-ink-700/60"
              }`}
            >
              My Team
            </Link>
          ) : null}

          <span className="ml-1.5 shrink-0">
            <IdentityBadge owners={owners} />
          </span>
        </nav>
      </div>
    </header>
  );
}
