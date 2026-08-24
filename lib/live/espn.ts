/**
 * ESPN, behind the live provider interface.
 *
 * Browser-safe on purpose — `scripts/lib/espn.ts` is the importer's client and
 * pulls in Node — and PUBLIC-ONLY: no cookies are sent and none should be.
 * `espn_s2` is an account-wide session token, so it must never reach a static
 * bundle. A league whose current season is private simply reports nothing live
 * and the page keeps its baked content.
 *
 * Fetching from the browser works because ESPN reflects the requesting origin
 * in `access-control-allow-origin`, the same property that lets the Sleeper
 * leagues do this from GitHub Pages.
 *
 * THE ID PROBLEM. Everything on this site is keyed on Sleeper player ids, and
 * ESPN speaks its own. Team-level data — standings, scores, the phase — needs
 * no translation, so it works unconditionally. Player-level data goes through
 * `espn-players.json`, a map `sync` commits; if it is missing the rosters come
 * back empty rather than wrong, because a page showing the wrong owner for a
 * player is worse than one showing none.
 */

import type { LiveMatchup, LiveSeason, LiveTeam, SeasonType } from "../types.ts";
import { withBasePath } from "../base-path.ts";
import { ESPN_POS, PRO_TEAM } from "../espn-maps.ts";

import {
  round2,
  type LeagueMove,
  type LiveMove,
  type LiveProvider,
  type LiveRoster,
  type LiveRosterPlayer,
  type LiveWeekGame,
  type ProviderState,
  type RawDraft,
  type SeasonContext,
} from "./types.ts";
import { fetchRetry } from "./retry.ts";

const API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

const leagueUrl = (id: string, season: number, views: string[]) =>
  `${API}/seasons/${season}/segments/0/leagues/${id}?${views.map((v) => `view=${v}`).join("&")}`;

