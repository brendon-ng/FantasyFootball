/**
 * Everything the player card shows, fetched from Sleeper in the browser.
 *
 * The same endpoints Sleeper's own player card calls, read out of its web
 * bundle and each checked for `access-control-allow-origin: *` before use:
 *
 *   api.sleeper.com/players/nfl/<id>                       bio
 *   api.sleeper.com/stats/nfl/player/<id>?season=…         season line + ranks
 *   api.sleeper.com/stats/nfl/player/<id>?…&grouping=week  game log
 *   api.sleeper.com/projections/nfl/player/<id>?…&grouping=week
 *   api.sleeper.com/players/nfl/research/regular/<s>/<w>   rostered / started %
 *   api.sleeper.com/players/nfl/<team>/depth_chart
 *   sleeper.com/graphql  get_player_news                    the news feed
 *
 * The news query needs no login — the GraphQL endpoint answers the preflight for
 * a JSON POST from any origin — and its `limit` reaches the whole history:
 * 981 items back to 2017 for Mahomes at `limit: 1000`.
 *
 * Every call is cached by key for the life of the page, so reopening a card is
 * free, and every call fails soft to null: a card with no news is still a card.
 *
 * Dependency-free: this ships to the browser.
 */

import { fetchRetry } from "./retry.ts";

const API = "https://api.sleeper.com";

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key) as Promise<T | null> | undefined;
  if (hit) return hit;
  const p = load().catch(() => null);
  cache.set(key, p);
  return p;
}

const getJson = async <T,>(url: string): Promise<T | null> => {
  const res = await fetchRetry(url);
  return res?.ok ? ((await res.json()) as T) : null;
};

export interface PlayerBio {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  fantasy_positions: string[] | null;
  team: string | null;
  number: number | null;
  birth_date: string | null;
  age: number | null;
  /** Inches, as a string. */
  height: string | null;
  weight: string | null;
  years_exp: number | null;
  college: string | null;
  status: string | null;
  injury_status: string | null;
  injury_body_part: string | null;
  injury_notes: string | null;
  metadata: { rookie_year?: string } | null;
}

export const fetchBio = (id: string) => cached(`bio:${id}`, () => getJson<PlayerBio>(`${API}/players/nfl/${id}`));

/** One week of a game log, or a season line. */
export interface StatEntry {
  week?: number;
  opponent?: string | null;
  is_away_team?: boolean | null;
  team?: string | null;
  stats: Record<string, number>;
}

/** Week -> entry. A week with no entry and no opponent is a bye. */
export const fetchWeeks = (id: string, season: number, kind: "stats" | "projections") =>
  cached(`${kind}:${id}:${season}`, async () => {
    const raw = await getJson<Record<string, StatEntry | null>>(
      `${API}/${kind}/nfl/player/${id}?season_type=regular&season=${season}&grouping=week`,
    );
    if (!raw) return null;
    const out: Record<number, StatEntry> = {};
    for (const [w, e] of Object.entries(raw)) if (e?.stats) out[Number(w)] = e;
    return out;
  });

/** The season line, which is where the position and overall ranks live. */
export const fetchSeasonLine = (id: string, season: number) =>
  cached(`season:${id}:${season}`, () =>
    getJson<StatEntry>(`${API}/stats/nfl/player/${id}?season_type=regular&season=${season}`),
  );

/** Player id -> share of Sleeper leagues rostering / starting him that week. */
export const fetchResearch = (season: number, week: number) =>
  cached(`research:${season}:${week}`, () =>
    getJson<Record<string, { owned?: number; started?: number }>>(
      `${API}/players/nfl/research/regular/${season}/${week}`,
    ),
  );

/** Depth-chart slot ("QB", "RB", "WR1"…) -> player ids in order. */
export const fetchDepthChart = (team: string) =>
  cached(`depth:${team}`, () => getJson<Record<string, string[]>>(`${API}/players/nfl/${team}/depth_chart`));

export interface NewsItem {
  published: number;
  source: string;
  source_key: string;
  metadata: {
    title?: string;
    description?: string;
    analysis?: string;
    url?: string;
  } | null;
}

/**
 * The newest `limit` items. There is no offset, so "more" is a bigger limit —
 * cheap, since the earlier pages are a prefix of the later ones.
 */
export const fetchNews = (id: string, limit: number) =>
  cached(`news:${id}:${limit}`, async () => {
    const res = await fetchRetry("https://sleeper.com/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationName: "get_player_news",
        variables: {},
        query: `query get_player_news { get_player_news(sport: "nfl", player_id: ${JSON.stringify(id)}, limit: ${Math.floor(limit)}) { metadata player_id published source source_key sport } }`,
      }),
    });
    if (!res?.ok) return null;
    const body = (await res.json()) as { data?: { get_player_news?: NewsItem[] } };
    return body.data?.get_player_news ?? null;
  });

/** Sleeper's CDN paths for a headshot and a team logo. */
export const headshotUrl = (id: string) =>
  /^[A-Z]{2,4}$/.test(id)
    ? `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/${id}.jpg`;
export const teamLogoUrl = (team: string) => `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
