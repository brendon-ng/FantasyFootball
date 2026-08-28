import Link from "next/link";

import { ScenarioLab } from "@/components/scenario-lab";

import {
  features,
  getDrafts,
  getKeepers,
  getLeagueRefs,
  getLiveAdp,
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
 * NOT GATED ON KEEPERS. It was, and that was too broad: the draft order, the
 * board and the available pool are just as useful to a redraft league — arguably
 * more so, since a redraft team has nothing but the draft. Only the keeper half
 * is gated, and with `features.keepers` off the contracts list is empty anyway,
 * so the machinery below degrades on its own rather than needing branches.
 */
export default function LabPage() {
  const owners = getOwners();
  const seasons = getSeasons();
  /**
   * LIVE, not the frozen snapshot `/keepers` uses.
   *
   * The lock exists so keeper costs stop moving before the deadline; this page is
   * asking what the draft looks like right now, and a market fixed days ago would
   * disagree with the board it is drawing. See `getLiveAdp`.
   */
  const adp = getLiveAdp();
  const { draftRounds } = getRules();

  // The DRAFT season, not the contract cycle — this page is fetching and drawing
  // a specific draft, and those two numbers diverge for five months a year once
  // a draft is archived. See the ADP section in AGENTS.md.
  const nextSeason = Math.max(...seasons.map((s) => s.season), 0) + 1;
  const leagueRef = getLeagueRefs()[String(nextSeason)] ?? null;

  // Empty for a redraft league — `resolveKeepers()` never runs there — which is
  // what makes the rest of this page work unchanged.
  const keepers = features().keepers;
  /**
   * The draft this page plans is already in the books.
   *
   * IT BECOMES A RECORD, NOT A DEAD PAGE. Standing the whole thing down was the
   * wrong call: the board and the available pool are still worth reading after a
   * draft — which players went where, and what happened to the ones you starred.
   * So the page stays and only its framing changes; what it cannot do is plan the
   * NEXT draft, since that needs a league the provider has not created yet.
   *
   * Build-time, from the committed picks, so the copy is right on first paint.
   */
  const drafted = getDrafts().some((d) => d.season === nextSeason);

  const contracts = keepers ? getKeepers().final.filter((c) => c.ownerSlug) : [];

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
          {drafted ? (
            <>
              The {nextSeason} draft is done, so this is a record of it rather than a plan —
              the board below is how it fell, and the pool remembers who you starred.{" "}
              <Link
                href={`/history/${nextSeason}/draft/`}
                className="text-chalk-400 transition-colors hover:text-accent"
              >
                See it as a board →
              </Link>
            </>
          ) : (
            <>
              Set {keepers ? <>every team&rsquo;s keepers and </> : null}the draft order by hand,
              and watch the {nextSeason} board redraw. Nothing here is real and nothing is sent
              anywhere — it lives in this browser until you reset it.
            </>
          )}
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
        keepers={keepers}
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
