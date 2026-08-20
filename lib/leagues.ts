/**
 * The league registry.
 *
 * Every league this site serves is a directory under `config/leagues/<slug>/`
 * and `data/<slug>/`. Adding one is a config change, not a code change — which
 * is the whole point of the multi-league layout.
 *
 * `slug` is load-bearing: it is the URL segment, the data directory, and the
 * key every owner, player and matchup URL sits beneath. It must not change once
 * published.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface LeagueFeatures {
  /** Keeper contracts, the keeper tracker, keeper history. */
  keepers: boolean;
  /** ADP capture, and the value column that depends on it. */
  adp: boolean;
  /** Pre-Sleeper seasons imported from archived ESPN pages. */
  espnImport: boolean;
  /** The lowest-scoring team of each regular-season week does a punishment. */
  weeklyLowPunishment: boolean;
}

export interface LeagueConfig {
  slug: string;
  name: string;
  shortName: string;
  sport: string;
  features: LeagueFeatures;
  anchorUserId: string;
  knownLeagueIds: Record<string, string>;
  /** Apps Script `/exec` URL fronting this league's sheet; empty means mock. */
  appsScriptEndpoint?: string;
  owners: Array<{
    slug?: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    active: boolean;
    espnNames?: string[];
  }>;
}

const ROOT = process.cwd();
export const LEAGUES_DIR = join(ROOT, "config", "leagues");

/** Absolute path to a league's data directory. */
export const leagueDataDir = (slug: string) => join(ROOT, "data", slug);
/** Absolute path to a league's config directory. */
export const leagueConfigDir = (slug: string) => join(LEAGUES_DIR, slug);

/** Every configured league, ordered by slug so builds are deterministic. */
export function listLeagues(): LeagueConfig[] {
  if (!existsSync(LEAGUES_DIR)) return [];
  return readdirSync(LEAGUES_DIR)
    .filter((d) => existsSync(join(LEAGUES_DIR, d, "league.json")))
    .sort()
    .map((d) => getLeague(d));
}

export function getLeague(slug: string): LeagueConfig {
  const path = join(LEAGUES_DIR, slug, "league.json");
  if (!existsSync(path)) throw new Error(`No league config at ${path}`);
  const cfg = JSON.parse(readFileSync(path, "utf8")) as LeagueConfig;
  if (cfg.slug !== slug) {
    throw new Error(`config/leagues/${slug}/league.json declares slug "${cfg.slug}" — they must match`);
  }
  return cfg;
}

export const leagueSlugs = (): string[] => listLeagues().map((l) => l.slug);
