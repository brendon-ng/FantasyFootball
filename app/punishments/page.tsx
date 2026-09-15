import { PunishmentTracker } from "@/components/punishment-tracker";
import { MARK_DEPTH } from "@/lib/record-marks";
import { EmptyState, Panel } from "@/components/ui";
import {
  features,
  getConfig,
  getOwnerMap,
  getPunishmentLows,
  getPunishmentTeams,
  getSeasonPunishments,
  getSeasons,
  getLeagueRefs,
  getLiveSchedule,
  getLiveSeason,
  getMeetings,
  getPlayerTeams,
  getRecordThresholds,
  getOwners,
  getUserIdToSlug,
  pageTitle,
  punishmentsSource,
} from "@/lib/data";

export const generateMetadata = () => ({ title: pageTitle("Punishments") });

/**
 * The weekly punishment tracker.
 *
 * TWO SOURCES, JOINED HERE. Who lost each week and by how much is derived from
 * Sleeper at build time and passed down; what they owe for it lives in a Google
 * Sheet the league edits, fetched in the browser. Neither knows about the other
 * until this page, which is the point — the sheet gets to be a sheet, and every
 * loser still links to their profile and to the game they lost.
 */
export default async function PunishmentsPage() {
  // The route is generated in every league's build — static export makes them
  // all — but only one league plays this game. Same shape as /keepers in a
  // redraft league: say why rather than render an empty board.
  if (!features().weeklyLowPunishment) {
    return (
      <Panel>
        <EmptyState>
          This league does not punish its weekly low scorer.
        </EmptyState>
      </Panel>
    );
  }

  const names = Object.fromEntries(
    [...getOwnerMap().values()].map((o) => [o.slug, o.name]),
  );
  // The scoreboard strip's inputs, exactly as the home page assembles them.
  const live = await getLiveSeason();
  const upcomingIds = (await getLiveSchedule()).map((g) => g.id);
  const archivedThrough = Math.max(
    0,
    ...getSeasons().filter((s) => s.finalized).map((s) => s.season),
  );
  const h2h = Object.fromEntries(
    getOwners().map((o) => [
      o.slug,
      Object.fromEntries(
        getOwners()
          .filter((x) => x.slug !== o.slug)
          .map((x) => {
            const g = getMeetings(o.slug, x.slug);
            let w = 0, l = 0, t = 0;
            for (const m of g) {
              if (m.a.points === m.b.points) t++;
              else if (m.a.points > m.b.points) w++;
              else l++;
            }
            return [x.slug, { wins: w, losses: l, ties: t }];
          }),
      ),
    ]),
  );
  return (
    <PunishmentTracker
      seasons={getPunishmentLows()}
      teams={getPunishmentTeams()}
      names={names}
      activeOwners={getOwners().filter((o) => o.active).length}
      leagueRefs={getLeagueRefs()}
      initialLive={live}
      thresholds={getRecordThresholds(MARK_DEPTH)}
      h2h={h2h}
      archivedThrough={archivedThrough}
      upcomingIds={upcomingIds}
      teamByPlayer={getPlayerTeams()}
      userIdToSlug={getUserIdToSlug()}
      drawTitle={pageTitle("Wheel of Punishments")}
      commissioner={getConfig().commissioner ?? null}
      seasonPunishments={Object.fromEntries(getSeasonPunishments())}
      lastPlaceBySeason={Object.fromEntries(
        getSeasons().map((x) => [x.season, x.lastPlace]),
      )}
      cloudinaryCloud={getConfig().cloudinaryCloudName ?? null}
      cloudinaryPreset={getConfig().cloudinaryUploadPreset ?? null}
      {...punishmentsSource()}
    />
  );
}
