/**
 * Shared machinery for reading this league's ESPN history.
 *
 * Both importers — lineups and drafts — need the same three things: a URL, a way
 * to turn an ESPN player into a Sleeper id, and a way to turn an ESPN team into
 * an owner slug. Two copies of the player matcher would be two sets of matching
 * rules, and they would drift the first time one of them was taught a new case.
 */

import { join } from "node:path";

import { CACHE_DIR, ROOT, log, readJson } from "./io.ts";

export const API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";
export const PRO_TEAM: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT",
  24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
  33: "BAL", 34: "HOU",
};
export interface EspnPlayer {
  id: number;
  fullName: string;
  defaultPositionId?: number;
  proTeamId?: number;
}

export interface LeagueFile {
  /**
   * ESPN league id PER SEASON.
   *
   * Not one id: ESPN mints a new league each year the same way Sleeper does, and
   * this league's 2019 and 2020 ids are unrelated. Mirrors `knownLeagueIds`.
   */
  espnLeagueIds?: Record<string, string | number>;
  owners?: Array<{
    slug: string;
    firstName: string;
    lastName: string;
    espnNames?: string[];
    /**
     * ESPN member ids (SWIDs) belonging to this person, braces included.
     *
     * PREFERRED OVER THE NAME, because a name is not always there and is not
     * always unique. One league has a member whose ESPN account carries only a
     * display name, so the name tier has nothing to match on; another has one
     * person holding TWO accounts, which map to a single slug here.
     */
    espnIds?: string[];
  }>;
}

export interface SleeperPlayer {
  /** Sleeper's own cross-reference to ESPN. Present for ~55% of the map. */
  espn_id?: number | string | null;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  team?: string | null;
  search_full_name?: string;
}

export const ESPN_POS: Record<number, string> = {
  1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF",
};

/**
 * A name reduced to what two databases can agree on.
 *
 * Sleeper publishes `search_full_name` in exactly this shape, so matching against
 * it is a lookup rather than a fuzzy comparison. Suffixes go because the two
 * disagree constantly — "DJ Chark Jr." against "D.J. Chark" is one player.
 */
export const normalise = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

export interface Index {
  /** ESPN player id -> Sleeper id. The exact join; everything else is a guess. */
  byEspn: Map<string, string>;
  byName: Map<string, Array<{ id: string; p: SleeperPlayer }>>;
  /** "gainwell|RB" -> candidates. Last resort, for nicknames. */
  byLastPos: Map<string, Array<{ id: string; p: SleeperPlayer }>>;
}

/**
 * Sleeper's whole player DB, including everyone who has since retired.
 *
 * TWO INDEXES, AND THE ID ONE WINS. Sleeper publishes `espn_id` on about 55% of
 * its map, which makes the join exact for those players and immune to the thing
 * name matching keeps getting wrong: people are not stored under the name they
 * played under. Nyheim Hines is "Nyheim Miller-Hines", Will Fuller V is "William
 * Fuller", Robby Anderson is under a later name again — three misses in a single
 * week of 2019, all silently filed as unknown players.
 */
