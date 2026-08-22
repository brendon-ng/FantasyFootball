import { ScenarioLab } from "@/components/scenario-lab";
import { EmptyState, Panel } from "@/components/ui";
import {
  features,
  getAdp,
  getLeagueRefs,
  getKeepers,
  getOutlooks,
  getOwners,
  getPlayers,
  getPlayerUsage,
  getProjections,
  getRules,
  getSeasons,
  getUserIdToSlug,
  pageTitle,
} from "@/lib/data";
import type { Projection } from "@/lib/data";
import type { PlayerUsage } from "@/lib/types";

export const generateMetadata = () => ({ title: pageTitle("Scenario Lab") });

const MAX_KEEPERS = 4;

/**
 * Scenario Lab — a what-if draft board.
 *
 * NOT LINKED FROM THE NAV. Every tab up there describes what the league has
 * done; this describes what it has not done yet, and mixing a scratchpad into
 * that list invites a scenario being read as a record. Reaching it means typing
 * the path.
 *
 * DELIBERATELY SEPARATE FROM /keepers. That page answers "what is happening",
 * and it has to stay trustworthy — it is the one people check before the
 * deadline. This one answers "what if", and everything on it is invented. Mixing
 * the two would put an editable control next to a number people rely on.
 *
 * Gated on the keepers feature like every other keeper surface, so a redraft
 * league gets the same explanation it gets everywhere else rather than an empty
 * editor.
 */
export default function LabPage() {
  if (!features().keepers) {
    return (
      <Panel>
        <EmptyState>This league does not use keepers, so there is no board to plan.</EmptyState>
      </Panel>
    );
  }

  const owners = getOwners();
  const seasons = getSeasons();
  const adp = getAdp();
  const { draftRounds } = getRules();

  // The DRAFT season, not the contract cycle — this page is fetching and drawing
  // a specific draft, and those two numbers diverge for five months a year once
  // a draft is archived. See the ADP section in AGENTS.md.
  const nextSeason = Math.max(...seasons.map((s) => s.season), 0) + 1;
  const leagueRef = getLeagueRefs()[String(nextSeason)] ?? null;

  const contracts = getKeepers().final.filter((c) => c.ownerSlug);

  /**
   * Season-by-season usage for the modal, NARROWED to players it can open.
   *
   * `getPlayerUsage()` covers every player the league has ever rostered, which is
   * far more than this page can show — the modal only opens from an ADP row, a
   * contract or a board cell. Embedding the lot would put several hundred KB of
   * dead weight into a static page for players nobody can click.
   */
  const reachable = new Set<string>([
    ...contracts.map((c) => c.playerId),
    ...[...adp.byPlayer.keys()],
  ]);
  const allUsage = getPlayerUsage();
  const usage: Record<string, PlayerUsage[]> = {};
  for (const id of reachable) {
    const rows = allUsage[id];
    if (rows?.length) usage[id] = rows;
  }

  // Outlooks, narrowed the same way as usage — 409 exist, but only the reachable
  // ones can ever be rendered.
  const allOutlooks = getOutlooks();
  const outlooks: Record<string, string> = {};
  for (const id of reachable) {
    const t = allOutlooks.outlooks[id];
    if (t) outlooks[id] = t;
  }

  const allProj = getProjections();
  const projections: Record<string, Projection> = {};
  for (const id of reachable) {
    const pr = allProj.players[id];
    if (pr) projections[id] = pr;
  }

  // Credit is per SEASON — who co-owns a team changes — so the label is looked up
  // against that season's standings rather than the owner list. Same rule as the
  // player page; a co-owned team reads "Jaymie & Katie".
  const ownerMap = new Map(owners.map((o) => [o.slug, o]));
  const standingsBySeason = new Map(getSeasons().map((x) => [x.season, x.standings]));
  const usageOwnerLabels: Record<string, string> = {};
  for (const rows of Object.values(usage)) {
    for (const u of rows) {
      const key = `${u.season}|${u.ownerSlug}`;
      if (usageOwnerLabels[key]) continue;
      const row = standingsBySeason.get(u.season)?.find((r) => r.ownerSlug === u.ownerSlug);
      const slugs = row?.ownerSlugs?.length ? row.ownerSlugs : [u.ownerSlug];
      usageOwnerLabels[key] = slugs
        .map((sl) => ownerMap.get(sl)?.firstName ?? sl)
        .join(" & ");
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Scenario Lab</h1>
        <p className="mt-1 max-w-2xl text-sm text-chalk-500">
          Set every team&rsquo;s keepers and the draft order by hand, and watch the {nextSeason}{" "}
          board redraw. Nothing here is real and nothing is sent anywhere — it lives in this
          browser until you reset it.
        </p>
      </div>

      <ScenarioLab
        leagueRef={leagueRef}
        season={nextSeason}
        contracts={contracts}
        players={getPlayers()}
        adp={Object.fromEntries(adp.byPlayer)}
        draftRounds={draftRounds}
        maxKeepers={MAX_KEEPERS}
        userIdToSlug={getUserIdToSlug()}
        ownerNames={Object.fromEntries(owners.map((o) => [o.slug, o.name]))}
        usage={usage}
        usageOwnerLabels={usageOwnerLabels}
        outlooks={outlooks}
        outlookCapturedAt={allOutlooks.capturedAt}
        projections={projections}
      />
    </div>
  );
}
