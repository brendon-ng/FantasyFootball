import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { IdentityControl, IdentityProvider } from "@/components/identity";
import { Nav } from "@/components/nav";
import { getConfig, getOwners, getSeasons } from "@/lib/data";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Den Ops Fantasy Football",
  description:
    "League hub for the Den Ops Super League — standings, keeper contracts, and league history.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cfg = getConfig();
  const latest = Math.max(...Object.keys(cfg.knownLeagueIds).map(Number));
  const seasonCount = getSeasons().filter((s) => s.finalized).length;
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
        <IdentityProvider owners={navOwners}>
        <Nav subtitle={`${latest} SEASON`} owners={navOwners} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
        <footer className="mt-8 border-t border-ink-600 px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 text-[11px] text-chalk-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Den Ops Super League · {seasonCount} completed season
              {seasonCount === 1 ? "" : "s"} on record
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <IdentityControl owners={navOwners} />
              <span>Reference only — manage your team in Sleeper. Data via the Sleeper API.</span>
            </span>
          </div>
        </footer>
        </IdentityProvider>
      </body>
    </html>
  );
}
