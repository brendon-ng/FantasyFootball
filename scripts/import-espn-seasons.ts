/**
 * Rebuilds a season's standings, results and bracket from ESPN's read API.
 *
 * WHY THIS EXISTS. `import-espn.ts` recovers all of that too, but only from MHTML
 * pages saved by hand — one per week, plus the standings. That was the right tool
 * when the data was already archived; it is a poor one for a league joining the
 * site now, where it means ninety manual saves. Everything those pages showed is
 * in the API, which is where the page got it.
 *
 * VALIDATED AGAINST THE MHTML IMPORT rather than trusted. Den Ops 2019-2023 exist
 * in both forms, so `--check` rebuilds them from the API and diffs against the
 * committed files instead of writing anything. That is the only honest way to
 * know this agrees with the importer it is standing in for.
 *
 * A PRIVATE LEAGUE needs `.espn-auth.json`; see `espnAuth()`. ESPN's visibility is
 * per SEASON, so a league can be readable this year and 401 for every year before
 * it — which is exactly the case this was written for.
 *
 *   npm run import:espn:seasons
 *   npm run import:espn:seasons -- --league=apartment-401
 *   npm run import:espn:seasons -- --league=den-ops --check
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchEspn, ownersByTeam, type LeagueFile } from "./lib/espn.ts";
import { log, readJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";

const args = new Set(process.argv.slice(2));
/** Rebuild and diff against what is committed, writing nothing. */
const CHECK = args.has("--check");
const ONLY = [...args].find((a) => a.startsWith("--season="))?.split("=")[1];

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
interface EspnSeason {
  teams: EspnTeam[];
  schedule?: EspnGame[];
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
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function buildSeason(season: number, data: EspnSeason, cfg: LeagueFile | null, where: string) {
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
    source: "ESPN Fantasy (imported from the read API)",
    standings,
    teams: data.settings.size,
  };
}

for (const league of resolveLeagues(process.argv.slice(2))) {
  if (!league.features?.espnImport) {
    log.skip(`${league.slug} — espnImport not enabled`);
    continue;
  }
  const cfg = readJson<LeagueFile>(join(configDir(league.slug), "league.json"));
  const ids = cfg?.espnLeagueIds ?? {};
  if (!Object.keys(ids).length) {
    log.skip(`${league.slug} — no espnLeagueIds`);
    continue;
  }
  log.step(`■ ${league.name} (${league.slug})`);

  const dir = join(dataDir(league.slug), "manual");
  if (!CHECK && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  for (const [year, id] of Object.entries(ids).sort()) {
    const season = Number(year);
    if (ONLY && year !== ONLY) continue;

    const data = await fetchEspn<EspnSeason>(
      id,
      season,
      ["mSettings", "mTeam", "mMatchupScore"].map((v) => `view=${v}`).join("&"),
    );
    // A season ESPN knows about but that has not been played is not history.
    if (!(data.schedule ?? []).some((g) => (g.home?.totalPoints ?? 0) > 0)) {
      log.skip(`${season} — no scored games yet`);
      continue;
    }

    const built = buildSeason(season, data, cfg, `${league.slug} ${season}`);
    const path = join(dir, `${season}.json`);

    if (CHECK) {
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

    writeFileSync(path, `${JSON.stringify(stable(built), null, 2)}\n`);
    const post = built.matchups.filter((m) => m.kind !== "regular").length;
    log.write(
      `manual/${season}.json — ${built.teams} teams · ${built.matchups.length} games ` +
        `(${built.matchups.length - post} regular, ${post} postseason) · ${built.games.length} bracket entries`,
    );
  }
}

log.step("Done");
