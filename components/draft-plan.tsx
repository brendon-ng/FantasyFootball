"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Panel, PanelHeader } from "@/components/ui";
import { keeperDeadline } from "@/lib/draft-slots";
import { useLiveDraft, useLiveRosters } from "@/lib/sleeper-browser";

/**
 * When the draft is, when keepers are due, and the order.
 *
 * Renders NOTHING until Sleeper has both a date and an order. Before that there
 * is no news, and an empty "draft: TBD" panel on the home page is worse than the
 * space it takes — the keeper board below it is the actual offseason story.
 *
 * Live for the same reason as everything else here: the order is drawn after the
 * keeper deadline and the date moves, neither of which waits for a deploy.
 */

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The clock, to the minute.
 *
 * `useSyncExternalStore` rather than `Date.now()` in render (impure) or a
 * `setState` in an effect (a cascading render) — the same reasoning as
 * `components/identity.tsx`. Minute granularity keeps `getSnapshot` stable within
 * a render, which the store contract requires, and the countdown is coarse anyway.
 *
 * The server snapshot is 0, meaning "unknown", so no relative time is baked into
 * static HTML — it would be stale before anyone read it.
 */
const subscribeToNothing = () => () => {};
const nowToTheMinute = () => Math.floor(Date.now() / 60_000);
const noClockOnServer = () => 0;

/** "in 12 days" / "in 4 hours" / "today". Coarse on purpose. */
function until(ts: number, now: number): string {
  const ms = ts - now;
  if (ms < 0) return "passed";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return "within the hour";
}

export function DraftPlan({
  leagueId,
  season,
  userIdToSlug,
  ownerNames,
}: {
  leagueId: string | null;
  season: number;
  userIdToSlug: Record<string, string>;
  ownerNames: Record<string, string>;
}) {
  const draft = useLiveDraft(leagueId);
  const rosters = useLiveRosters(leagueId);
  const minute = useSyncExternalStore(subscribeToNothing, nowToTheMinute, noClockOnServer);
  const now = minute === 0 ? null : minute * 60_000;
  const d = draft.data;

  // Nothing to say until both exist, and nothing to say once it has happened.
  if (!d || !d.orderSet || !d.startTime || d.status === "complete") return null;

  const deadline = keeperDeadline(d.startTime);
  const passed = now !== null && deadline < now;

  const rosterToSlug = new Map<number, string>();
  for (const r of rosters.data ?? []) {
    const slug = r.ownerId ? userIdToSlug[r.ownerId] : undefined;
    if (slug) rosterToSlug.set(r.rosterId, slug);
  }
  const slots = Object.keys(d.slotToRoster)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <Panel>
      <PanelHeader
        title={`${season} Draft`}
        meta={d.mocked ? undefined : "live from Sleeper"}
        legend="Keeper selections are due three days before the draft (bylaws 1.7). After that, keeper picks are frozen and can no longer be traded."
      />
      <div className="grid gap-2.5 p-4 sm:grid-cols-2 sm:p-5">
        <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-3">
          <div className="eyebrow mb-1.5 flex items-center gap-2 text-[10px]">
            Draft
            {d.mocked ? (
              <span
                className="rounded border border-gold/50 bg-gold/10 px-1.5 text-[9px] font-bold uppercase tracking-wide text-gold"
                title="Stand-in date and order. Sleeper has not set these."
              >
                Mock
              </span>
            ) : null}
          </div>
          <div className="text-base font-semibold sm:text-lg">{dateFmt.format(d.startTime)}</div>
          <div className="mt-1 text-[11px] text-chalk-600">
            {now === null ? "" : until(d.startTime, now)}
          </div>
        </div>
        <div className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-3">
          <div className="eyebrow mb-1.5 text-[10px]">Keeper deadline</div>
          <div
            className={`text-base font-semibold sm:text-lg ${
              passed ? "text-chalk-500" : "text-accent"
            }`}
          >
            {dateFmt.format(deadline)}
          </div>
          <div className="mt-1 text-[11px] text-chalk-600">
            {now === null ? "" : passed ? "passed — picks are frozen" : until(deadline, now)}
          </div>
        </div>
      </div>

      <div className="border-t border-ink-600 px-4 pb-4 pt-3 sm:px-5">
        <div className="eyebrow mb-2 text-[10px]">Draft order</div>
        {/* One line that scrolls, not a wrapping list. Wrapping left a ragged
            second row of one or two names, and a draft order reads 1..N — a
            column-major grid would fix the ragged edge but break the reading. */}
        <ol className="-mx-1 flex flex-nowrap gap-x-4 overflow-x-auto px-1 pb-1">
          {slots.map((slot) => {
            const slug = rosterToSlug.get(d.slotToRoster[slot]) ?? null;
            return (
              <li key={slot} className="flex shrink-0 items-center gap-1.5 text-sm">
                <span className="tabular shrink-0 text-[11px] text-chalk-600">{slot}</span>
                {slug ? (
                  <Link
                    href={`/owners/${slug}/`}
                    className="whitespace-nowrap transition-colors hover:text-accent"
                    data-owner={slug}
                  >
                    {ownerNames[slug] ?? slug}
                  </Link>
                ) : (
                  <span className="text-chalk-600">—</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