async function get<T>(url: string): Promise<T | null> {
  const res = await fetchRetry(url);
  // 401 is the normal answer for a season the owner has not made public. Not an
  // error worth surfacing — the live layer just has nothing to add.
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

interface EspnRecordSide {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

interface EspnTeam {
  id: number;
  name?: string;
  abbrev?: string;
  primaryOwner?: string;
  owners?: string[];
  record?: { overall?: EspnRecordSide };
  transactionCounter?: { acquisitionBudgetSpent?: number };
  roster?: { entries?: EspnEntry[] } | null;
}

interface EspnEntry {
  lineupSlotId: number;
  playerId?: number;
  playerPoolEntry?: {
    player?: {
      id?: number;
      fullName?: string;
      defaultPositionId?: number;
      proTeamId?: number;
    };
  };
}

interface EspnGameSide {
  teamId: number;
  totalPoints?: number;
  pointsByScoringPeriod?: Record<string, number>;
}

interface EspnLeague {
  seasonId: number;
  scoringPeriodId?: number;
  status?: {
    currentMatchupPeriod?: number;
    latestScoringPeriod?: number;
    finalScoringPeriod?: number;
  };
  draftDetail?: { drafted?: boolean; inProgress?: boolean };
  settings?: {
    name?: string;
    size?: number;
    draftSettings?: { date?: number | null; type?: string; pickOrder?: number[] | null };
    scheduleSettings?: {
      matchupPeriodCount?: number;
      matchupPeriods?: Record<string, number[]>;
    };
  };
  teams?: EspnTeam[];
  schedule?: Array<{
    /** Unique across the SEASON, unlike `matchupPeriodId`. */
    id?: number;
    matchupPeriodId: number;
    home?: EspnGameSide;
    away?: EspnGameSide;
    /** "HOME" | "AWAY" | "TIE" | "UNDECIDED" — the only honest finality marker. */
    winner?: string;
  }>;
}

/**
 * ESPN player id -> Sleeper player id, committed by `sync`.
 *
 * Fetched once per page and cached on the module, because several hooks ask for
 * rosters on the same render and the file is the same for every one of them.
 */
let playerMap: Promise<Record<string, string>> | null = null;
function espnPlayerIds(): Promise<Record<string, string>> {
  playerMap ??= fetch(withBasePath("/espn-players.json"))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return playerMap;
}

interface EspnTx {
  id: string;
  type: string;
  status: string;
  proposedDate: number;
  scoringPeriodId: number;
  items?: Array<{ playerId: number; fromTeamId: number; toTeamId: number }>;
}

/** ESPN's transaction vocabulary, mapped onto the site's. */
const ESPN_MOVE: Record<string, string> = {
  TRADE_ACCEPT: "trade",
  WAIVER: "waiver",
  FREEAGENT: "free_agent",
  ROSTER: "commissioner",
};

/** Which scoring periods a matchup period covers — usually one, two in playoffs. */
const spanOf = (league: EspnLeague, mp: number): number[] =>
  league.settings?.scheduleSettings?.matchupPeriods?.[String(mp)] ?? [mp];

/** A game ESPN has called. Anything else is still in progress or unplayed. */
const isDecided = (winner: string | undefined): boolean =>
  winner != null && winner !== "UNDECIDED";

/**
 * The last scoring period this league has actually FINISHED, or null.
 *
 * NOT `status.latestScoringPeriod`, which this used to be and which does not
 * mean that at all — it is ESPN's cursor over periods that merely EXIST. It
 * reads 1 all preseason, before a snap has been played, and 19 for a season
 * whose final period was 17. Since `week` was derived from the same number,
 * `lastScoredLeg >= week` was true for an ESPN league in EVERY state, which
 * stamped "week complete" on an unplayed week and hung record badges on 0-0
 * matchups.
 *
 * `winner` is the honest signal: ESPN leaves it UNDECIDED until the matchup
 * period closes. A period counts as finished only when every game in it is
 * decided, and only two-sided games are considered — a playoff bye has one team
 * and can never carry a winner, so counting it would freeze the season there.
 */
function lastFinishedLeg(league: EspnLeague): number | null {
  const byPeriod = new Map<number, boolean>();
  for (const g of league.schedule ?? []) {
    if (g.home?.teamId == null || g.away?.teamId == null) continue;
    byPeriod.set(g.matchupPeriodId, (byPeriod.get(g.matchupPeriodId) ?? true) && isDecided(g.winner));
  }
  let last: number | null = null;
  for (const [mp, decided] of byPeriod) {
    if (!decided) continue;
    for (const leg of spanOf(league, mp)) last = Math.max(last ?? 0, leg);
  }
  return last;
}

export const espnProvider: LiveProvider = {
  name: "ESPN",

  /**
   * ESPN's answer to Sleeper's `/state/nfl`.
   *
   * `seasonType` is only PROVISIONAL here: this endpoint knows the calendar but
   * not the league, and where the regular season ends is a league setting.
   * `season()` below computes the real one and it is that value the phase reads.
   */
  async state(): Promise<ProviderState | null> {
    const game = await get<{
      currentSeason?: { id?: number; active?: boolean; currentScoringPeriod?: { id?: number } };
    }>(API);
    const cur = game?.currentSeason;
    if (!cur?.id) return null;
    const week = Math.max(1, cur.currentScoringPeriod?.id ?? 1);
    return {
      season: cur.id,
      week,
      displayWeek: week,
      seasonType: cur.active === false ? "off" : "regular",
    };
  },

  async rosters(id, season): Promise<LiveRoster[]> {
    const [league, ids] = await Promise.all([
      get<EspnLeague>(leagueUrl(id, season, ["mTeam", "mRoster"])),
      espnPlayerIds(),
    ]);
    if (!league?.teams) return [];

    // Untranslatable players are DROPPED rather than passed through with an
    // ESPN id, which would silently fail to match any player page.
    const toSleeper = (e: EspnEntry): string | null => {
      const pid = e.playerId ?? e.playerPoolEntry?.player?.id;
      return pid == null ? null : (ids[String(pid)] ?? null);
    };

    /**
     * The same entry, ready to display — and NOT dropped when the id does not
     * translate. Only about a quarter of a freshly drafted roster has a Sleeper
     * id, so `players` above is a quarter of the team; ESPN puts the name, the
     * position and the pro team on the entry itself, which is all a roster list
     * needs.
     */
    const toDisplay = (e: EspnEntry): LiveRosterPlayer | null => {
      const pl = e.playerPoolEntry?.player;
      const pid = e.playerId ?? pl?.id;
      if (pid == null) return null;
      return {
        id: ids[String(pid)] ?? `espn-${pid}`,
        name: pl?.fullName ?? null,
        position: ESPN_POS[pl?.defaultPositionId ?? -1] ?? null,
        team: PRO_TEAM[pl?.proTeamId ?? -1] ?? null,
      };
    };

    return league.teams.map((t) => {
      const entries = t.roster?.entries ?? [];
      const rec = t.record?.overall;
      return {
        rosterId: t.id,
        ownerId: t.primaryOwner ?? t.owners?.[0] ?? null,
        coOwners: (t.owners ?? []).filter((o) => o !== (t.primaryOwner ?? t.owners?.[0])),
        // ESPN has no keeper concept the API exposes, and the leagues on it are
        // redraft. An empty list reads as "nobody has chosen yet", which is true.
        keepers: [],
        players: entries.map(toSleeper).filter((p): p is string => p !== null),
        detail: entries.map(toDisplay).filter((p): p is LiveRosterPlayer => p !== null),
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        ties: rec?.ties ?? 0,
        pointsFor: round2(rec?.pointsFor ?? 0),
        waiverBudgetUsed: t.transactionCounter?.acquisitionBudgetSpent ?? 0,
      };
    });
  },

  /**
   * ESPN does not publish traded future picks, so there is nothing to report.
   *
   * Returning empty is CORRECT rather than a stub: the draft-pick view builds a
   * baseline of every round for every team and applies moves on top, so no
   * moves means every team holds its own picks — which is what ESPN's own draft
   * board shows for a league that trades picks in-draft only.
   */
  /**
   * Not implemented. The only surface that asks for this is the punishment
   * draw, and the one league with punishments has never been on ESPN — a
   * half-built path nobody can exercise is worse than an honest empty.
   */
  async weekGames() {
    return [];
  },

  /**
   * ONE REQUEST FOR THE WHOLE SEASON. ESPN's schedule carries every game's
   * `pointsByScoringPeriod`, so the week-by-week board is already in the payload
   * `season()` reads — there is nothing per-week to fetch.
   */
  async seasonGames(id, season, throughWeek): Promise<Record<number, LiveWeekGame[]>> {
    const league = await get<EspnLeague>(
      leagueUrl(id, season, ["mMatchupScore", "mSettings"]),
    );
    if (!league) return {};

    const out: Record<number, LiveWeekGame[]> = {};
    for (const g of league.schedule ?? []) {
      if (g.home?.teamId == null || g.away?.teamId == null) continue;
      // A playoff matchup period covers two scoring periods, and each is its own
      // week on the board — the same split `season()` makes.
      for (const week of spanOf(league, g.matchupPeriodId)) {
        if (week < 1 || week > throughWeek) continue;
        const pts = (s: EspnGameSide) =>
          round2(s.pointsByScoringPeriod?.[String(week)] ?? 0);
        (out[week] ??= []).push({
          matchupId: g.id ?? g.matchupPeriodId,
          sides: [
            { rosterId: g.home.teamId, points: pts(g.home) },
            { rosterId: g.away.teamId, points: pts(g.away) },
          ],
        });
      }
    }
    return out;
  },

  async tradedPicks() {
    return [];
  },

  /**
   * The upcoming draft.
   *
   * ESPN has no separate draft resource: the state lives on the league as
   * `draftDetail` plus `settings.draftSettings`. Mapped onto Sleeper's
   * vocabulary so `resolvePhase` and the draft components need no ESPN branch.
   */
  async draft(id, season): Promise<RawDraft | null> {
    const league = await get<EspnLeague>(leagueUrl(id, season, ["mSettings"]));
    if (!league) return null;
    const ds = league.settings?.draftSettings;
    const detail = league.draftDetail;
    const order = ds?.pickOrder ?? [];

    const slotToRoster: Record<number, number> = {};
    order.forEach((teamId, i) => {
      slotToRoster[i + 1] = teamId;
    });

    return {
      // Synthetic: ESPN has no draft id, but one league has one draft per season.
      draftId: `${id}-${season}`,
      status: detail?.drafted ? "complete" : detail?.inProgress ? "drafting" : "pre_draft",
      type: (ds?.type ?? "SNAKE").toLowerCase(),
      rounds: 0,
      teams: league.settings?.size ?? order.length,
      // Snake order reverses every round; ESPN has no third-round-reversal setting.
      reversalRound: 0,
      slotToRoster,
      orderSet: order.length > 0,
      startTime: ds?.date ?? null,
    };
  },

  /**
   * Moves involving one player, from `fromWeek` onward.
   *
   * ESPN puts transactions on the PLAYER CARD rather than on a league view, so
   * unlike Sleeper this is one request for one player and needs no week paging
   * — `fromWeek` filters the result instead of driving the fetch.
   *
   * The `x-fantasy-filter` header is what scopes the card to a single player.
   * It survives CORS because ESPN names it in `access-control-allow-headers`.
   */
  async moves(id, season, playerId, fromWeek) {
    const ids = await espnPlayerIds();
    // The map is ESPN -> Sleeper; this is the one place that needs it the other
    // way round, and inverting the ~6k entries costs less than shipping both.
    const espnId = Object.keys(ids).find((k) => ids[k] === playerId);
    if (!espnId) return [];

    const res = await fetchRetry(leagueUrl(id, season, ["kona_playercard"]), {
      headers: { "x-fantasy-filter": JSON.stringify({ players: { filterIds: { value: [Number(espnId)] } } }) },
    });
    if (!res?.ok) return [];
    const card = (await res.json()) as {
      players?: Array<{ transactions?: EspnTx[] }>;
    };

    const seen = new Set<string>();
    const out: LiveMove[] = [];
    for (const p of card.players ?? []) {
      for (const t of p.transactions ?? []) {
        // A trade appears on every player in it; the id collapses the repeats.
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        // Only what actually happened. A vetoed trade or a lost claim is an
        // attempt, and the committed history is where the full story lives.
        if (t.status !== "EXECUTED" || t.type === "DRAFT") continue;
        if ((t.scoringPeriodId ?? 0) < fromWeek) continue;
        const item = (t.items ?? []).find((i) => String(i.playerId) === espnId);
        if (!item) continue;
        out.push({
          type: ESPN_MOVE[t.type] ?? "free_agent",
          week: t.scoringPeriodId,
          ts: t.proposedDate,
          // ESPN uses team id 0 for "nobody" — the free-agent pool.
          toRosterId: item.toTeamId || null,
          fromRosterId: item.fromTeamId || null,
        });
      }
    }
    return out;
  },

  /**
   * Every completed move in the probed weeks.
   *
   * One unfiltered player card covers the whole league, so this is a single
   * request where Sleeper needs one per week. Players the id map cannot
   * translate are omitted from a move rather than the move being dropped: a
   * trade of two players where one is unknown is still a trade of the other.
   */
  async leagueMoves(id, season, fromWeek) {
    const [res, ids] = await Promise.all([
      fetchRetry(leagueUrl(id, season, ["kona_playercard"]), {
        headers: { "x-fantasy-filter": JSON.stringify({ players: { limit: 2000, offset: 0 } }) },
      }),
      espnPlayerIds(),
    ]);
    if (!res?.ok) return [];
    const card = (await res.json()) as { players?: Array<{ transactions?: EspnTx[] }> };

    // A trade appears on every player in it; the id collapses the repeats.
    const byId = new Map<string, EspnTx>();
    for (const p of card.players ?? []) {
      for (const t of p.transactions ?? []) byId.set(t.id, t);
    }

    const out: LeagueMove[] = [];
    for (const t of byId.values()) {
      if (t.status !== "EXECUTED" || t.type === "DRAFT") continue;
      if ((t.scoringPeriodId ?? 0) < fromWeek) continue;
      const adds: Record<string, number> = {};
      const drops: Record<string, number> = {};
      for (const i of t.items ?? []) {
        const sleeperId = ids[String(i.playerId)];
        if (!sleeperId) continue;
        // Team 0 is the free-agent pool, which is nobody.
        if (i.toTeamId) adds[sleeperId] = i.toTeamId;
        if (i.fromTeamId) drops[sleeperId] = i.fromTeamId;
      }
      if (!Object.keys(adds).length && !Object.keys(drops).length) continue;
      out.push({
        type: ESPN_MOVE[t.type] ?? "free_agent",
        week: t.scoringPeriodId,
        ts: t.proposedDate,
        adds,
        drops,
      });
    }
    return out;
  },

  async season(id, st: ProviderState, ctx: SeasonContext): Promise<LiveSeason | null> {
    const league = await get<EspnLeague>(
      leagueUrl(id, st.season, ["mTeam", "mSettings", "mMatchupScore"]),
    );
    if (!league?.teams?.length) return null;

    const regularWeeks = league.settings?.scheduleSettings?.matchupPeriodCount ?? 14;
    const latest = league.status?.latestScoringPeriod ?? 0;
    const currentMp = league.status?.currentMatchupPeriod ?? 1;
    const finalLeg = league.status?.finalScoringPeriod ?? 0;
    const scoredLeg = lastFinishedLeg(league);

    /**
     * Has a down been played in this league's season yet?
     *
     * NEITHER ENDPOINT SAYS SO DIRECTLY, which is the trap here: ESPN reports
     * `currentScoringPeriod: 1`, `latestScoringPeriod: 1` and `active: true` all
     * summer, so every calendar-shaped signal claims week 1 is underway in
     * August. Points cannot lie — the schedule is all zeroes until kickoff.
     */
    const played =
      scoredLeg !== null ||
      (league.schedule ?? []).some(
        (g) => (g.home?.totalPoints ?? 0) > 0 || (g.away?.totalPoints ?? 0) > 0,
      );

    /** The real season type, which the global endpoint could not know. */
    const seasonType: SeasonType = !played
      ? "off"
      : currentMp > regularWeeks
        ? "post"
        : "regular";

    // Clamped: `latestScoringPeriod` runs PAST the end of the season (19 for a
    // 17-period year), which would leave a finished league pointing at a week
    // that never existed.
    const week =
      seasonType === "off"
        ? st.week
        : Math.min(Math.max(1, latest || st.week), finalLeg || Number.MAX_SAFE_INTEGER);

    /** See the Sleeper provider: browser has `slugByRoster`, the build does not. */
    const primaryOf = (t: EspnTeam): string | undefined =>
      ctx.slugByRoster.get(t.id) ??
      ctx.userIdToSlug[(t.primaryOwner ?? t.owners?.[0] ?? "").toUpperCase()];

    const creditedSlugs = (t: EspnTeam): string[] => {
      const out: string[] = [];
      const primary = primaryOf(t);
      if (primary) out.push(primary);
      for (const uid of t.owners ?? []) {
        const slug = ctx.userIdToSlug[uid.toUpperCase()];
        if (slug && !out.includes(slug)) out.push(slug);
      }
      return out;
    };

    const teams: LiveTeam[] = league.teams.map((t) => {
      const rec = t.record?.overall;
      return {
        ownerSlug: primaryOf(t) ?? `roster-${t.id}`,
        ownerSlugs: creditedSlugs(t),
        rosterId: t.id,
        teamName: t.name?.replace(/\s+/g, " ").trim() || null,
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        ties: rec?.ties ?? 0,
        pointsFor: round2(rec?.pointsFor ?? 0),
        pointsAgainst: round2(rec?.pointsAgainst ?? 0),
        waiverBudgetUsed: t.transactionCounter?.acquisitionBudgetSpent ?? 0,
        // Player-level detail needs the id map and is not what the scoreboard
        // renders; the rosters hook fetches it when a page actually wants it.
        players: [],
        starters: [],
      };
    });

    const slugOf = (teamId: number) =>
      teams.find((t) => t.rosterId === teamId)?.ownerSlug ?? `roster-${teamId}`;

    /**
     * The draft has run, so the season has begun even if the NFL disagrees.
     *
     * Mirrors Sleeper's `status: in_season`: the pairings are worth showing from
     * the draft onwards, which is where the site's `drafted` phase already puts
     * the boundary. Without this the strip stays empty from the draft until
     * Thursday of week 1, which is exactly the stretch people are looking at it.
     */
    const drafted = league.draftDetail?.drafted === true;

    let matchups: LiveMatchup[] = [];
    if (seasonType === "regular" || seasonType === "post" || drafted) {
      matchups = (league.schedule ?? [])
        // The games covering THIS week. A playoff matchup period spans two
        // scoring periods, so matching on `matchupPeriodId` alone would show
        // the wrong pairing for the second week of a two-week final.
        .filter((g) => spanOf(league, g.matchupPeriodId).includes(week))
        .filter((g) => g.home?.teamId != null && g.away?.teamId != null)
        .map((g) => {
          const side = (s: EspnGameSide) => ({
            ownerSlug: slugOf(s.teamId),
            // The WEEK's points, not the matchup's running total: a two-week
            // playoff game would otherwise show week 16 and 17 added together
            // while week 17 is still being played.
            points: round2(s.pointsByScoringPeriod?.[String(week)] ?? s.totalPoints ?? 0),
          });
          return {
            // THE GAME'S id, NOT THE PERIOD'S. Every game in a week shares a
            // `matchupPeriodId`, so using it gave all five the same id — five
            // React children keyed `1`, which the reconciler is entitled to
            // collapse or reorder. `id` is unique across the season.
            matchupId: g.id ?? g.matchupPeriodId,
            a: side(g.home as EspnGameSide),
            b: side(g.away as EspnGameSide),
            final: isDecided(g.winner),
          };
        });
    }

    return {
      season: st.season,
      week,
      displayWeek: week,
      seasonType,
      status:
        finalLeg && (scoredLeg ?? 0) >= finalLeg
          ? "complete"
          : played
            ? "in_season"
            : "pre_draft",
      teams,
      matchups,
      unavailable: false,
      lastScoredLeg: scoredLeg,
    };
  },
};
