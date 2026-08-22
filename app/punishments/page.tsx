import { PunishmentTracker } from "@/components/punishment-tracker";
import { EmptyState, Panel } from "@/components/ui";
import {
  features,
  getConfig,
  getOwnerMap,
  getPunishmentLows,
  getPunishmentTeams,
  getLeagueRefs,
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
export default function PunishmentsPage() {
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
  return (
    <PunishmentTracker
      seasons={getPunishmentLows()}
      teams={getPunishmentTeams()}
      names={names}
      activeOwners={getOwners().filter((o) => o.active).length}
      leagueRefs={getLeagueRefs()}
      userIdToSlug={getUserIdToSlug()}
      drawTitle={pageTitle("Wheel of Punishments")}
      commissioner={getConfig().commissioner ?? null}
      cloudinaryCloud={getConfig().cloudinaryCloudName ?? null}
      cloudinaryPreset={getConfig().cloudinaryUploadPreset ?? null}
      {...punishmentsSource()}
    />
  );
}
