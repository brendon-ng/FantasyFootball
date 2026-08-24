/**
 * The contract every live provider implements.
 *
 * A provider turns one service's API into the shapes the site already renders.
 * Nothing above this file knows whether a season is on Sleeper or ESPN — the
 * hooks pick a provider from the ref and the components see identical data
 * either way. That is what makes adding a third service a new file here rather
 * than a change everywhere.
 *
 * Dependency-free: this ships to the browser.
 */

import type { LiveSeason, SeasonType } from "../types.ts";

export type LiveState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

/**
 * One player on a live roster, ready to display.
 *
 * SEPARATE FROM `LiveRoster.players`, which is Sleeper ids and exists for the
 * keeper machinery. This carries what it takes to SHOW a roster, and it has to,
 * because on ESPN the two are not interchangeable: only about a quarter of a
 * freshly drafted ESPN roster resolves to a Sleeper id — `espn_id` coverage thins
 * badly for players who arrived recently — so a list built from ids alone drops
 * three quarters of every team without saying so. ESPN publishes the name right
 * there on the roster entry, so that is what gets rendered.
 */
export interface LiveRosterPlayer {
  /**
   * The Sleeper id where one is known, else `espn-<id>`. Prefixed rather than
   * bare so it stays unique as a React key and cannot be mistaken for a Sleeper
   * id that would silently match no player page.
   */
  id: string;
  /** The provider's own name. Null on Sleeper, where the baked index has it. */
  name: string | null;
  position: string | null;
  /** NFL team abbreviation. */
  team: string | null;
}

export interface LiveRoster {
  rosterId: number;
  ownerId: string | null;
  coOwners: string[];
  /** player_ids the team has currently locked in as keepers. Empty until they choose. */
  keepers: string[];
  players: string[];
  /** The same roster, ready to display. See `LiveRosterPlayer`. */
  detail: LiveRosterPlayer[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  waiverBudgetUsed: number;
}

export interface LiveTradedPick {
  season: string;
  round: number;
  /** Roster the pick originally belonged to. */
  rosterId: number;
  currentOwnerRosterId: number;
}

export interface LiveDraft {
  draftId: string;
  status: string;
  type: string;
  rounds: number;
  teams: number;
  reversalRound: number;
  /** Slot -> roster. Meaningless until `orderSet`; see lib/draft-slots.ts. */
  slotToRoster: Record<number, number>;
  /** True once the order has actually been drawn — or stood in for. */
  orderSet: boolean;
  /** True when `?mockDraftOrder=true` supplied the order. Surface it. */
  mocked: boolean;
  startTime: number | null;
}

/** A draft as the provider reports it, before any mock flags are applied. */
export type RawDraft = Omit<LiveDraft, "mocked">;

/** Where the football calendar currently stands, per the provider's own clock. */
export interface ProviderState {
  season: number;
  week: number;
  displayWeek: number;
  seasonType: SeasonType;
}

/**
 * What a provider needs from the BAKED page in order to name people.
 *
 * The browser has no access to `config/leagues/*`, and the build already did
 * the roster -> owner resolution including co-owners, so it is lifted from the
 * server-rendered value rather than duplicated over the wire.
 */
export interface SeasonContext {
  /** roster/team id -> owner slug, from the baked LiveSeason. */
  slugByRoster: Map<number, string>;
  /** provider user id -> owner slug. Only co-owners need it. */
  userIdToSlug: Record<string, string>;
}

/**
 * One move of one player, normalised across providers.
 *
 * Deliberately narrower than either service's transaction record: this only
 * exists to fill the gap between the last archive and now for a single player,
 * so it carries who got him, who lost him and when — not the other side of a
 * trade, which the committed history already has.
 */
export interface LiveMove {
  /** Provider-neutral: "waiver" | "free_agent" | "trade" | "commissioner". */
  type: string;
  week: number;
  ts: number;
  /** roster/team that RECEIVED the player, or null on a pure drop. */
  toRosterId: number | null;
  /** roster/team that GAVE HIM UP, or null on a pure add. */
  fromRosterId: number | null;
}

/**
 * One game from a single week's scoreboard, in roster ids.
 *
 * Deliberately NOT resolved to owners here: the caller already has the roster
 * list and the id map, and a provider that had to know about owner slugs would
 * need the league config threaded into it.
 */
export interface LiveWeekGame {
  matchupId: number;
  sides: Array<{ rosterId: number; points: number }>;
}

export interface LiveProvider {
  /** Shown to the reader, e.g. "live from ESPN". */
  readonly name: string;
  /** The current season and week. Null when the service cannot be reached. */
  state(): Promise<ProviderState | null>;
  rosters(id: string, season: number): Promise<LiveRoster[]>;
  tradedPicks(id: string, season: number): Promise<LiveTradedPick[]>;
  draft(id: string, season: number): Promise<RawDraft | null>;
  season(
    id: string,
    st: ProviderState,
    ctx: SeasonContext,
  ): Promise<LiveSeason | null>;
  /** Moves involving one player, from `fromWeek` onward. */
  moves(
    id: string,
    season: number,
    playerId: string,
    fromWeek: number,
    weeks: number,
  ): Promise<LiveMove[]>;
  /**
   * One specific week's scoreboard.
   *
   * `season()` only ever reads the week the league is CURRENTLY on, which is no
   * use for a week that has just finished and not yet been archived — which is
   * exactly the window a punishment gets drawn in.
   */
  weekGames(id: string, season: number, week: number): Promise<LiveWeekGame[]>;
  /**
   * Every week's scoreboard up to and including `throughWeek`, keyed by week.
   *
   * NOT `weekGames` IN A LOOP, which is why it is its own method. ESPN serves the
   * whole season's schedule in one league payload, so asking week by week would
   * download the entire league seventeen times; Sleeper has no bulk form and
   * genuinely does need one request each. Only the provider knows which it is.
   *
   * A season with nothing played yet is `{}`, not an error.
   */
  seasonGames(
    id: string,
    season: number,
    throughWeek: number,
  ): Promise<Record<number, LiveWeekGame[]>>;
  /** EVERY completed move from `fromWeek` onward, for the keeper adjuster. */
  leagueMoves(id: string, season: number, fromWeek: number, weeks: number): Promise<LeagueMove[]>;
}

/**
 * A whole transaction, keyed by player.
 *
 * Sleeper's native shape, because it is the one the keeper adjuster wants: it
 * replays moves in order and needs to see both sides of a trade at once, which
 * a per-player `LiveMove` cannot express.
 */
export interface LeagueMove {
  type: string;
  week: number;
  ts: number;
  /** playerId -> roster that RECEIVED him. */
  adds: Record<string, number>;
  /** playerId -> roster that GAVE HIM UP. */
  drops: Record<string, number>;
}

export const round2 = (n: number): number => Number(n.toFixed(2));
