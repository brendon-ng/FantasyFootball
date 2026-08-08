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
  userId: string | null;
  /** False once someone has left the league; kept for history. */
  active: boolean;
  /** Seasons this owner fielded a team, ascending. */
  seasons: number[];
  /** Other owners they have shared a team with, by slug. */
  coOwnedWith: string[];
}

export type SeasonStatus = "pre_draft" | "drafting" | "in_season" | "complete";

/** A single team's regular-season line for one season. */
export interface StandingsRow {
  /**
   * Primary owner — the franchise key used for keeper grouping and URLs.
   * For Sleeper this is the roster's owner_id; for ESPN, the first name listed.
   */
  ownerSlug: string;
  /** Every owner credited with this team-season, including co-owners. */
  ownerSlugs: string[];
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
  /** A first-round bye: team1 sits the round out, team2 is null. */
  isBye?: boolean;
  /** ESPN ladder label, e.g. "GmC4". Shown so the routing is auditable. */
  label?: string | null;
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
  /**
   * True for the 2020-23 ESPN seasons reconstructed from archived pages. They
   * have standings and brackets but NO weekly matchups, rosters or drafts, so
   * they must be excluded from head-to-head, weekly records and keeper history.
   */
  imported: boolean;
  teams: number;
  regularSeasonWeeks: number;
  finalizedThroughWeek: number;
  /**
   * Starting slots in order, e.g. QB/RB/RB/WR/WR/TE/FLEX/FLEX/K/DEF. A matchup's
   * `starters` array is positionally aligned to this. Imported seasons take
   * theirs from the recovered lineups, so they read QB/RB/RB/WR/WR/TE/FLEX/D_ST/K
   * rather than falling back to an unlabelled column.
   */
  rosterPositions: string[];
  standings: StandingsRow[];
  winnersBracket: BracketMatch[];
  losersBracket: BracketMatch[];
  /**
   * Extra named brackets. ESPN seasons have THREE postseason sections, not two:
   * the championship bracket, a winner's consolation ladder deciding 3rd-6th,
   * and the main ladder deciding 7th-12th.
   */
  extraBrackets: Array<{
    key: string;
    title: string;
    note: string;
    finalLabel: string;
    /** Placement the marquee game of this bracket decides. */
    finalPlace: number;
    matches: BracketMatch[];
  }>;
  /** True when the consolation format is a ladder (win = move up), as on ESPN. */
  ladderConsolation: boolean;
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
  /** First week of the matchup. Equal to the only week unless `weeks` is set. */
  week: number;
  /** "regular" | "playoff" | "consolation" */
  kind: "regular" | "playoff" | "consolation";
  matchupId: number;
  /** Totals across every week of the matchup. */
  home: MatchupSide;
  away: MatchupSide;
  winner: string | null;
  /**
   * Per-week detail, present ONLY when a matchup spans more than one week.
   *
   * A MULTI-WEEK MATCHUP IS ONE GAME AND SEVERAL WEEKS, and the two facts are
   * needed in different places. It is one game for the head-to-head series, the
   * win-loss record and its own page — the league played a single playoff round.
   * It is several weeks for the record book, where a two-week total would
   * out-rank every genuine single-week score ever posted.
   *
   * ESPN sets this with `playoffMatchupPeriodLength`; Sleeper can do the same,
   * including for the championship only.
   */
  weeks?: MatchupWeek[];
}

/** One week inside a multi-week matchup. */
export interface MatchupWeek {
  week: number;
  home: MatchupSide;
  away: MatchupSide;
}

/**
 * The lowest-scoring team of one regular-season week.
 *
 * Regular season only: a playoff or consolation week is not every team playing,
 * so "lowest of the week" would compare a six-team field to a twelve-team one.
 * Ties produce more than one row for the same week, which is correct — a shared
 * low is shared by everyone in it.
 */
export interface WeeklyLow {
  season: number;
  week: number;
  ownerSlug: string;
  points: number;
}

export interface HeadToHead {
  /** All meetings — regular season and postseason combined. */
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** The postseason subset of the above (playoffs, consolation and toilet bowl). */
  playoff: { wins: number; losses: number; ties: number };
}

