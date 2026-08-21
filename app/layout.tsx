import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { IdentityControl, IdentityProvider } from "@/components/identity";
import { Nav } from "@/components/nav";
import { StickyParams } from "@/components/sticky-params";
import { getConfig, getLeagueRefs, getOwners, getSeasons, leagueAvatar } from "@/lib/data";
import { BackTrail } from "@/components/back-link";
import { leaguePickerHref, withBasePath } from "@/lib/base-path";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Built from config, not literal, so a second league does not inherit the
// first one's name in its <title>.
export function generateMetadata(): Metadata {
  const cfg = getConfig();
  const extra = cfg.features.keepers ? "keeper contracts, " : "";
  const avatar = leagueAvatar();
  return {
    title: `${cfg.shortName} Fantasy Football`,
    description: `League hub for the ${cfg.name} — standings, ${extra}and league history.`,
    // The league's own Sleeper avatar as the favicon, so two leagues served from
    // one repo are told apart in a tab strip. `app/favicon.ico` was deleted: the
    // file convention is per BUILD-TREE, not per build, so it could only ever
    // give both leagues the same icon — and it would also emit a competing
    // <link rel="icon"> alongside this one.
    icons: avatar ? { icon: withBasePath(avatar) } : undefined,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cfg = getConfig();
  const avatar = leagueAvatar();
  // EVERY season the league has, not just its Sleeper ones. Reading
  // `knownLeagueIds` alone gave an ESPN-only league an empty list, and
  // `Math.max()` of nothing is -Infinity — which is what the header printed.
  const latest = Math.max(...Object.keys(getLeagueRefs()).map(Number));
  const seasonCount = getSeasons().filter((s) => s.finalized).length;
  // Null in dev, where only one league is built and no picker exists.
  const pickerHref = leaguePickerHref();
  // Current owners only — the dropdown is a way to reach a live team, and
  // former owners would be dead weight in it. They stay in the all-time table.
  const navOwners = getOwners()
    .filter((o) => o.active)
    .map((o) => ({ slug: o.slug, name: o.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      {/*
       * `min-h-svh`, NOT `h-full` on <html> with `min-h-full` here.
       *
       * A PERCENTAGE HEIGHT ON THE ROOT RESOLVES AGAINST THE LARGE VIEWPORT on
       * iOS — the one with the browser toolbars collapsed — so `height: 100%`
       * made the document permanently taller than the screen while the address
       * bar was showing, and the surplus was dead scroll below the footer.
       *
       * `svh` is the SMALL viewport: the visible area with the toolbars out, the
       * smallest it ever gets. As a floor that means the page can never be
       * taller than what is on screen, so there is nothing to scroll into. `dvh`
       * would track the toolbars instead, but it changes value mid-scroll and
       * would shuffle the footer while you read.
       */}
      <body className="flex min-h-svh flex-col bg-ink-900 text-chalk-100">
        <StickyParams />
        <IdentityProvider owners={navOwners}>
        <Nav
          subtitle={`${latest} SEASON`}
          owners={navOwners}
          wordmark={cfg.shortName.toUpperCase()}
          features={cfg.features}
          avatarSrc={avatar ? withBasePath(avatar) : null}
        />
        <BackTrail />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
        <footer className="mt-8 border-t border-ink-600 px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 text-[11px] text-chalk-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {cfg.name} · {seasonCount} completed season
              {seasonCount === 1 ? "" : "s"} on record
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <IdentityControl owners={navOwners} />
              {pickerHref ? (
                <a href={pickerHref} className="transition-colors hover:text-accent">
                  All leagues
                </a>
              ) : null}
              <span>Reference only — manage your team in Sleeper. Data via the Sleeper API.</span>
            </span>
          </div>
        </footer>
        </IdentityProvider>
      </body>
    </html>
  );
}
