import Link from "next/link";

import type { KeeperContract, PlayerMeta } from "@/lib/types";

/** Position pill colours — muted so they read as metadata, not emphasis. */
const POS: Record<string, string> = {
  QB: "bg-rose-500/12 text-rose-300",
  RB: "bg-emerald-500/12 text-emerald-300",
  WR: "bg-sky-500/12 text-sky-300",
  TE: "bg-amber-500/12 text-amber-300",
  K: "bg-violet-500/12 text-violet-300",
  DEF: "bg-slate-500/15 text-slate-300",
};

export function PositionPill({ position }: { position: string | null }) {
  const p = position ?? "—";
  return (
    <span
      className={`inline-block w-8 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold tracking-wide ${
        POS[p] ?? "bg-ink-600 text-chalk-500"
      }`}
    >
      {p}
    </span>
  );
}

/**
 * Renders "keeps left" as pips rather than a number.
 *
 * A contract is short (2 keeps), so pips communicate remaining life at a glance
 * in a way "1" does not — and an empty row reads immediately as expired.
 */
export function KeepPips({ used, total }: { used: number; total: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${total - used} of ${total} keeps left`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-full ${i < total - used ? "bg-accent" : "bg-ink-500"}`}
        />
      ))}
    </span>
  );
}

export function KeeperRow({
  contract,
  player,
  rank,
  eligible,
}: {
  contract: KeeperContract;
  player: PlayerMeta | undefined;
  rank?: number;
  eligible: boolean;
}) {
  const total = contract.keepsUsed + contract.keepsRemaining;
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 sm:gap-3 sm:px-4 ${
        eligible ? "" : "opacity-45"
      }`}
    >
      {rank !== undefined ? (
        <span className="tabular w-4 shrink-0 text-[11px] text-chalk-600">{rank}</span>
      ) : null}
      <PositionPill position={player?.position ?? null} />
      <Link
        href={`/players/${contract.playerId}/`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-chalk-100 transition-colors hover:text-accent"
      >
        {player?.full_name ?? contract.playerId}
        {player?.team ? (
          <span className="ml-1.5 text-[11px] font-normal text-chalk-600">{player.team}</span>
        ) : null}
      </Link>
      <KeepPips used={contract.keepsUsed} total={total} />
      <span
        className={`tabular w-9 shrink-0 text-right text-sm font-bold ${
          contract.expired ? "text-loss" : "text-accent"
        }`}
      >
        {contract.expired ? "ADP" : `R${contract.round}`}
      </span>
    </div>
  );
}
