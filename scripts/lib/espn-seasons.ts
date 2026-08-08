/**
 * Building a season from ESPN's read API — the part `sync` and the importer share.
 *
 * Split out of `import-espn-seasons.ts` so the nightly sync can refresh an
 * IN-PROGRESS season through exactly the code that was validated against the
 * committed MHTML import, rather than a second implementation that would drift
 * from it. The CLI is now a thin wrapper over `syncEspnSeasons`.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchEspn, ownersByTeam, type LeagueFile } from "./espn.ts";
import { log, readJson } from "./io.ts";
import { configDir, dataDir, type ScriptLeague } from "./league.ts";

interface EspnSide {
  teamId: number;
  totalPoints?: number;
  /** scoringPeriodId -> that week's points. Present on multi-week matchups. */
  pointsByScoringPeriod?: Record<string, number>;
}
interface EspnGame {
  matchupPeriodId: number;
  playoffTierType?: string;
  home?: EspnSide;
  away?: EspnSide;
}
interface EspnTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  playoffSeed?: number;
  rankCalculatedFinal?: number;
  owners?: string[];
  primaryOwner?: string;
  record?: { overall?: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number } };
}
/**
 * The `source` this script stamps on what it writes.
 *
 * Load-bearing, not decoration: it is how a re-run tells a season it produced
 * from one imported by `import-espn.ts` off archived MHTML, which carries
 * routing the read API does not serve and must never be overwritten.
 */
export const API_SOURCE = "ESPN Fantasy (imported from the read API)";

interface EspnSeason {
  teams: EspnTeam[];
  schedule?: EspnGame[];
  /** ESPN's own scoring progress. `latestScoringPeriod` is the finalized marker. */
  status?: {
    latestScoringPeriod?: number;
    finalScoringPeriod?: number;
    currentMatchupPeriod?: number;
  };
  members?: Array<{ id: string; firstName?: string; lastName?: string }>;
  settings: {
    size: number;
    scheduleSettings?: {
      matchupPeriodCount?: number;
      playoffTeamCount?: number;
      /** matchupPeriodId -> the scoring periods it covers. Usually 1:1. */
      matchupPeriods?: Record<string, number[]>;
      playoffMatchupPeriodLength?: number;
    };
  };
}

/**
 * ESPN's three postseason sections, mapped onto the shape the site already uses.
 *
 * Sleeper has two sections; ESPN has three, and merging the last two loses both
 * the structure and the placements — see the bracket notes in AGENTS.md. The
 * names here match what the MHTML importer produces so nothing downstream can
 * tell the two apart.
 */
