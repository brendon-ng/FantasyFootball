
import { DraftPlan } from "@/components/draft-plan";
import { SeasonPanels } from "@/components/season-panels";
import { H2HMatrix } from "@/components/h2h-matrix";
import { HomeKeeperBoard } from "@/components/home-keeper-board";
import { RecordHighlights } from "@/components/record-highlights";
import { EmptyState, Panel, PanelHeader, Stat } from "@/components/ui";
import {
  creditedNames,
  features,
  getAdp,
  getRules,
  keeperCycleSeason,
  getAllMeetings,
  getConfig,
  getKeepers,
  getLiveSeason,
  getOwnerMap,
  getOwnerRecords,
  getPlayers,
  getRecordThresholds,
  getRecords,
  getSeasons,
  meetingId,
} from "@/lib/data";

/**
 * League at a glance.
 *
 * The page adapts to where the calendar actually is. In season it leads with
 * standings and this week's matchups; in the offseason neither exists yet, so it
 * leads with keeper contracts heading into the draft and last season's final
 * table — which is what people are actually arguing about in August.
 */
export default async function HomePage() {
  const live = await getLiveSeason();
  const seasons = getSeasons();
  const owners = getOwnerMap();
  const records = getOwnerRecords();
  // Alphabetical: a matrix is looked up by name, not read down by rank.
  const activeOwners = [...owners.values()]
    .filter((o) => o.active)
    .map((o) => ({ slug: o.slug, name: o.name, firstName: o.firstName }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const keepers = getKeepers();
  const players = getPlayers();
  const adp = getAdp();
  const { draftRounds } = getRules();
  const cfg = getConfig();

  const finalized = seasons.filter((s) => s.finalized).sort((a, b) => b.season - a.season);
  const lastSeason = finalized[0];
  const currentSeason = live?.season ?? (lastSeason ? lastSeason.season + 1 : 0);

  // Live rosters first — they are authoritative for the season being played, and
  // are the only source in a league's first year, before any season finalizes.
  const leagueSize = live?.teams.length || lastSeason?.teams || 0;

  // Was hardcoded "10 teams · PPR keeper", which is wrong for any other league.
  const format = `${leagueSize} teams · PPR ${features().keepers ? "keeper" : "redraft"}`;
  const preDraftNote = features().keepers
    ? "Pre-draft · keeper deadline is 3 days before the draft"
    : "Pre-draft";


  // Live contracts grouped by owner, best (earliest round) first.
  const byOwner = new Map<string, typeof keepers.final>();
  for (const c of keepers.final) {
    if (!c.ownerSlug) continue;
    byOwner.set(c.ownerSlug, [...(byOwner.get(c.ownerSlug) ?? []), c]);
  }
  for (const list of byOwner.values()) list.sort((a, b) => a.round - b.round);

  const MAX_KEEPERS = 4;

  const thresholds = getRecordThresholds();
  const recordBook = getRecords();
  // Only link record rows whose matchup page was actually generated; a dead link
  // is worse than a plain row.
  const meetings = new Set(getAllMeetings().map((m) => m.id));

  // Home is a snapshot of the league as it stands, so the leaderboard is current
  // owners only. Departed owners (and the full table) live on the history page.
  //
  // Length is the league's team count, not a fixed 10, so a 12-team league is
  // not silently cut to 10. Note it is TEAMS, not active owners: co-owned teams
  // mean Den Ops has 12 active owners across 10 teams, so the last couple still
  // fall below the fold here. The full table on /history has everyone.
  const leaders = records
    .filter((r) => owners.get(r.ownerSlug)?.active)
    .slice(0, leagueSize || 10);

  return (
    <div className="space-y-5 sm:space-y-6">
      <SeasonPanels
        initial={live}
        leagueIdBySeason={cfg.knownLeagueIds}
        ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
        userIdToSlug={Object.fromEntries(
          [...owners.values()].filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
        )}
        lastSeason={lastSeason ?? null}
        leaders={leaders}
        thresholds={thresholds}
        format={format}
        preDraftNote={preDraftNote}
        fallbackSeason={currentSeason}
        // ACTIVE OWNERS ONLY. Which pairs play is decided client-side, so the
        // whole matrix has to ship — but a departed owner cannot appear in this
        // week's fixtures, and dropping them cuts it by about a third.
        h2h={Object.fromEntries(
          records
            .filter((r) => owners.get(r.ownerSlug)?.active)
            .map((r) => [
              r.ownerSlug,
              Object.fromEntries(
                Object.entries(r.vs)
                  .filter(([opp]) => owners.get(opp)?.active)
                  .map(([opp, v]) => [opp, { wins: v.wins, losses: v.losses, ties: v.ties }]),
              ),
            ]),
        )}
        lastSeasonTiles={
          lastSeason ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat
                label={`${lastSeason.season} Champion`}
                value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.champion)}</span>}
                tone="gold"
              />
              <Stat
                label="Runner-up"
                value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.runnerUp)}</span>}
              />
              <Stat
                label="Third"
                value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.thirdPlace)}</span>}
              />
              <Stat
                label="Last Place"
                value={<span className="text-base sm:text-lg">{creditedNames(lastSeason.standings, lastSeason.lastPlace)}</span>}
                sub="Toilet bowl loser"
              />
            </div>
          ) : null
        }
      >
      {/* Renders nothing until Sleeper has both a draft date and an order. */}
      <DraftPlan
        leagueId={cfg.knownLeagueIds[String(currentSeason)] ?? null}
        season={currentSeason}
        userIdToSlug={Object.fromEntries(
          [...owners.values()].filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
        )}
        ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
        keepers={features().keepers}
      />

      </SeasonPanels>

      {features().keepers ? (
        <Panel>
          <PanelHeader
            // The CYCLE, not the NFL season. A completed draft rolls every
            // contract onto the next year, so from late August these are next
            // year's costs while `currentSeason` is still this year's football.
            title={`Keeper Board · Entering ${keeperCycleSeason()}`}
            meta={
              adp.capturedAt
                ? `top ${MAX_KEEPERS} per team · ADP ${adp.frozen ? "locked" : "live"}`
                : `top ${MAX_KEEPERS} eligible per team`
            }
            legend={
              <>
                Columns: <span className="text-chalk-400">Sleeper ADP</span> ·{" "}
                <span className="text-chalk-400">rounds cheaper (+) or dearer (−) than market</span>{" "}
                · <span className="text-chalk-400">keeps left</span> ·{" "}
                <span className="text-chalk-400">round it costs to keep</span>
              </>
            }
            href="/keepers/"
            hrefLabel="Full keeper tracker"
          />
          {byOwner.size === 0 ? (
            <EmptyState>No contracts yet — run npm run data.</EmptyState>
          ) : (
            <HomeKeeperBoard
              draftRounds={draftRounds}
              contractsByOwner={[...byOwner.entries()].sort(([a], [b]) =>
                (owners.get(a)?.name ?? a).localeCompare(owners.get(b)?.name ?? b),
              )}
              ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
              userIdToSlug={Object.fromEntries(
                [...owners.values()].filter((o) => o.userId).map((o) => [o.userId as string, o.slug]),
              )}
              players={players}
              adp={Object.fromEntries(adp.byPlayer)}
              leagueId={cfg.knownLeagueIds[String(currentSeason)] ?? null}
              maxKeepers={MAX_KEEPERS}
            />
          )}
        </Panel>
      ) : null}

      {/* Shown for every league. It is the whole offseason panel for a redraft
          league, where there is no keeper board and nothing current to say — a
          redraft roster is empty until the draft. */}
      <Panel>
        <PanelHeader
          title="Record Book"
          meta="all-time · top 3"
          href="/records/"
          hrefLabel="Full records"
          legend="Rank · team · when it happened · points, or margin for the blowout and closest-win lists. Click any row for the game."
        />
        <RecordHighlights
          records={recordBook}
          ownerNames={Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]))}
          href={(a, b, season, week) =>
            b && meetings.has(meetingId(season, week, a, b))
              ? `/matchups/${meetingId(season, week, a, b)}/`
              : null
          }
        />
      </Panel>
      {/* Same panel as the foot of the history page. The home page is where
          people land, and "how do I do against him" is a question they arrive
          with — it should not need two clicks through a profile to answer. */}
      {activeOwners.length > 1 ? (
        <Panel>
          <PanelHeader
            title="Head to Head"
            meta="active owners"
            href="/history/"
            hrefLabel="League history"
          />
          <H2HMatrix owners={activeOwners} records={records} />
        </Panel>
      ) : null}
    </div>
  );
}

/** In-season standings, ordered by wins then points for (bylaws 1.8.2.4). */
