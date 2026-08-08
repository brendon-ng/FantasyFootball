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

import { syncEspnSeasons } from "./lib/espn-seasons.ts";
import { log } from "./lib/io.ts";
import { resolveLeagues } from "./lib/league.ts";

const args = new Set(process.argv.slice(2));
/** Rebuild and diff against what is committed, writing nothing. */
const CHECK = args.has("--check");
const ONLY = [...args].find((a) => a.startsWith("--season="))?.split("=")[1];

for (const league of resolveLeagues(process.argv.slice(2))) {
  if (!league.features?.espnImport) {
    log.skip(`${league.slug} — espnImport not enabled`);
    continue;
  }
  log.step(`■ ${league.name} (${league.slug})`);
  await syncEspnSeasons(league, { onlySeason: ONLY, check: CHECK });
}

log.step("Done");
