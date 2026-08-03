"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Site nav. Horizontal and scrollable on mobile, so it never wraps or collapses
 * into a hamburger — with a handful of destinations a drawer costs a tap for
 * nothing.
 */
const LINKS = [
  { href: "/", label: "League" },
  { href: "/keepers/", label: "Keepers" },
  { href: "/history/", label: "History" },
  { href: "/records/", label: "Records" },
];

export interface NavOwner {
  slug: string;
  name: string;
}

export function Nav({ subtitle, owners }: { subtitle: string; owners: NavOwner[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — a menu you can only dismiss by
  // re-clicking the trigger feels broken.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onOwnerPage = pathname.startsWith("/owners/");

  return (
    <header className="sticky top-0 z-50 border-b border-ink-600 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-baseline gap-2.5">
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

          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="menu"
              className={`flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                onOwnerPage || open
                  ? "bg-ink-700 text-chalk-100"
                  : "text-chalk-500 hover:bg-ink-700/60 hover:text-chalk-300"
              }`}
            >
              Teams
              <span
                aria-hidden
                className={`text-[8px] transition-transform ${open ? "rotate-180" : ""}`}
              >
                ▼
              </span>
            </button>

            {open ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1.5 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-ink-500 bg-ink-850 py-1 shadow-xl"
              >
                {owners.map((o) => {
                  const active = pathname.startsWith(`/owners/${o.slug}/`);
                  return (
                    <Link
                      key={o.slug}
                      href={`/owners/${o.slug}/`}
                      role="menuitem"
                      // Close on selection rather than reacting to the pathname
                      // in an effect, which would set state synchronously
                      // during the render pass that follows navigation.
                      onClick={() => setOpen(false)}
                      className={`block truncate px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-ink-700 text-accent"
                          : "text-chalk-300 hover:bg-ink-700/70 hover:text-chalk-100"
                      }`}
                    >
                      {o.name}
                    </Link>
                  );
                })}
                <div className="mt-1 border-t border-ink-600 pt-1">
                  <Link
                    href="/history/"
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-1.5 text-[11px] text-chalk-600 transition-colors hover:text-accent"
                  >
                    Former owners in the all-time table →
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  );
}
