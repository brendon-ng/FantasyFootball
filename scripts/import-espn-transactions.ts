/**
 * Recovers ESPN-era TRANSACTIONS — adds, drops, waivers and trades.
 *
 * FOUND ON THE PLAYER CARD, NOT A LEAGUE VIEW. `view=mTransactions2` returns an
 * empty list for these closed leagues, which is why this looked unrecoverable at
 * first. The data is hanging off `kona_playercard` instead: ask for the players
 * and each one carries the transactions it was part of. Deduping by transaction
 * id reassembles the league's whole log.
 *
 * A bare `limit` in the filter is rejected — "Limit request must be accompanied
 * by a sort" — so the sort below is load-bearing, not decoration.
 *
 * A TRADE ARRIVES WHOLE. Every leg shares one transaction id and sits in the same
 * `items` array, so "who for whom" survives, which a per-player log cannot express.
 *
 * `status === "EXECUTED"` IS THE ONLY TRUTH TEST. `isPending` is not: two 2021
 * trades carry `isPending: true` and every player in them demonstrably changed
 * hands, checked against the imported lineups for the weeks either side. Treating
 * that flag as "vetoed" would have silently deleted two real trades.
 */

import { join } from "node:path";

import { log, readJson, writeJson } from "./lib/io.ts";
import { configDir, dataDir, resolveLeagues } from "./lib/league.ts";
import {
  espnAuth,
  espnPlayerUniverse,
  matchPlayer,
  ownerByTeam,
  sleeperIndex,
  type LeagueFile,
} from "./lib/espn.ts";

/** Lifted page size. The sort is required by ESPN, not by us. */
const FILTER = JSON.stringify({
  players: { limit: 2000, offset: 0, sortPercOwned: { sortPriority: 1, sortAsc: false } },
});

interface EspnItem {
  playerId: number;
  fromTeamId: number;
  toTeamId: number;
  type: string;
  acquisitionBudget?: number;
  overallPickNumber?: number;
}
interface EspnTx {
  id: string;
  type: string;
  status: string;
  isPending?: boolean;
  proposedDate: number;
  scoringPeriodId: number;
  teamId: number;
  bidAmount?: number;
  items: EspnItem[];
}
interface CardResponse {
  players?: Array<{ transactions?: EspnTx[] }>;
  teams: Array<{ id: number; primaryOwner?: string; owners?: string[] }>;
  members?: Array<{ id: string; firstName?: string; lastName?: string }>;
}

/** One move within a transaction. Mirrors the unified `TradeLeg`. */
export interface ManualTxItem {
  playerId: string;
  /** Null means free agency — ESPN uses team 0 for "nobody". */
  fromSlug: string | null;
  toSlug: string | null;
}

export interface ManualTx {
  id: string;
  /** True when ESPN reports anything other than EXECUTED. */
  vetoed?: boolean;
  /** "add" | "drop" | "waiver" | "trade" | "draft" */
  kind: string;
  week: number;
  timestamp: number;
  faab: number;
  ownerSlugs: string[];
  items: ManualTxItem[];
}

const KIND: Record<string, string> = {
  FREEAGENT: "add",
  WAIVER: "waiver",
  TRADE_ACCEPT: "trade",
  ROSTER: "drop",
  DRAFT: "draft",
};

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

    for (const [key, espnId] of Object.entries(ids)) {
      const season = Number(key);
      if (onlySeason && season !== onlySeason) continue;

      const res = await fetch(
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
          `/segments/0/leagues/${espnId}?scoringPeriodId=18&view=kona_playercard&view=mTeam`,
        // `espnAuth()` so a PRIVATE league's history is reachable; empty and
        // harmless for a public one. This endpoint is hand-rolled rather than
        // going through `fetchEspn` because it needs the filter header.
        { headers: { ...espnAuth(), "x-fantasy-filter": FILTER } },
      );
      if (res.status === 401) {
        throw new Error(
          `${slug} ${season}: 401 — that season is private. Add .espn-auth.json with ` +
            `espn_s2 and SWID cookies from a logged-in browser.`,
        );
      }
      if (!res.ok) throw new Error(`${slug} ${season}: HTTP ${res.status}`);
      const data = (await res.json()) as CardResponse;

      const owners = ownerByTeam(data, cfg, `${slug} ${season}`);
      const universe = await espnPlayerUniverse(season);

      // One player's card lists a transaction once; a trade appears on every
      // player in it. The id is what collapses those back into one event.
      const raw = new Map<string, EspnTx>();
      for (const p of data.players ?? []) {
        for (const t of p.transactions ?? []) raw.set(t.id, t);
      }

      const rejected = new Map<string, number>();
      const out: ManualTx[] = [];
      for (const t of raw.values()) {
        // A NON-EXECUTED TRADE IS STILL HISTORY, so it is kept and flagged rather
        // than dropped: the league agreed it and then threw it out, which belongs
        // in a list of trades. Anything else that failed is noise — a lost waiver
        // claim is not an event, it is an attempt.
        const vetoed = t.status !== "EXECUTED";
        if (vetoed) {
          rejected.set(t.status, (rejected.get(t.status) ?? 0) + 1);
          if (t.type !== "TRADE_ACCEPT") continue;
        }
        // Draft picks are already recovered by `import:espn:drafts`, in a shape
        // that knows about slots. Repeating them here would double-count.
        if (t.type === "DRAFT") continue;

        const items: ManualTxItem[] = [];
        const involved = new Set<string>();
        for (const i of t.items) {
          const known = universe.get(i.playerId);
          if (!known) {
            throw new Error(
              `${slug} ${season}: transaction ${t.id} references ESPN player ${i.playerId}, ` +
                `which is not in that season's player list.`,
            );
          }
          const m = matchPlayer(known, idx);
          const from = owners.get(i.fromTeamId) ?? null;
          const to = owners.get(i.toTeamId) ?? null;
          if (from) involved.add(from);
          if (to) involved.add(to);
          items.push({ playerId: m.id, fromSlug: from, toSlug: to });
        }
        if (!items.length) continue;

        out.push({
          id: t.id,
          vetoed,
          kind: KIND[t.type] ?? t.type.toLowerCase(),
          week: t.scoringPeriodId,
          timestamp: t.proposedDate,
          faab: t.bidAmount ?? 0,
          ownerSlugs: [...involved].sort(),
          items,
        });
      }

      out.sort((a, b) => a.timestamp - b.timestamp);
      writeJson(join(dataDir(slug), "manual", "transactions", `${season}.json`), {
        season,
        transactions: out,
      });

      const byKind = out.reduce<Record<string, number>>((acc, t) => {
        acc[t.kind] = (acc[t.kind] ?? 0) + 1;
        return acc;
      }, {});
      const trades = out.filter((t) => t.kind === "trade");
      const multi = trades.filter((t) => t.ownerSlugs.length > 2);
      log.info(
        `${slug} ${season}: ${out.length} transactions ` +
          Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ") +
          (multi.length ? `, ${multi.length} multi-team` : ""),
      );
      if (rejected.size) {
        log.warn(
          `${slug} ${season}: non-executed — ` +
            [...rejected].map(([s, n]) => `${s} ${n}`).join(", ") +
            " (trades kept and flagged, everything else dropped)",
        );
      }
    }
  }
}

await main();
