/**
 * How much football is left, per NFL team.
 *
 * `nfl-schedule.ts` says whether a team is pre / in / post, which is all the
 * record chips and the lineup states need. A live PROJECTION needs the clock
 * itself — a player in the first quarter has most of his points ahead of him
 * and one in the fourth does not — and that only exists on Sleeper's scores
 * feed, the same one their own app reads.
 *
 *   /scores/nfl/regular/<season>/<week>   ~15KB, one request for the week
 *
 * Each entry carries `metadata` with `quarter`, `time_remaining`, `is_over`,
 * `home_team` and `away_team`, plus a lot this does not want. Unauthenticated
 * and `access-control-allow-origin: *`, like everything else here.
 *
 * FETCHED ONLY WHERE A LIVE PROJECTION IS SHOWN — the matchup page of a game in
 * progress — and never under a phase mock. A reader outside that never
 * downloads it.
 *
 * FAILS SOFT TO NULL, meaning "no opinion". The caller falls back to showing no
 * win probability, which is the honest answer when the clock is unknown.
 */

import { secondsRemaining } from "../win-probability.ts";

import { fetchRetry } from "./retry.ts";

const SCORES = "https://api.sleeper.app/scores/nfl/regular";

interface RawScore {
  metadata?: {
    home_team?: string;
    away_team?: string;
    quarter?: string | null;
    time_remaining?: string | null;
    is_over?: boolean | null;
  } | null;
}

/** Cached per season+week: both sides of a matchup ask the same question. */
const cache = new Map<string, Promise<Record<string, number> | null>>();

/** NFL team -> seconds left in its game this week. */
export function fetchNflClock(
  season: number,
  week: number,
): Promise<Record<string, number> | null> {
  const key = `${season}:${week}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async () => {
    const res = await fetchRetry(`${SCORES}/${season}/${week}`);
    if (!res?.ok) return null;
    let raw: RawScore[] | Record<string, RawScore>;
    try {
      raw = (await res.json()) as RawScore[] | Record<string, RawScore>;
    } catch {
      return null;
    }
    const games = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    const out: Record<string, number> = {};
    for (const g of games) {
      const m = g?.metadata;
      if (!m) continue;
      const left = secondsRemaining(m);
      for (const team of [m.home_team, m.away_team]) if (team) out[team] = left;
    }
    return Object.keys(out).length ? out : null;
  })();

  cache.set(key, p);
  return p;
}
