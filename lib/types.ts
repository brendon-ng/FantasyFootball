/**
 * Domain types for the derived data the site reads.
 *
 * Everything here is produced by `scripts/derive.ts` into `data/derived/` and is
 * keyed by OWNER SLUG rather than roster_id or team name: roster_id is only
 * stable within a season and team names change yearly, so neither survives as a
 * historical key.
 */

export interface Owner {
  slug: string;
  name: string;
  firstName: string;
  userId: string;
  coOwners: string[];
  /** Seasons this owner fielded a team, ascending. */
  seasons: number[];
}

export type SeasonStatus = "pre_draft" | "drafting" | "in_season" | "complete";

/** A single team's regular-season line for one season. */
export interface StandingsRow {
  ownerSlug: string;
  rosterId: number;
  teamName: string | null;
  seed: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Final placement 1-10 after playoffs / toilet bowl. Null while in progress. */
  finalPlace: number | null;
  madePlayoffs: boolean;
}

export interface BracketMatch {
  round: number;
  matchId: number;
  /** Playoff week this round was played. */
  week: number | null;
  /** Resolved owner slugs; null until the feeding match is decided. */
  team1: string | null;
  team2: string | null;
  winner: string | null;
  loser: string | null;
  team1From: { winnerOf?: number; loserOf?: number } | null;
  team2From: { winnerOf?: number; loserOf?: number } | null;
  /**
   * Overall league placements this match decides, as [place for `winner`,
   * place for `loser`].
   *
   * In the toilet bowl `winner` is the team Sleeper advances, which is the team
   * that LOST the game — so this pair counts downward there.
   */
  placesFor: [number, number] | null;
  /** Final scores, owner slug -> points. Empty until the game is played. */
  points: Record<string, number>;
  /**
   * True for toilet-bowl matches, where advancing is bad and the advancing team
   * is the lower scorer. The UI must not render `winner` as "W" here.
   */
  inverted: boolean;
}

export interface SeasonSummary {
  season: number;
  leagueId: string;
  leagueName: string;
  status: SeasonStatus;
  finalized: boolean;
  regularSeasonWeeks: number;
  finalizedThroughWeek: number;
  standings: StandingsRow[];
  winnersBracket: BracketMatch[];
  losersBracket: BracketMatch[];
  champion: string | null;
  runnerUp: string | null;
  thirdPlace: string | null;
  lastPlace: string | null;
}

/** One team's side of one week's matchup. */
export interface MatchupSide {
  ownerSlug: string;
  points: number;
  starters: string[];
  /** player_id -> points, starters and bench alike. */
  playerPoints: Record<string, number>;
}

export interface Matchup {
  season: number;
  week: number;
  /** "regular" | "playoff" | "consolation" */
  kind: "regular" | "playoff" | "consolation";
  matchupId: number;
  home: MatchupSide;
  away: MatchupSide;
  winner: string | null;
}

export interface HeadToHead {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface OwnerRecord {
  ownerSlug: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  championships: number;
  runnerUps: number;
  thirdPlaces: number;
  lastPlaces: number;
  playoffAppearances: number;
  seasonsPlayed: number;
  averageFinish: number | null;
  bestFinish: number | null;
  worstFinish: number | null;
  /** Final placement by season, for the finish-over-time chart. */
  finishes: Array<{ season: number; place: number | null; seed: number }>;
  /** Opponent slug -> record against them, all time. */
  vs: Record<string, HeadToHead>;
}

export interface ScoreRecord {
  season: number;
  week: number;
  ownerSlug: string;
  points: number;
  opponentSlug: string | null;
  opponentPoints: number | null;
}

export interface PlayerScoreRecord {
  season: number;
  week: number;
  ownerSlug: string;
  playerId: string;
  points: number;
  started: boolean;
}

export interface LeagueRecords {
  weeklyHigh: ScoreRecord[];
  weeklyLow: ScoreRecord[];
  playerHigh: PlayerScoreRecord[];
  biggestBlowout: Array<ScoreRecord & { margin: number }>;
  narrowestWin: Array<ScoreRecord & { margin: number }>;
}

// ---------------------------------------------------------------------------
// Keepers
// ---------------------------------------------------------------------------

export type ContractOrigin =
  | "drafted"
  | "undrafted-fa"
  | "reacquired"
  | "traded-in"
  | "startup";

/**
 * A player's keeper contract as of a given season.
 *
 * `round` is what keeping costs. `keepsUsed` counts how many times the player
 * has already been retained at that cost; once it reaches the season's
 * `maxKeepsAtOriginalCost` the contract expires and the player is revalued to ADP.
 */
export interface KeeperContract {
  playerId: string;
  ownerSlug: string | null;
  round: number;
  keepsUsed: number;
  keepsRemaining: number;
  expired: boolean;
  origin: ContractOrigin;
  startSeason: number;
  /** Round the player was originally drafted at, before any re-acquisition. */
  originalDraftRound: number | null;
  /** Human-readable derivation, shown in the UI so the math is auditable. */
  provenance: string[];
}

export interface SeasonKeepers {
  season: number;
  /** Contracts as they stand entering this season's draft. */
  contracts: KeeperContract[];
  /** Players actually kept this season, from Sleeper's is_keeper flag. */
  keptPlayerIds: string[];
}

// ---------------------------------------------------------------------------
// Transactions & drafts
// ---------------------------------------------------------------------------

export interface PlayerTransaction {
  season: number;
  week: number;
  type: "trade" | "waiver" | "free_agent" | "commissioner" | "draft";
  /** "add" | "drop" from the perspective of this player. */
  action: "add" | "drop" | "draft";
  ownerSlug: string | null;
  counterpartySlug: string | null;
  faabSpent: number | null;
  timestamp: number;
  round?: number;
  pickNo?: number;
}

export interface DraftPickRecord {
  season: number;
  round: number;
  pickNo: number;
  draftSlot: number;
  ownerSlug: string | null;
  playerId: string;
  isKeeper: boolean;
}

export interface PlayerMeta {
  full_name: string;
  position: string | null;
  team: string | null;
  years_exp?: number | null;
}
