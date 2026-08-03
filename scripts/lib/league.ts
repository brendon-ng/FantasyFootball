import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ROOT, readJson } from "./io.ts";

/**
 * League resolution for the data scripts.
 *
 * Mirrors `lib/leagues.ts`, kept separate because the scripts run through Node's
 * type stripping and must not import anything that reaches the Next bundle.
 *
 * Scripts operate on ALL leagues by default. Passing `--league=<slug>` scopes a
 * run to one, which is what you want while adding a league or debugging it.
 */
export interface ScriptLeague {
  slug: string;
  name: string;
  sport: string;
  features: { keepers: boolean; adp: boolean; espnImport: boolean; weeklyLowPunishment: boolean };
  anchorUserId: string;
  knownLeagueIds: Record<string, string>;
}

export const LEAGUES_DIR = join(ROOT, "config", "leagues");
export const dataDir = (slug: string) => join(ROOT, "data", slug);
export const configDir = (slug: string) => join(LEAGUES_DIR, slug);

/** Every configured league, ignoring any `--league=` filter. */
export const allLeagues = (): ScriptLeague[] => resolveLeagues([]);

export function resolveLeagues(argv: string[]): ScriptLeague[] {
  const only = argv.find((a) => a.startsWith("--league="))?.split("=")[1];
  const slugs = existsSync(LEAGUES_DIR)
    ? readdirSync(LEAGUES_DIR).filter((d) => existsSync(join(LEAGUES_DIR, d, "league.json"))).sort()
    : [];

  const chosen = only ? slugs.filter((s) => s === only) : slugs;
  if (only && !chosen.length) {
    throw new Error(`No league "${only}". Known: ${slugs.join(", ") || "none"}`);
  }

  return chosen.map((slug) => {
    const cfg = readJson<ScriptLeague>(join(LEAGUES_DIR, slug, "league.json"));
    if (!cfg) throw new Error(`Unreadable config for ${slug}`);
    if (cfg.slug !== slug) throw new Error(`${slug}/league.json declares slug "${cfg.slug}"`);
    return cfg;
  });
}