const SECTION: Record<string, { section: string; kind: "playoff" | "consolation" }> = {
  WINNERS_BRACKET: { section: "winners", kind: "playoff" },
  WINNERS_CONSOLATION_LADDER: { section: "winners-consolation", kind: "consolation" },
  LOSERS_CONSOLATION_LADDER: { section: "consolation", kind: "consolation" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deep-sorted key order, so a rewrite produces no spurious diff.
 *
 * NOT `JSON.stringify(x, Object.keys(x).sort())`. That second argument is a
 * property ALLOWLIST and it applies recursively, so every nested object keeps
 * only the keys that happen to appear at the top level — which silently reduced
 * all 84 matchups a season to `{}`.
 */
export function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function buildSeason(season: number, data: EspnSeason, cfg: LeagueFile | null, where: string) {
  const owners = ownersByTeam(data, cfg, where);
  const owner = new Map([...owners].map(([id, slugs]) => [id, slugs[0]]));
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  // Whitespace is collapsed: ESPN stores a location and a nickname separately and
  // one of them can carry its own trailing space, so joining them naively gives
  // "Salt Lake City  MorMoms" where every other surface shows one space.
  const teamName = (t: EspnTeam) =>
    (t.name ?? `${t.location ?? ""} ${t.nickname ?? ""}`).replace(/\s+/g, " ").trim() || `Team ${t.id}`;

  const regularSeasonWeeks = data.settings.scheduleSettings?.matchupPeriodCount ?? 14;
  const schedule = data.schedule ?? [];

  /**
   * A MATCHUP PERIOD IS NOT ALWAYS A WEEK. ESPN can run multi-week playoff
   * matchups (`playoffMatchupPeriodLength`), and this league did in 2021 and
   * 2022: matchup period 14 covers scoring periods 14 AND 15, period 15 covers
   * 16 and 17. Its scoreboard total for that game is therefore a TWO-WEEK sum.
   *
   * Taking `matchupPeriodId` as the week would put the final in week 15 when it
   * ended in week 17, and would hand a two-week score to a one-week lineup — the
   * failure the lineup importer's reconciliation exists to catch, and did.
   */
  const periods = data.settings.scheduleSettings?.matchupPeriods ?? {};
  const spanOf = (mp: number): number[] => periods[String(mp)] ?? [mp];
  const weekOf = (mp: number) => spanOf(mp)[0];
  const finalWeek = Math.max(
    regularSeasonWeeks,
    ...schedule.flatMap((g) => spanOf(g.matchupPeriodId)),
  );
  /**
   * The per-week split of a multi-week matchup, from `pointsByScoringPeriod`.
   *
   * ONE GAME, SEVERAL WEEKS. The combined total decides the game; the weekly
   * scores are what the record book must see, or a two-week sum out-ranks every
   * real single-week score. Undefined for an ordinary one-week matchup.
   */
  const splitOf = (g: EspnGame, h: EspnSide, a: EspnSide) => {
    const span = spanOf(g.matchupPeriodId);
    if (span.length < 2) return undefined;
    return span.map((wk) => ({
      week: wk,
      home: { ownerSlug: owner.get(h.teamId)!, points: round2(h.pointsByScoringPeriod?.[String(wk)] ?? 0) },
      away: { ownerSlug: owner.get(a.teamId)!, points: round2(a.pointsByScoringPeriod?.[String(wk)] ?? 0) },
    }));
  };

  const standings = data.teams
    .map((t) => {
      const r = t.record?.overall;
      if (!r) throw new Error(`${where}: team ${t.id} has no overall record`);
      return {
        finalPlace: t.rankCalculatedFinal ?? 0,
        losses: r.losses,
        ownerSlugs: owners.get(t.id)!,
        pointsAgainst: round2(r.pointsAgainst),
        pointsFor: round2(r.pointsFor),
        seed: t.playoffSeed ?? 0,
        teamName: teamName(t),
        teamSlug: owner.get(t.id)!,
        ties: r.ties,
        wins: r.wins,
      };
    })
    .sort((a, b) => a.finalPlace - b.finalPlace);

  const matchups: Array<Record<string, unknown>> = [];
  const games: Array<Record<string, unknown>> = [];
  /**
   * Rounds count from the first postseason week, ACROSS sections — not from the
   * first week the section itself appears.
   *
   * ESPN's winners-consolation ladder starts a week late, in round 2, and
   * numbering it per-section would relabel that as round 1 and slide the whole
   * ladder a week earlier than it was played. The MHTML import got this right by
   * reading the week off the page; this arrives at the same answer arithmetically.
   */
  const roundOf = (mp: number) => mp - regularSeasonWeeks;

  for (const g of schedule) {
    const sec = SECTION[g.playoffTierType ?? "NONE"];
    const sides = [g.home, g.away].filter((s): s is EspnSide => Boolean(s?.teamId));

    if (!sec) {
      // Regular season. A week with only one side is not a game.
      if (sides.length !== 2) continue;
      const [h, a] = sides;
      matchups.push({
        away: { ownerSlug: owner.get(a.teamId)!, points: round2(a.totalPoints ?? 0) },
        home: { ownerSlug: owner.get(h.teamId)!, points: round2(h.totalPoints ?? 0) },
        kind: "regular",
        week: weekOf(g.matchupPeriodId),
      });
      continue;
    }

    games.push({
      // ESPN publishes no game ids or routing on this endpoint, so brackets
      // render as round columns — the same limitation the MHTML import has.
      gameId: null,
      round: roundOf(g.matchupPeriodId),
      routing: null,
      section: sec.section,
      // The LAST week of the rung, when it spans more than one. ESPN's own
      // header reads "ROUND 1 | NFL WEEK 14-NFL WEEK 15" for exactly this.
      ...(spanOf(g.matchupPeriodId).length > 1
        ? { weekEnd: spanOf(g.matchupPeriodId).at(-1) }
        : {}),
      // AWAY FIRST, which is the order ESPN's own scoreboard shows and therefore
      // the order the MHTML import captured. `matchups` keeps home/away as named
      // fields, so only this positional list has to care.
      teams: [...sides].reverse().map((s) => ({
        points: round2(s.totalPoints ?? 0),
        seed: byId.get(s.teamId)?.playoffSeed ?? 0,
        teamName: teamName(byId.get(s.teamId)!),
      })),
      week: weekOf(g.matchupPeriodId),
    });

    // A BYE IS A BRACKET GAME BUT NOT A MATCHUP. It has one team and no
    // opponent, so counting it as a meeting would invent a game nobody played —
    // which is exactly the 19-vs-17 gap between ESPN's schedule and the
    // committed results.
    if (sides.length !== 2) continue;
    const [h, a] = sides;
    const split = splitOf(g, h, a);
    matchups.push({
      away: { ownerSlug: owner.get(a.teamId)!, points: round2(a.totalPoints ?? 0) },
      home: { ownerSlug: owner.get(h.teamId)!, points: round2(h.totalPoints ?? 0) },
      kind: sec.kind,
      week: weekOf(g.matchupPeriodId),
      ...(split ? { weeks: split } : {}),
    });
  }

  return {
    finalWeek,
    games,
    hasDrafts: false,
    hasRosters: true,
    hasWeeklyMatchups: true,
    imported: true,
    matchups,
    playoffTeams: data.settings.scheduleSettings?.playoffTeamCount ?? 6,
    playoffWeekStart: regularSeasonWeeks + 1,
    regularSeasonWeeks,
    season,
    source: API_SOURCE,
    standings,
    teams: data.settings.size,
  };
}


/**
 * Refreshes every ESPN season this league has, writing only what changed.
 *
 * IDEMPOTENT like the Sleeper path: the built JSON is deterministic, so a
 * re-run on an unchanged season produces no diff and any diff that does appear
 * is real new history.
 *
 * UNSCORED SEASONS ARE SKIPPED. ESPN creates next year's league the moment this
 * one ends, and a season with no points on the board is not history — it is a
 * schedule. Writing it would put an all-zero standings table on the site.
 */
export async function syncEspnSeasons(
  league: ScriptLeague,
  opts: { onlySeason?: string; check?: boolean } = {},
): Promise<number> {
  const cfg = readJson<LeagueFile>(join(configDir(league.slug), "league.json"));
  const ids = cfg?.espnLeagueIds ?? {};
  if (!Object.keys(ids).length) return 0;

  const dir = join(dataDir(league.slug), "manual");
  if (!opts.check && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  let written = 0;
  for (const [year, id] of Object.entries(ids).sort()) {
    const season = Number(year);
    if (opts.onlySeason && year !== opts.onlySeason) continue;

    let data: EspnSeason;
    try {
      data = await fetchEspn<EspnSeason>(
        id,
        season,
        ["mSettings", "mTeam", "mMatchupScore"].map((v) => `view=${v}`).join("&"),
      );
    } catch (err) {
      // FAIL LOUDLY ON THE CURRENT SEASON, quietly on an old one. History is
      // already committed and a 401 there just means the owner never made that
      // year public; the season being played is the one a silent skip would
      // leave silently stale.
      const newest = Math.max(...Object.keys(ids).map(Number));
      if (season === newest) throw err;
      log.skip(`${season} — ${(err as Error).message.split("\n")[0]}`);
      continue;
    }

    if (!(data.schedule ?? []).some((g) => (g.home?.totalPoints ?? 0) > 0)) {
      log.skip(`${season} — no scored games yet`);
      continue;
    }

    const path = join(dir, `${season}.json`);
    const committed = opts.check ? null : readJson<{ source?: string }>(path);

    /**
     * NEVER OVERWRITE A BETTER IMPORT.
     *
     * Den Ops' 2019-2023 came from `import-espn.ts`, which reads MHTML pages
     * saved while the league was live. Those pages carry `gameId` and `routing`
     * — the consolation ladder's explicit wiring — and the read API does not
     * serve either. Rebuilding those seasons from the API is a STRICT LOSS: it
     * nulls 45 game ids and 30 routing strings, and because record attribution
     * depends on matchup order within a week, it also silently moves the
     * "made history" badges to different games.
     *
     * Left to itself the nightly job would do exactly that, unreviewed, on its
     * first run. So a season already imported from somewhere else is never
     * touched — this script only ever owns seasons it produced.
     */
    if (committed?.source && committed.source !== API_SOURCE) {
      log.skip(`${season} — imported from a better source (${committed.source})`);
      continue;
    }

    /**
     * ONLY FINALIZED SEASONS, which is `sync`'s first invariant.
     *
     * `latestScoringPeriod` is ESPN's own marker for the last week it has
     * scored, and the season is done once it reaches `finalScoringPeriod`.
     * Checking "has any game scored" instead — which is what this did — would
     * commit a season in week 1 with sixty-odd unplayed 0-0 matchups, hand the
     * record book a 0.00 low score, and rewrite the file every night as scores
     * came in. An in-progress season is served live in the browser instead,
     * exactly as an in-progress Sleeper season is.
     */
    const latest = data.status?.latestScoringPeriod ?? 0;
    const final = data.status?.finalScoringPeriod ?? 0;
    if (!final || latest < final) {
      log.skip(`${season} — in progress (scored through ${latest} of ${final || "?"})`);
      continue;
    }

    const built = buildSeason(season, data, cfg, `${league.slug} ${season}`);
    const next = `${JSON.stringify(stable(built), null, 2)}\n`;

    if (opts.check) {
      const have = readJson<Record<string, unknown>>(path);
      if (!have) {
        log.warn(`${season}: nothing committed to compare against`);
        continue;
      }
      const a = JSON.stringify(stable(have), null, 2);
      const b = JSON.stringify(stable(built), null, 2);
      if (a === b) log.info(`${season}: identical to the committed MHTML import`);
      else {
        log.warn(`${season}: DIFFERS from the committed import`);
        for (const k of Object.keys(built).sort()) {
          const x = JSON.stringify(stable((have as Record<string, unknown>)[k]));
          const y = JSON.stringify(stable((built as Record<string, unknown>)[k]));
          if (x !== y) log.info(`   ${k}: differs (committed ${x?.length ?? 0} chars, rebuilt ${y.length})`);
        }
      }
      continue;
    }

    // Unchanged files are left alone so a no-op run has an empty git diff.
    if (existsSync(path) && readJson<unknown>(path) !== null) {
      const have = `${JSON.stringify(stable(readJson<unknown>(path)), null, 2)}\n`;
      if (have === next) continue;
    }

    // WRITE THEN RENAME. A ~1MB write killed halfway — a cancelled CI job —
    // leaves truncated JSON, and `readJson` has no try/catch, so every later
    // run would throw on the unchanged-file check before writing anything and
    // the nightly job would stay wedged until someone noticed by hand.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, next);
    renameSync(tmp, path);
    written++;
    const post = built.matchups.filter((m) => m.kind !== "regular").length;
    log.write(
      `manual/${season}.json — ${built.teams} teams · ${built.matchups.length} games ` +
        `(${built.matchups.length - post} regular, ${post} postseason) · ${built.games.length} bracket entries`,
    );
  }
  return written;
}