export interface OwnerRecord {
  ownerSlug: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Regular-season scoring rate, which is comparable across eras of different length. */
  pointsForPerGame: number;
  pointsAgainstPerGame: number;
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

/** A whole game, ranked by the two scores added together. */
export interface CombinedRecord {
  season: number;
  week: number;
  /** Both scores summed — what the list ranks on. */
  total: number;
  /** Higher scorer first, so the row reads as a result. */
  ownerSlug: string;
  points: number;
  opponentSlug: string;
  opponentPoints: number;
}

export interface LeagueRecords {
  weeklyHigh: ScoreRecord[];
  weeklyLow: ScoreRecord[];
  playerHigh: PlayerScoreRecord[];
  biggestBlowout: Array<ScoreRecord & { margin: number }>;
  narrowestWin: Array<ScoreRecord & { margin: number }>;
  highestCombined: CombinedRecord[];
  lowestCombined: CombinedRecord[];
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
  /**
   * True when this happened before that season's draft.
   *
   * Sleeper stamps every preseason move as `leg: 1`, so week alone implies these
   * happened during week 1 of the season when they may have been weeks earlier.
   */
  preseason: boolean;
  type: "trade" | "waiver" | "free_agent" | "commissioner" | "draft";
  /**
   * A trade is ONE event, not an add plus a drop. Sleeper represents it as both
   * sides of a single transaction; splitting them produces two half-events that
   * read as unrelated.
   */
  action: "add" | "drop" | "draft" | "keep" | "trade";
  /** Acquiring owner for add/draft/keep; the dropping owner for a drop. */
  ownerSlug: string | null;
  /**
   * Trades only: the `Trade` this event belongs to.
   *
   * Lets a row link to the whole deal. Without it a player page can say he was
   * traded and to whom, but never what came back — which is the interesting half.
   */
  tradeId?: string;
  /** Trades only: who the player came from and went to. */
  fromSlug: string | null;
  toSlug: string | null;
  faabSpent: number | null;
  /** Milliseconds. Sorting on this is what puts preseason moves before the draft. */
  timestamp: number;
  round?: number;
  pickNo?: number;
}

/**
 * One side of one trade — a player, a draft pick, or FAAB moving between owners.
 *
 * Modelled as legs rather than "team A gave X, team B gave Y" because a trade can
 * have three or more parties: Den Ops has one with three, where a pick goes from
 * owner 2 to owner 5 while a player goes from 3 to 2. Two-sided framing cannot
 * express that without lying about who gave what to whom.
 */
export interface TradeLeg {
  kind: "player" | "pick" | "faab";
  fromSlug: string | null;
  toSlug: string | null;
  /** Set when `kind` is "player". */
  playerId?: string;
  /**
   * Set when `kind` is "pick". `originalSlug` is whose pick it ORIGINALLY is,
   * which is not the sender — a pick can be traded more than once, and "Reagan's
   * 2026 4th" stays Reagan's pick however many hands it passes through.
   */
  pick?: { season: number; round: number; originalSlug: string | null };
  /** Set when `kind` is "faab". Dollars. */
  amount?: number;
}

export interface Trade {
  id: string;
  season: number;
  week: number;
  /** Preseason moves are all week 1 on Sleeper; this separates them. */
  preseason: boolean;
  timestamp: number;
  /** Every owner involved, sorted. Three or more for a multi-team trade. */
  ownerSlugs: string[];
  legs: TradeLeg[];
  source: "sleeper" | "espn";
  /**
   * Whether the deal actually took effect.
   *
   * A vetoed trade belongs in a LIST of trades — the league agreed it and then
   * threw it out, which is league history — but not in a player's timeline, where
   * it would assert a move that never happened.
   *
   * Sleeper reports any non-completion as `failed`, so a withdrawn offer and a
   * vetoed one look identical; there are none on record to tell apart yet. ESPN
   * reports anything other than `EXECUTED`.
   */
  vetoed: boolean;
}

/**
 * What one owner got out of one player in one season.
 *
 * Rostered and started are counted in GAMES, not weeks: a week the team did not
 * play — a playoff bye — is not a game the player was any use in, and it is
 * absent from the matchup record that this is summed from.
 */
export interface PlayerUsage {
  season: number;
  ownerSlug: string;
  /** Games the player was on this owner's roster, bench included. */
  rostered: number;
  started: number;
  /** Points scored while STARTED, so points that counted. */
  startPoints: number;
  /** Points scored while on the bench, which counted for nothing. */
  benchPoints: number;
  /**
   * The last week this owner had him, used to order a season's rows.
   *
   * An owner who picked a player up in week 11 belongs ABOVE one who dropped him
   * in week 7, because the table reads newest first. Where a player went out and
   * came back to the same owner the two spells are one row, placed by the later
   * of them — the alternative is a row per spell, which turns a single season
   * into a ledger.
   */
  lastWeek: number;
}

/**
 * What one side of a trade actually got, for the rest of that season.
 *
 * Counts only weeks the receiving owner GENUINELY rostered the player, from the
 * trade week on — so a player flipped again a fortnight later stops counting, and
 * a trade processed before that week's games still picks that week up.
 */
export interface TradeStat {
  /** Games rostered, bench included. */
  games: number;
  started: number;
  startPoints: number;
  benchPoints: number;
  /**
   * Set when the acquiring owner let the player go again that same season.
   *
   * Context the numbers cannot give: a modest return means one thing if he was
   * held all year and another if he was cut in week 4.
   */
  exit?: { kind: "dropped" | "traded"; week: number; tradeId?: string };
  /**
   * Set when the acquiring owner kept the player the FOLLOWING season.
   *
   * The other end of the same story `exit` tells: a trade whose return looks thin
   * within the season may have been made for the contract, and a keeper round is
   * what that was worth.
   */
  kept?: { season: number; round: number };
}

/** One side's haul in one season. */
export interface TradeSide {
  /** Players received in the trade itself. */
  byPlayer: Record<string, TradeStat>;
  /**
   * Players DRAFTED with a pick received in the trade, kept apart so the UI can
   * offer them as an option rather than forcing them into the comparison.
   *
   * Only where the receiver actually used the pick. Three of the twenty-six
   * settled picks were traded on again, and those returned nothing to the team
   * that briefly held them.
   */
  fromPicks: Record<string, TradeStat>;
  /** Players only. */
  total: TradeStat;
  /** Players plus everyone drafted with the picks. */
  totalWithPicks: TradeStat;
}

/**
 * A trade's return, season by season.
 *
 * MORE THAN THE YEAR IT HAPPENED. A player kept the next season is this trade
 * still paying out — the deal bought a contract, not just a run of games — so the
 * chain continues for as long as somebody involved is retained, narrowing each
 * year to whoever is still on the roster that acquired him.
 */
export interface TradeReturn {
  /** Every party, in the order the trade's own columns use. */
  order: string[];
  seasons: TradeSeason[];
}

export interface TradeSeason {
  season: number;
  /** True for the trade's own season, where only the weeks after it count. */
  partial: boolean;
  byOwner: Record<string, TradeSide>;
}

export interface DraftPickRecord {
  season: number;
  round: number;
  pickNo: number;
  draftSlot: number;
  /** Who actually used the pick — the acquiring team if it was traded. */
  ownerSlug: string | null;
  /**
   * Whose draft slot this is, from the draft's `slot_to_roster_id`.
   *
   * Differs from `ownerSlug` exactly when the pick changed hands. Kept separate
   * because a board column is a SLOT, so the column must be labelled by its
   * original owner; inferring the label from picks would name the column after
   * whoever happened to trade in.
   */
  slotOwnerSlug: string | null;
  playerId: string;
  isKeeper: boolean;
}

export interface PlayerMeta {
  full_name: string;
  position: string | null;
  team: string | null;
  years_exp?: number | null;
}

// ---------------------------------------------------------------------------
// The in-progress season
// ---------------------------------------------------------------------------

/**
 * Lives here, not in `lib/data.ts`, so a CLIENT component can import the shape
 * without dragging in a module that reads the filesystem.
 */
export type SeasonType = "pre" | "regular" | "post" | "off";

export interface LiveTeam {
  ownerSlug: string;
  /**
   * Everyone credited with this team, primary first.
   *
   * Co-owners are first-class owners here, so a shared team reads "Jaymie &
   * Katie" wherever a name is shown — matching what a finished season's
   * standings already do off `StandingsRow.ownerSlugs`.
   */
  ownerSlugs: string[];
  rosterId: number;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  waiverBudgetUsed: number;
  players: string[];
  starters: string[];
}

export interface LiveMatchup {
  matchupId: number;
  a: { ownerSlug: string; points: number };
  b: { ownerSlug: string; points: number };
}

export interface LiveSeason {
  season: number;
  week: number;
  displayWeek: number;
  seasonType: SeasonType;
  status: string;
  teams: LiveTeam[];
  matchups: LiveMatchup[];
  /** True when Sleeper could not be reached; the UI degrades rather than erroring. */
  unavailable: boolean;
  /**
   * Last week Sleeper has fully scored. Null before any week finalizes.
   *
   * The finalization signal throughout — safer than comparing against the
   * current NFL week, which advances before stat corrections settle.
   */
  lastScoredLeg: number | null;
}
