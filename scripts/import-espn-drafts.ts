/**
 * Recovers ESPN-era DRAFTS, in the shape Sleeper drafts already take.
 *
 * The last gap in the imported seasons. `/history/<season>/draft/` existed only
 * for 2024-25 because those were the only drafts on file; ESPN's read API has the
 * other five, so the board can be rendered for every season the league has played
 * with no change to the page that draws it.
 *
 * WRITTEN AS `DraftPickRecord`, DELIBERATELY. Sleeper and ESPN describe a draft
 * differently — ESPN has `pickOrder` and `roundPickNumber` where Sleeper has
 * `slot_to_roster_id` and `draft_slot` — and the translation belongs here, once,
 * rather than in every page that reads a pick. Downstream nothing knows or cares
 * which provider a draft came from.
 *
 * THE SLOT IS COMPUTED, NOT GIVEN. ESPN records which pick of the round a
 * selection was, not which draft column it came from, and in a snake those differ
 * in every even round. `pickOrder` then names the slot's owner, exactly as
 * `slot_to_roster_id` does for Sleeper — which is what makes a traded pick
 * visible: the team that used the pick is not the team the slot belongs to.
 */

import { join } from "node:path";

import { log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";
import {
  espnPlayerUniverse,
  fetchEspn,
  matchPlayer,
  ownerByTeam,
  sleeperIndex,
  type LeagueFile,
} from "./lib/espn.ts";

interface EspnDraft {
  draftDetail: {
    drafted: boolean;
    completeDate?: number | null;
    picks: Array<{
      overallPickNumber: number;
      roundId: number;
      roundPickNumber: number;
      teamId: number;
      playerId: number;
      keeper: boolean;
      reservedForKeeper: boolean;
      bidAmount?: number;
    }>;
  };
  settings: {
    draftSettings: {
      type: string;
      date?: number | null;
      pickOrder?: number[];
      keeperCount?: number;
      isTradingEnabled?: boolean;
    };
  };
  teams: Array<{ id: number; primaryOwner?: string; owners?: string[] }>;
  members?: Array<{ id: string; firstName?: string; lastName?: string }>;
}

/** One recovered draft. Mirrors `DraftPickRecord` minus the season. */
export interface SeasonDraft {
  season: number;
  startTime: number | null;
  type: string;
  rounds: number;
  teams: number;
  picks: Array<{
    round: number;
    pickNo: number;
    draftSlot: number;
    ownerSlug: string | null;
    slotOwnerSlug: string | null;
    playerId: string;
    isKeeper: boolean;
  }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const onlySeason = arg("season") ? Number(arg("season")) : null;

  const idx = sleeperIndex();

  for (const league of resolveLeagues(arg("league") ? [`--league=${arg("league")}`] : [])) {
    const slug = league.slug;
    const cfg = readJson<LeagueFile>(join(configDir(slug), "league.json"));
    const ids = cfg?.espnLeagueIds ?? {};
    if (!Object.keys(ids).length) {
      log.skip(`${slug}: no espnLeagueIds in league.json`);
      continue;
    }

    for (const [seasonKey, espnId] of Object.entries(ids)) {
      const season = Number(seasonKey);
      if (onlySeason && season !== onlySeason) continue;

      const data = await fetchEspn<EspnDraft>(
        espnId,
        season,
        "view=mDraftDetail&view=mSettings&view=mTeam",
      );
      const raw = data.draftDetail?.picks ?? [];
      if (!data.draftDetail?.drafted || !raw.length) {
        log.skip(`${slug} ${season}: no draft on record`);
        continue;
      }

      const owners = ownerByTeam(data, cfg, `${slug} ${season}`);
      // Names come from the season's player universe: a draft pick is a bare id.
      const universe = await espnPlayerUniverse(season);
      const ds = data.settings.draftSettings;
      const order = ds.pickOrder ?? [];
      const teams = order.length || owners.size;
      const rounds = Math.max(...raw.map((p) => p.roundId));

      if (!order.length) {
        throw new Error(
          `${slug} ${season}: ESPN returned no pickOrder, so no pick can be attributed ` +
            `to a draft slot and a traded pick would be indistinguishable from a normal one.`,
        );
      }
      if (raw.length !== teams * rounds) {
        throw new Error(
          `${slug} ${season}: ${raw.length} picks, expected ${teams * rounds} ` +
            `(${rounds} rounds x ${teams} teams). A short draft means picks are missing.`,
        );
      }

      const renames = new Set<string>();
      let unmatched = 0;
      const picks = raw
        .slice()
        .sort((a, b) => a.overallPickNumber - b.overallPickNumber)
        .map((p) => {
          // Snake: odd rounds run left to right, even rounds right to left, so the
          // same slot is a different pick number depending on the round.
          const slot =
            ds.type === "SNAKE" && p.roundId % 2 === 0
              ? teams - p.roundPickNumber + 1
              : p.roundPickNumber;
          const known = universe.get(p.playerId);
          if (!known) {
            throw new Error(
              `${slug} ${season}: ESPN player ${p.playerId} (pick ${p.overallPickNumber}) is not ` +
                `in that season's player list, so it cannot be named or matched.`,
            );
          }
          const m = matchPlayer(known, idx);
          if (!m.matched) unmatched += 1;
          if (m.renamed) renames.add(m.renamed);
          return {
            round: p.roundId,
            pickNo: p.overallPickNumber,
            draftSlot: slot,
            ownerSlug: owners.get(p.teamId) ?? null,
            slotOwnerSlug: owners.get(order[slot - 1]) ?? null,
            playerId: m.id,
            isKeeper: Boolean(p.keeper || p.reservedForKeeper),
          };
        });

      const traded = picks.filter((p) => p.ownerSlug !== p.slotOwnerSlug);
      const out: SeasonDraft = {
        season,
        startTime: ds.date ?? data.draftDetail.completeDate ?? null,
        type: (ds.type ?? "snake").toLowerCase(),
        rounds,
        teams,
        picks,
      };
      writeJson(join(dataDir(slug), "manual", "drafts", `${season}.json`), out);

      log.info(
        `${slug} ${season}: ${picks.length} picks, ${rounds} rounds x ${teams} teams, ` +
          `${traded.length} traded, ${picks.filter((p) => p.isKeeper).length} keepers` +
          (unmatched ? `, ${unmatched} UNMATCHED players` : ""),
      );
      for (const t of traded) {
        log.info(`      R${t.round}.${String(t.draftSlot).padStart(2, "0")} ${t.slotOwnerSlug} -> ${t.ownerSlug}`);
      }
      if (renames.size) {
        log.warn(`${slug} ${season}: matched under a different name —`);
        for (const r of [...renames].sort()) log.warn(`      ${r}`);
      }
    }
  }
}

await main();
