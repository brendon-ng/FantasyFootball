"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useIdentity } from "@/components/identity";
import { TeamNames } from "@/components/punishment-ledger";
import { Sheet } from "@/components/sheet";
import { EmptyState, Panel, PanelHeader, Skeleton } from "@/components/ui";
import {
  listMedia,
  mediaUrl,
  posterUrl,
  seasonTag,
  THUMB,
  uploadMedia,
  type MediaItem,
} from "@/lib/cloudinary";
import type { LedgerRow, TeamMap } from "@/lib/punishments";

/**
 * Photos and videos of punishments actually being carried out.
 *
 * EVERYTHING HERE TALKS TO CLOUDINARY DIRECTLY — see lib/cloudinary. The sheet
 * does not know these files exist, and neither does Apps Script: the week and
 * the uploader ride on the asset itself, so there is no index to keep in step.
 *
 * ONE FETCH FOR THE WHOLE SEASON, held by the tracker and shared. The ledger
 * needs a count per row and the panel needs everything grouped, and both from
 * the same list — fetching twice would double the requests to say one thing.
 */
export function useSeasonMedia(
  cloud: string | null,
  league: string,
  season: number | null,
): {
  items: MediaItem[] | null;
  /** A count and a thumbnail for one week, for the ledger's row control. */
  previewFor: (week: number) => { count: number; thumb: string | null };
  add: (created: MediaItem[]) => void;
} {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const key = cloud && season != null ? `${cloud}:${league}:${season}` : null;

  useEffect(() => {
    if (!key || !cloud || season == null) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await listMedia(cloud, seasonTag(league, season));
        if (!cancelled) setItems(found);
      } catch {
        // Fails soft: nothing else on the page depends on this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, cloud, league, season]);

  /**
   * MERGED LOCALLY, NOT REFETCHED. The list endpoint is CDN-cached for a
   * minute, so a file uploaded seconds ago is genuinely not there yet — a
   * refetch would show the uploader their own photo vanishing.
   */
  const add = useCallback((created: MediaItem[]) => {
    setItems((prev) => [...(prev ?? []), ...created]);
  }, []);

  /**
   * A tiny transform, because this is a 20px square in a table row. Asking for
   * the full asset there would download several megabytes to draw a thumbnail.
   */
  const previewFor = useCallback(
    (week: number) => {
      const mine = (items ?? []).filter((m) => m.week === week);
      const first = mine[0];
      return {
        count: mine.length,
        thumb: !first
          ? null
          : first.type === "video"
            ? posterUrl(cloud ?? "", first, "w_80,h_80,c_fill")
            : mediaUrl(cloud ?? "", first, "w_80,h_80,c_fill,f_auto,q_auto"),
      };
    },
    [items, cloud],
  );

  return { items, previewFor, add };
}

/** Square thumbnails, so the grid stays a grid whatever shape the photos are. */
function MediaGrid({
  cloud,
  items,
  onOpen,
}: {
  cloud: string;
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {items.map((item) => (
        <li key={item.publicId}>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="group relative block aspect-square w-full overflow-hidden rounded-md border border-ink-600"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                item.type === "video"
                  ? posterUrl(cloud, item, THUMB)
                  : mediaUrl(cloud, item, THUMB)
              }
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            {item.type === "video" ? (
              <span
                aria-label="Video"
                className="absolute bottom-1 right-1 rounded bg-ink-900/80 px-1 text-[10px] text-chalk-100"
              >
                ▶
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One week's media, and the place to add more.
 *
 * OPENED FROM ITS OWN LEDGER ROW, which is why there is no week picker here:
 * the week is the row you came from, so an upload cannot be filed against the
 * wrong one.
 */
export function WeekMediaSheet({
  cloud,
  preset,
  league,
  season,
  row,
  items,
  teams,
  names,
  onAdded,
  onClose,
}: {
  cloud: string;
  preset: string;
  league: string;
  season: number;
  row: LedgerRow;
  items: MediaItem[];
  teams: TeamMap;
  names: Record<string, string>;
  onAdded: (created: MediaItem[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const { identity, ready } = useIdentity();
  const me = ready && identity.kind === "owner" ? identity.slug : null;

  /**
   * ONE FILE AT A TIME, not all at once. A phone on a bad connection sending
   * four videos in parallel finishes them all slowly and shows nothing in the
   * meantime; sequentially it can report progress, and whatever already
   * succeeded survives a later failure.
   */
  const send = async (files: FileList) => {
    setError(null);
    const done: MediaItem[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      try {
        done.push(
          await uploadMedia({
            cloud,
            preset,
            file: files[i],
            league,
            season,
            week: row.week,
            by: me,
          }),
        );
      } catch (e) {
        setBusy(null);
        if (done.length) onAdded(done);
        setError(e instanceof Error ? e.message : "Upload failed.");
        return;
      }
    }
    setBusy(null);
    onAdded(done);
  };

  return (
    <Sheet
      label={`Week ${row.week} media`}
      onClose={busy ? null : onClose}
      panelClassName="max-h-[88dvh] max-w-[40rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          {/* THE WHOLE ROW, RESTATED. This dialog is opened from one line of a
              fourteen-row table and then covers it, so everything that line
              said has to be here — which week, who lost it, what they owe and
              what they scored. Without it the grid of photos is unlabelled the
              moment the table behind it is out of sight.

              The punishment moved up here from the body for the same reason:
              it is context for the media, not a paragraph the media follows. */}
          <div className="flex items-start justify-between gap-3 border-b border-ink-600 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="eyebrow text-[10px]">
                {season} · Week {row.week}
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                <TeamNames
                  season={season}
                  slugs={row.losers}
                  teams={teams}
                  names={names}
                />
                {row.points == null ? null : row.matchupId ? (
                  // Straight to the game it happened in, the same trip the
                  // ledger's score column offers. A number with no way through
                  // to the scoreboard is trivia.
                  <Link
                    href={`/matchups/${row.matchupId}/`}
                    title="The game they lost it in"
                    className="tabular text-xs font-medium text-chalk-500 transition-colors hover:text-accent"
                  >
                    {row.points.toFixed(2)}
                  </Link>
                ) : (
                  <span className="tabular text-xs font-medium text-chalk-500">
                    {row.points.toFixed(2)}
                  </span>
                )}
              </div>
              {row.punishment ? (
                <p className="mt-1 text-sm leading-relaxed text-chalk-300">
                  {row.punishment.text}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => close()}
              disabled={Boolean(busy)}
              aria-label="Close"
              className="shrink-0 rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent disabled:opacity-40"
            >
              Close
            </button>
          </div>

          <div className="space-y-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-5">
            {items.length ? (
              <MediaGrid cloud={cloud} items={items} onOpen={setViewing} />
            ) : (
              <p className="py-6 text-center text-sm text-chalk-600">
                Nothing posted for this week yet.
              </p>
            )}

            <input
              ref={picker}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void send(e.target.files);
              }}
            />

            {error ? (
              <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={Boolean(busy)}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ?? "Add photos or video"}
            </button>

            <p className="text-center text-[11px] text-chalk-600">
              {me ? `Posted as ${names[me] ?? me}` : "Posted anonymously"}
            </p>
          </div>

          {viewing ? (
            <Lightbox
              cloud={cloud}
              item={viewing}
              onClose={() => setViewing(null)}
            />
          ) : null}
        </>
      )}
    </Sheet>
  );
}

/**
 * Everything from the season, in one place.
 *
 * VIEW ONLY — uploading happens from a ledger row, where the week is not a
 * question anyone has to answer. Grouped newest week first, matching the order
 * the ledger reads in.
 */
export function PunishmentMedia({
  cloud,
  items,
  season,
  rows,
  teams,
  names,
}: {
  cloud: string;
  items: MediaItem[] | null;
  season: number;
  rows: LedgerRow[];
  teams: TeamMap;
  names: Record<string, string>;
}) {
  const [viewing, setViewing] = useState<MediaItem | null>(null);

  const byWeek = new Map<number, MediaItem[]>();
  for (const item of items ?? []) {
    const week = item.week ?? 0;
    byWeek.set(week, [...(byWeek.get(week) ?? []), item]);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => b - a);

  return (
    <>
      <Panel>
        <PanelHeader
          title="Media"
          meta={items ? `${items.length} uploaded` : undefined}
          legend="Add photos from a week's row above."
        />

        {items == null ? (
          <div className="grid grid-cols-3 gap-1.5 px-4 py-3 sm:grid-cols-5 sm:px-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : !items.length ? (
          <EmptyState>Nobody has posted anything yet.</EmptyState>
        ) : (
          <div className="divide-y divide-ink-700">
            {weeks.map((week) => (
              <div key={week} className="px-4 py-3 sm:px-5">
                {/* WEEK, WHO, AND WHAT — the punishment belongs here as much
                    as the name does: a grid of photos of somebody in a wig
                    means nothing without the line that says it was a wig. The
                    punishment truncates first, being the only part that can run
                    to a sentence. */}
                <div className="mb-2 flex min-w-0 items-baseline gap-2">
                  <span className="eyebrow shrink-0 text-[10px]">
                    {week ? `Week ${week}` : "Unfiled"}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-chalk-400">
                    <TeamNames
                      season={season}
                      slugs={rows.find((r) => r.week === week)?.losers ?? []}
                      teams={teams}
                      names={names}
                    />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-chalk-600"
                    title={rows.find((r) => r.week === week)?.punishment?.text}
                  >
                    {rows.find((r) => r.week === week)?.punishment?.text}
                  </span>
                </div>
                <MediaGrid
                  cloud={cloud}
                  items={byWeek.get(week)!}
                  onOpen={setViewing}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {viewing ? (
        <Lightbox
          cloud={cloud}
          item={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

/**
 * One item, as big as the screen allows.
 *
 * CENTRED AT EVERY WIDTH, phone included. A photo is not a form: it wants the
 * middle of a dimmed screen, not to rise from the bottom edge the way the
 * dialogs here normally do.
 *
 * The close control is a bare glyph over the corner of the media rather than a
 * bordered button in a header strip. There is no header — the image IS the
 * dialog — and a boxed control floating on a photo reads as part of the photo.
 */
function Lightbox({
  cloud,
  item,
  onClose,
}: {
  cloud: string;
  item: MediaItem;
  onClose: () => void;
}) {
  return (
    <Sheet
      label="Punishment media"
      onClose={onClose}
      align="center"
      zClassName="z-[60]"
      backdropClassName="p-3 sm:p-6"
      panelClassName="relative max-w-[52rem] overflow-hidden rounded-xl bg-ink-900 shadow-2xl"
    >
      {({ close }) => (
        <>
          <button
            type="button"
            onClick={() => close()}
            aria-label="Close"
            // Its own scrim, because a glyph alone disappears against a bright
            // photo and a dark one alike.
            className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink-900/50 text-lg leading-none text-chalk-300 backdrop-blur-sm transition-colors hover:bg-ink-900/80 hover:text-chalk-100"
          >
            <span aria-hidden>×</span>
          </button>

          {item.type === "video" ? (
            <video
              src={mediaUrl(cloud, item)}
              poster={posterUrl(cloud, item, "w_1000,c_limit")}
              controls
              playsInline
              className="max-h-[85dvh] w-full bg-black"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(cloud, item, "w_1600,c_limit,f_auto,q_auto")}
              alt=""
              className="max-h-[85dvh] w-full bg-black object-contain"
            />
          )}
        </>
      )}
    </Sheet>
  );
}
