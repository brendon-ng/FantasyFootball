/**
 * Typed Sleeper API client.
 *
 * Read-only, unauthenticated. Docs: https://docs.sleeper.com
 * Sleeper asks callers to stay under ~1000 req/min; `fetchJson` serialises with a
 * small delay so a full multi-season sync stays far below that.
 */

const BASE = "https://api.sleeper.app/v1";

/** Sleeper is generous but not infinite. ~12 req/s leaves a wide margin. */
const REQUEST_SPACING_MS = 80;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/**
 * GETs a Sleeper endpoint with retry on transient failures.
 *
 * Sleeper returns `null` (HTTP 200) rather than 404 for "no such user/league",
 * so callers must handle a null body — it is not an error.
 */
export async function fetchJson<T>(path: string, attempt = 0): Promise<T | null> {
  await throttle();
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T | null;
  } catch (err) {
    if (attempt >= 4) throw new Error(`${url} failed after 5 attempts: ${String(err)}`);
    // Exponential backoff: 0.5s, 1s, 2s, 4s.
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return fetchJson<T>(path, attempt + 1);
  }
}

// ---------------------------------------------------------------------------
// Raw response shapes. Only fields we actually consume are typed; Sleeper
// returns a great deal more.
// ---------------------------------------------------------------------------

export interface SleeperState {
  week: number;
  leg: number;
  season: string;
  season_type: "pre" | "regular" | "post" | "off";
  previous_season: string;
  season_start_date: string;
  display_week: number;
  league_season: string;
}

export interface SleeperLeague {
  league_id: string;
  previous_league_id: string | null;
  draft_id: string;
  name: string;
  season: string;
  status: "pre_draft" | "drafting" | "in_season" | "complete";
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
  avatar: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar: string | null;
  is_owner?: boolean;
  metadata?: { team_name?: string; avatar?: string } | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners: string[] | null;
  league_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  /**
   * Points are split into integer and decimal parts: fpts 1617 + fpts_decimal 78
   * means 1617.78. Same for fpts_against. Never read fpts alone.
   */
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
    total_moves?: number;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number;
  custom_points: number | null;
  starters: string[] | null;
  players: string[] | null;
  /** Per-player scores, keyed by player_id. Undocumented but reliably present. */
  players_points: Record<string, number> | null;
  starters_points: number[] | null;
}

export interface SleeperBracketMatch {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  t1_from?: { w?: number; l?: number };
  t2_from?: { w?: number; l?: number };
  /** Placement decided by this match — 1 is the championship, 3 the third-place game. */
  p?: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: "trade" | "waiver" | "free_agent" | "commissioner";
  status: string;
  status_updated: number;
  created: number;
  leg: number;
  roster_ids: number[];
  consenter_ids: number[] | null;
  creator: string | null;
  /** Maps are `{ player_id: roster_id }`, NOT arrays. */
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }> | null;
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }> | null;
  settings: { waiver_bid?: number; seq?: number } | null;
  metadata: Record<string, unknown> | null;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  status: string;
  type: string;
  settings: { rounds: number; teams: number; pick_timer?: number; reversal_round?: number };
  metadata: Record<string, unknown> | null;
  start_time: number | null;
  /** user_id -> draft slot. Only present on the single-draft endpoint. */
  draft_order: Record<string, number> | null;
  /** draft slot -> roster_id. Only present on the single-draft endpoint. */
  slot_to_roster_id: Record<string, number> | null;
}

export interface SleeperDraftPick {
  player_id: string;
  picked_by: string;
  roster_id: number | string | null;
  round: number;
  draft_slot: number;
  pick_no: number;
  is_keeper: boolean | null;
  draft_id: string;
  metadata: Record<string, string> | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

/** Trimmed player record. The full map is ~5MB; we only ever persist these fields. */
export interface SleeperPlayer {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  status?: string | null;
  years_exp?: number | null;
  /** ISO date, e.g. "2002-01-30". Present for ~11k of Sleeper's 12k players. */
  birth_date?: string | null;
  search_rank?: number | null;
  /**
   * Sleeper's own cross-reference to ESPN, present on roughly half the map.
   *
   * The exact join between the two services' player ids. `sync` publishes it as
   * `public/espn-players.json` for the live ESPN provider.
   */
  espn_id?: number | string | null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const getState = (sport = "nfl") => fetchJson<SleeperState>(`/state/${sport}`);

export const getLeague = (leagueId: string) => fetchJson<SleeperLeague>(`/league/${leagueId}`);

export const getLeagueUsers = (leagueId: string) =>
  fetchJson<SleeperUser[]>(`/league/${leagueId}/users`);

export const getRosters = (leagueId: string) =>
  fetchJson<SleeperRoster[]>(`/league/${leagueId}/rosters`);

export const getMatchups = (leagueId: string, week: number) =>
  fetchJson<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`);

/**
 * Note the endpoint is `losers_bracket`. The Sleeper docs' HTTP Request line
 * misspells it `loses_bracket`, which 404s.
 */
export const getWinnersBracket = (leagueId: string) =>
  fetchJson<SleeperBracketMatch[]>(`/league/${leagueId}/winners_bracket`);

export const getLosersBracket = (leagueId: string) =>
  fetchJson<SleeperBracketMatch[]>(`/league/${leagueId}/losers_bracket`);

export const getTransactions = (leagueId: string, week: number) =>
  fetchJson<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`);

export const getLeagueTradedPicks = (leagueId: string) =>
  fetchJson<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`);

/** Use `league.draft_id`, not `/league/:id/drafts` — see note in scripts/sync.ts. */
export const getDraft = (draftId: string) => fetchJson<SleeperDraft>(`/draft/${draftId}`);

export const getDraftPicks = (draftId: string) =>
  fetchJson<SleeperDraftPick[]>(`/draft/${draftId}/picks`);

export const getUserLeagues = (userId: string, season: string | number, sport = "nfl") =>
  fetchJson<SleeperLeague[]>(`/user/${userId}/leagues/${sport}/${season}`);

/** ~5MB. Callers must cache this; never call it more than once a day. */
export const getAllPlayers = (sport = "nfl") =>
  fetchJson<Record<string, SleeperPlayer>>(`/players/${sport}`);
