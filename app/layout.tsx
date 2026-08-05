import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { IdentityControl, IdentityProvider } from "@/components/identity";
import { Nav } from "@/components/nav";
import { StickyParams } from "@/components/sticky-params";
import { getConfig, getOwners, getSeasons, leagueAvatar } from "@/lib/data";
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
  const latest = Math.max(...Object.keys(cfg.knownLeagueIds).map(Number));
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink-900 text-chalk-100">
        <StickyParams />
        <IdentityProvider owners={navOwners}>
        <Nav
          subtitle={`${latest} SEASON`}
          owners={navOwners}
          wordmark={cfg.shortName.toUpperCase()}
          features={cfg.features}
          avatarSrc={avatar ? withBasePath(avatar) : null}
        />
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