export function sleeperIndex(): Index {
  const path = join(CACHE_DIR, "players-nfl.json");
  const all = readJson<Record<string, SleeperPlayer>>(path);
  if (!all) {
    throw new Error(
      `No cached Sleeper player map at ${path}. Run \`npm run sync\` once to fetch it.`,
    );
  }
  const byEspn = new Map<string, string>();
  const byName = new Map<string, Array<{ id: string; p: SleeperPlayer }>>();
  const byLastPos = new Map<string, Array<{ id: string; p: SleeperPlayer }>>();
  for (const [id, p] of Object.entries(all)) {
    const last = normalise(p.last_name ?? "");
    if (last && p.position) {
      const k = `${last}|${p.position}`;
      const b = byLastPos.get(k) ?? [];
      b.push({ id, p });
      byLastPos.set(k, b);
    }
    if (p.espn_id) byEspn.set(String(p.espn_id), id);
    // Both spellings indexed: `search_full_name` keeps suffixes ("willfullerv")
    // while `normalise` strips them, and either can be the one that matches.
    for (const key of [
      p.search_full_name,
      normalise(p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`),
    ]) {
      if (!key) continue;
      const bucket = byName.get(key) ?? [];
      if (!bucket.some((b) => b.id === id)) bucket.push({ id, p });
      byName.set(key, bucket);
    }
  }
  return { byEspn, byName, byLastPos };
}

export interface MatchResult {
  id: string;
  matched: boolean;
  /** How it was matched, for the run summary. */
  via: "espn-id" | "defence" | "name" | "nickname" | "none";
  /** Set when the two databases spell the player differently. */
  renamed?: string;
  /**
   * Set when more than one Sleeper player survived every filter.
   *
   * The dangerous case, and the one a rename report cannot show: two different
   * people with the SAME name and position, where the tie is broken arbitrarily
   * and the names agree, so nothing looks wrong.
   */
  ambiguous?: string;
}

/**
 * The Sleeper id for an ESPN player.
 *
 * Position narrows an ambiguous name before team does, because a player changes
 * team far more often than position and this data spans seven years. Where the
 * name is unique the extra checks never run.
 */
export function matchPlayer(pl: EspnPlayer, idx: Index): MatchResult {
  const pos = ESPN_POS[pl.defaultPositionId ?? -1] ?? null;

  // A defence is a TEAM, not a person: Sleeper keys it on the abbreviation, so
  // there is nothing to name-match and the pro-team id answers it exactly.
  if (pos === "DEF") {
    const abbr = PRO_TEAM[pl.proTeamId ?? -1];
    if (abbr) return { id: abbr, matched: true, via: "defence" };
  }

  const exact = idx.byEspn.get(String(pl.id));
  if (exact) return { id: exact, matched: true, via: "espn-id" };

  const cands = idx.byName.get(normalise(pl.fullName)) ?? [];
  if (cands.length) {
    // Position narrows an ambiguous name before team does: a player changes team
    // far more often than position, and this data spans seven years.
    const byPos = pos ? cands.filter((c) => c.p.position === pos) : [];
    const pool = byPos.length ? byPos : cands;
    const team = PRO_TEAM[pl.proTeamId ?? -1];
    const byTeam = team ? pool.filter((c) => c.p.team === team) : [];
    const hit = byTeam[0] ?? pool[0];
    const tied = byTeam.length > 1 || (!byTeam.length && pool.length > 1);
    return {
      id: hit.id,
      matched: true,
      via: "name",
      renamed: label(pl, hit.p),
      ambiguous: tied
        ? `${pl.fullName} (${pos ?? "?"}, ${team ?? "?"}) -> chose ${hit.id} from ` +
          (byTeam.length > 1 ? byTeam : pool).map((c) => `${c.id}:${c.p.position}/${c.p.team}`).join(", ")
        : undefined,
    };
  }

  // LAST RESORT: surname plus position, and only when that is UNIQUE and the
  // first initial agrees. Catches the nickname case the other two tiers cannot —
  // Sleeper's "Kenny Gainwell" against ESPN's "Kenneth" — without opening the
  // door to matching two different people who happen to share a surname. Bounded
  // this tightly because a wrong match here is invisible: the points still sum to
  // the team score, they are just credited to the wrong player.
  if (pos) {
    const surname = normalise(pl.fullName.split(/\s+/).slice(1).join(" "));
    const cands2 = (idx.byLastPos.get(`${surname}|${pos}`) ?? []).filter(
      (c) => normalise(c.p.first_name ?? "")[0] === normalise(pl.fullName)[0],
    );
    if (cands2.length === 1) {
      return { id: cands2[0].id, matched: true, via: "nickname", renamed: label(pl, cands2[0].p) };
    }
  }
  return { id: `espn-${pl.id}`, matched: false, via: "none" };
}

/** "Kenneth Gainwell -> Kenny Gainwell", or nothing when they agree. */
export function label(pl: EspnPlayer, sp: SleeperPlayer): string | undefined {
  const theirs = sp.full_name ?? `${sp.first_name ?? ""} ${sp.last_name ?? ""}`.trim();
  return normalise(theirs) === normalise(pl.fullName) ? undefined : `${pl.fullName} -> ${theirs}`;
}


/**
 * Cookies for a PRIVATE league, read from a gitignored `.espn-auth.json`.
 *
 * A public league needs none of this and never notices — the header is only sent
 * when the file exists. ESPN's visibility is PER SEASON, so a league can be
 * readable this year and 401 for every year before it, which is the case this
 * exists for.
 *
 * NEVER COMMITTED, and deliberately a file rather than an argument: `espn_s2` is
 * a session token for the whole ESPN account, so it should not end up in a shell
 * history or a process list.
 */
let auth: Record<string, string> | null | undefined;

export function espnAuth(): Record<string, string> {
  if (auth === undefined) {
    const file = readJson<{ espn_s2?: string; SWID?: string }>(join(ROOT, ".espn-auth.json"));
    auth =
      file?.espn_s2 && file?.SWID
        ? { Cookie: `espn_s2=${file.espn_s2}; SWID=${file.SWID}` }
        : null;
    log.info(auth ? "using .espn-auth.json (private league)" : "no .espn-auth.json — public access only");
  }
  return auth ?? {};
}

/** One view of one ESPN season. */
export async function fetchEspn<T>(
  leagueId: string | number,
  season: number,
  query: string,
): Promise<T> {
  const url = `${API}/${season}/segments/0/leagues/${leagueId}?${query}`;
  const res = await fetch(url, { headers: espnAuth() });
  if (res.status === 401) {
    throw new Error(
      `ESPN ${season}: 401 for ${query}. That season is private — add .espn-auth.json ` +
        `with espn_s2 and SWID cookies from a logged-in browser, or make the season public.`,
    );
  }
  if (!res.ok) throw new Error(`ESPN ${season}: HTTP ${res.status} for ${query}`);
  return (await res.json()) as T;
}

/**
 * Every player ESPN knew about in a season, by its own id.
 *
 * The draft payload carries a bare `playerId` and no name, so without this the
 * name-matching tiers are blind and every player Sleeper lacks an `espn_id` for
 * would be unresolvable. The default page size is 50; the filter header lifts it.
 */
export async function espnPlayerUniverse(season: number): Promise<Map<number, EspnPlayer>> {
  const res = await fetch(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=0&view=players_wl`,
    { headers: { ...espnAuth(), "x-fantasy-filter": JSON.stringify({ players: { limit: 5000 } }) } },
  );
  if (!res.ok) throw new Error(`ESPN ${season} players: HTTP ${res.status}`);
  const list = (await res.json()) as EspnPlayer[];
  return new Map(list.map((p) => [p.id, p]));
}

/**
 * ESPN team id -> owner slug, via the member records.
 *
 * Matched on REAL NAMES, not team names: a team name changes mid-season and is
 * not a stable key, while the person behind it does not. Throws rather than
 * dropping a team, because a silently missing owner would look like a team that
 * simply did not play.
 */
export function ownerByTeam(
  data: { teams: Array<{ id: number; primaryOwner?: string; owners?: string[] }>; members?: Array<{ id: string; firstName?: string; lastName?: string }> },
  cfg: LeagueFile | null,
  where: string,
): Map<number, string> {
  return new Map([...ownersByTeam(data, cfg, where)].map(([id, slugs]) => [id, slugs[0]]));
}

/**
 * ESPN team id -> EVERY owner slug credited with it, primary first.
 *
 * CO-OWNERS ARE FIRST-CLASS on this site, so a shared team has to name all of
 * them; taking only `primaryOwner` silently drops the other person from every
 * all-time table. Resolution is by ESPN member id first and by name second —
 * see `espnIds` for why the id tier has to come first.
 */
export function ownersByTeam(
  data: { teams: Array<{ id: number; primaryOwner?: string; owners?: string[] }>; members?: Array<{ id: string; firstName?: string; lastName?: string }> },
  cfg: LeagueFile | null,
  where: string,
): Map<number, string[]> {
  const byName = new Map<string, string>();
  const bySwid = new Map<string, string>();
  for (const o of cfg?.owners ?? []) {
    byName.set(normalise(`${o.firstName} ${o.lastName}`), o.slug);
    for (const alias of o.espnNames ?? []) byName.set(normalise(alias), o.slug);
    for (const id of o.espnIds ?? []) bySwid.set(id.toUpperCase(), o.slug);
  }
  const members = new Map(
    (data.members ?? []).map((m) => [m.id, normalise(`${m.firstName ?? ""} ${m.lastName ?? ""}`)]),
  );
  const resolve = (swid: string): string | undefined =>
    bySwid.get(swid.toUpperCase()) ?? byName.get(members.get(swid) ?? "\u0000");

  const out = new Map<number, string[]>();
  for (const t of data.teams) {
    // Primary first so the franchise key is stable, then anyone else on the team.
    const ids = [t.primaryOwner ?? t.owners?.[0] ?? "", ...(t.owners ?? [])];
    const slugs: string[] = [];
    for (const id of ids) {
      const slug = resolve(id);
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
    if (!slugs.length) {
      const key = members.get(t.primaryOwner ?? t.owners?.[0] ?? "");
      throw new Error(
        `${where}: ESPN team ${t.id} has no owner in config (member "${key ?? "?"}"). ` +
          `Add them to league.json, with espnNames or espnIds if the label differs.`,
      );
    }
    out.set(t.id, slugs);
  }
  return out;
}
