"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TouchEvent } from "react";

import { useIdentity } from "@/components/identity";
import { TeamNames } from "@/components/punishment-ledger";
import { Sheet } from "@/components/sheet";
import { EmptyState, Panel, PanelHeader, Skeleton } from "@/components/ui";
import { shrinkImage } from "@/lib/image-shrink";
import {
  downloadUrl,
  listMedia,
  mediaUrl,
  IMAGE_LIMIT,
  VIDEO_LIMIT,
  posterUrl,
  seasonTag,
  THUMB,
  uploadMedia,
  type MediaItem,
} from "@/lib/cloudinary";
import type { LedgerRow, TeamMap } from "@/lib/punishments";
import type { SeasonPunishment } from "@/lib/season-punishment";

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`;

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
  /** Just the season punishment's, for the panel that renders it. */
  seasonItems: MediaItem[];
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
      // SCOPE FIRST, then week. Without it a season punishment's photos would
      // count towards whatever week their null matched.
      const mine = (items ?? []).filter(
        (m) => m.scope === "week" && m.week === week,
      );
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

  const seasonItems = (items ?? []).filter((m) => m.scope === "season");

  return { items, seasonItems, previewFor, add };
}

/**
 * The upload half, shared by the week dialog and the season panel.
 *
 * A HOOK RATHER THAN A COMPONENT, because the two surfaces put the button in
 * very different places — full width at the foot of a sheet, inline beside a
 * grid — and only the wiring is common. What is common is worth sharing: the
 * sequencing, the partial-failure rule and the hidden input are each easy to
 * get subtly wrong twice.
 */
export function useUploader({
  cloud,
  preset,
  league,
  season,
  week,
  onAdded,
}: {
  cloud: string;
  preset: string;
  league: string;
  season: number;
  /** A week number, or null for the season's own punishment. */
  week: number | null;
  onAdded: (created: MediaItem[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const { identity, ready } = useIdentity();
  const me = ready && identity.kind === "owner" ? identity.slug : null;

  /**
   * ONE FILE AT A TIME, not all at once. A phone on a bad connection sending
   * four videos in parallel finishes them all slowly and shows nothing in the
   * meantime; sequentially it can report progress, and whatever already
   * succeeded survives a later failure.
   *
   * AN OVERSIZED PHOTO IS SHRUNK, AN OVERSIZED VIDEO IS REFUSED. That asymmetry
   * is not a shortcut: a browser can re-encode a still on a canvas in a moment,
   * and has no honest way to re-encode video — the options are a real-time
   * `MediaRecorder` pass that takes as long as the clip and loses the audio, or
   * ffmpeg.wasm, which is a 25MB download that falls over on a phone.
   *
   * A REFUSAL DOES NOT ABANDON THE BATCH. One clip being too long should not
   * cost somebody the three photos they picked alongside it, so the file is
   * skipped and named at the end.
   */
  const send = async (files: FileList) => {
    setError(null);
    const done: MediaItem[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      const step = `${i + 1} of ${files.length}`;

      if (file.type.startsWith("video/")) {
        if (file.size > VIDEO_LIMIT) {
          skipped.push(`${file.name} (${mb(file.size)})`);
          continue;
        }
      } else if (file.size > IMAGE_LIMIT) {
        // Said out loud: on a phone this is a couple of seconds of nothing, and
        // silence there reads as the button having failed.
        setBusy(`Resizing ${step}…`);
        try {
          file = await shrinkImage(file);
        } catch {
          // Undecodable, or no canvas. Send the original and let Cloudinary
          // have the last word rather than refusing on its behalf.
        }
      }

      setBusy(`Uploading ${step}…`);
      try {
        done.push(
          await uploadMedia({
            cloud,
            preset,
            file,
            league,
            season,
            week,
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
    if (skipped.length) {
      setError(
        `Too big to upload — video is capped at ${mb(VIDEO_LIMIT)}: ${skipped.join(", ")}. Trim it, or export at a lower quality.`,
      );
    }
  };

  const input = (
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
  );

  return {
    busy,
    error,
    me,
    input,
    open: () => picker.current?.click(),
  };
}

/** One square thumbnail. Shared, so a grid tile and a row tile cannot drift. */
function MediaTile({
  cloud,
  item,
  onOpen,
  className = "",
}: {
  cloud: string;
  item: MediaItem;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative block aspect-square overflow-hidden rounded-md border border-ink-600 ${className}`}
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
  );
}

/**
 * A SINGLE ROW, with the remainder behind a `+N`.
 *
 * A season's photos under one heading ran down the page and buried everything
 * below it — and a panel summarising a week should be the height of a summary.
 * So a fixed number of tiles sit on one line and the rest are one tap away.
 *
 * FIXED-SIZE TILES AND A FIXED COUNT, deliberately, rather than a responsive
 * column count. The `+N` has to state a real number, and a count that changed with
 * the breakpoint could only be computed by measuring — which means a resize
 * observer, a hydration mismatch, and a number that flickers on rotate. Five
 * cells fit a 360px phone with room to spare, and a desktop simply has empty space
 * to the right, which reads as deliberate.
 */
export function MediaRow({
  cloud,
  items,
  onOpen,
  onMore,
}: {
  cloud: string;
  items: MediaItem[];
  onOpen: (index: number) => void;
  onMore: () => void;
}) {
  const CELLS = 5;
  const overflowing = items.length > CELLS;
  // One cell is spent on the chip, so an overflowing row shows one fewer.
  const shown = overflowing ? items.slice(0, CELLS - 1) : items;
  const more = items.length - shown.length;

  return (
    <div className="flex gap-1.5">
      {shown.map((item, i) => (
        <MediaTile
          key={item.publicId}
          cloud={cloud}
          item={item}
          onOpen={() => onOpen(i)}
          className="h-14 w-14 shrink-0 sm:h-16 sm:w-16"
        />
      ))}
      {more > 0 ? (
        <button
          type="button"
          onClick={onMore}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-ink-600 bg-ink-850 text-sm font-semibold text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent sm:h-16 sm:w-16"
        >
          +{more}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Everything in one group, when the row could not hold it.
 *
 * A PLAIN SCROLLING GRID, with no upload control and no per-item chrome: this
 * exists only because a `+N` was tapped, so the one thing it owes the reader is
 * all of them at once. Opening one from here still pages through the WHOLE
 * group, not just the overflow — the row and this sheet are two views of one
 * set, and the viewer should not be able to tell which was clicked.
 */
export function AllMediaSheet({
  cloud,
  title,
  items,
  onOpen,
  onClose,
}: {
  cloud: string;
  title: string;
  items: MediaItem[];
  onOpen: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      label={title}
      onClose={onClose}
      panelClassName="flex max-h-[85dvh] w-full max-w-[40rem] flex-col overflow-hidden rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-600 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{title}</div>
              <div className="text-[11px] text-chalk-600">
                {items.length} photos and videos
              </div>
            </div>
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close"
              className="shrink-0 rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
            <MediaGrid cloud={cloud} items={items} onOpen={onOpen} />
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Square thumbnails, so the grid stays a grid whatever shape the photos are. */
export function MediaGrid({
  cloud,
  items,
  onOpen,
}: {
  cloud: string;
  items: MediaItem[];
  /**
   * BY INDEX, NOT BY ITEM, because opening one is opening a POSITION IN THIS
   * GRID — the viewer pages through the group you clicked in, and an item alone
   * does not say which group that was.
   */
  onOpen: (index: number) => void;
}) {
  return (
    // MORE COLUMNS, NOT BIGGER SQUARES, as the card widens. A grid of five
    // across a desktop panel makes each thumbnail far larger than a thumbnail
    // needs to be, and a season's worth then runs down the page — the full-size
    // view is one click away and is what a big image is for.
    <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
      {items.map((item, i) => (
        <li key={item.publicId}>
          <MediaTile
            cloud={cloud}
            item={item}
            onOpen={() => onOpen(i)}
            className="w-full"
          />
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
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const { busy, error, me, input, open } = useUploader({
    cloud,
    preset,
    league,
    season,
    week: row.week,
    onAdded,
  });

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
              <MediaGrid
                cloud={cloud}
                items={items}
                onOpen={(index) => setViewing({ items, index })}
              />
            ) : (
              <p className="py-6 text-center text-sm text-chalk-600">
                Nothing posted for this week yet.
              </p>
            )}

            {input}

            {error ? (
              <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={open}
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
              viewing={viewing}
              onIndex={(index) => setViewing((v) => v && { ...v, index })}
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
 * THE LAST-PLACE PUNISHMENT IS ONE OF THE GROUPS, not a week. Its photos carry
 * no week number — that is what `kind=season` means — so grouping purely by
 * week dropped them into the week-0 "Unfiled" bucket, which is reserved for an
 * asset whose context went missing. It leads the list, being the year's
 * punishment rather than one week of it, and "Unfiled" goes back to meaning
 * something genuinely broken.
 *
 * Every group is built the same way and rendered by one loop — a label, who
 * owed it, what they owed, and the grid — so the season group cannot drift away
 * from the weekly ones.
 *
 * VIEW ONLY — uploading happens from a ledger row, or from the last-place panel,
 * where in both cases the week is not a question anyone has to answer.
 */
export function PunishmentMedia({
  cloud,
  items,
  season,
  rows,
  seasonPunishment,
  teams,
  names,
}: {
  cloud: string;
  items: MediaItem[] | null;
  season: number;
  rows: LedgerRow[];
  /** The year's last-place punishment, for labelling its own group. */
  seasonPunishment?: SeasonPunishment | null;
  teams: TeamMap;
  names: Record<string, string>;
}) {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [overflow, setOverflow] = useState<{
    title: string;
    items: MediaItem[];
  } | null>(null);

  const byWeek = new Map<number, MediaItem[]>();
  for (const item of items ?? []) {
    if (item.scope === "season") continue;
    const week = item.week ?? 0;
    byWeek.set(week, [...(byWeek.get(week) ?? []), item]);
  }
  const seasonMedia = (items ?? []).filter((m) => m.scope === "season");

  /**
   * ONE SHAPE FOR EVERY GROUP, the season punishment included. It leads,
   * because it is the year's punishment rather than one week of it; the weeks
   * then run newest first, matching the order the ledger reads in.
   */
  const groups: Array<{
    key: string;
    label: string;
    slugs: string[];
    text: string | undefined;
    items: MediaItem[];
  }> = [];

  if (seasonMedia.length) {
    groups.push({
      key: "season",
      label: "Last place",
      slugs: seasonPunishment?.loser ? [seasonPunishment.loser] : [],
      text: seasonPunishment?.punishment,
      items: seasonMedia,
    });
  }
  for (const week of [...byWeek.keys()].sort((a, b) => b - a)) {
    const row = rows.find((r) => r.week === week);
    groups.push({
      key: `week-${week}`,
      label: week ? `Week ${week}` : "Unfiled",
      slugs: row?.losers ?? [],
      text: row?.punishment?.text,
      items: byWeek.get(week)!,
    });
  }

  return (
    <>
      <Panel>
        <PanelHeader
          title="Media"
          meta={items ? `${items.length} uploaded` : undefined}
          legend="Add photos from a week's row above."
        />

        {items == null ? (
          <div className="grid grid-cols-3 gap-1.5 px-4 py-3 sm:grid-cols-6 sm:px-5 lg:grid-cols-8">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : !groups.length ? (
          <EmptyState>Nobody has posted anything yet.</EmptyState>
        ) : (
          <div className="divide-y divide-ink-700">
            {groups.map((g) => (
              <div key={g.key} className="px-4 py-3 sm:px-5">
                {/* WHEN, WHO, AND WHAT — the punishment belongs here as much
                    as the name does: a grid of photos of somebody in a wig
                    means nothing without the line that says it was a wig. The
                    punishment truncates first, being the only part that can run
                    to a sentence. */}
                <div className="mb-2 flex min-w-0 items-baseline gap-2">
                  <span className="eyebrow shrink-0 text-[10px]">{g.label}</span>
                  <span className="shrink-0 text-xs font-medium text-chalk-400">
                    <TeamNames
                      season={season}
                      slugs={g.slugs}
                      teams={teams}
                      names={names}
                    />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-chalk-600"
                    title={g.text}
                  >
                    {g.text}
                  </span>
                </div>
                {/* THE GROUP IS THE SET. Opening a photo under "Week 3" pages
                    through week 3, not through the season — the row you
                    clicked in is what says which set you are looking at, and
                    that stays true whether it was opened from the row or from
                    the overflow sheet. */}
                <MediaRow
                  cloud={cloud}
                  items={g.items}
                  onOpen={(index) => setViewing({ items: g.items, index })}
                  onMore={() =>
                    setOverflow({
                      title: [g.label, g.text].filter(Boolean).join(" · "),
                      items: g.items,
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {overflow ? (
        <AllMediaSheet
          cloud={cloud}
          title={overflow.title}
          items={overflow.items}
          onOpen={(index) => setViewing({ items: overflow.items, index })}
          onClose={() => setOverflow(null)}
        />
      ) : null}

      {viewing ? (
        <Lightbox
          cloud={cloud}
          viewing={viewing}
          onIndex={(index) => setViewing((v) => v && { ...v, index })}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Saves one item to the device.
 *
 * TWO ROUTES, AND THE SHARE SHEET IS THE POINT. A plain download on iOS lands in
 * Files, not Photos, which is not what anyone means by saving a picture — the
 * native share sheet has "Save Image", and that is what puts it in the camera
 * roll. So the file is fetched (Cloudinary sends `access-control-allow-origin:
 * *` on delivery, checked) and handed to `navigator.share`, falling back to a
 * download only where sharing files is not supported.
 *
 * A CANCELLED SHARE IS NOT A FALLBACK. `navigator.share` rejects with AbortError
 * when the sheet is dismissed, and starting a download at that point would hand
 * someone the file they just declined. The fallback is chosen BEFORE the share
 * is attempted, never after it fails.
 */
async function saveMedia(cloud: string, item: MediaItem) {
  const name = `${item.publicId}.${item.format}`;

  let file: File | null = null;
  try {
    const res = await fetch(mediaUrl(cloud, item));
    if (res.ok) {
      const blob = await res.blob();
      file = new File([blob], name, { type: blob.type });
    }
  } catch {
    // Offline, or CORS withdrawn. The download link below needs neither.
  }

  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch {
      // Dismissed. Deliberately nothing: see above.
    }
    return;
  }

  const a = document.createElement("a");
  a.href = downloadUrl(cloud, item, name);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** What the viewer is paging through, and where in it. */
export interface Viewing {
  items: MediaItem[];
  index: number;
}

/**
 * One item at a time, as big as the screen allows, with the rest a swipe away.
 *
 * IT PAGES THROUGH THE GROUP YOU OPENED, not the whole season. Clicking a photo
 * under "Week 3" and then swiping into last place's would be a non-sequitur —
 * the surrounding grid is what says which set you are in, so that is the set.
 *
 * THREE WAYS THROUGH, because the same dialog is used on a phone and a desktop:
 * a horizontal swipe, the arrow keys, and a pair of buttons. The buttons are
 * always rendered rather than shown on hover — hover does not exist on the
 * device where this is most used, and a control that appears only on desktop is
 * a control most people never find.
 *
 * A SWIPE THAT STARTS ON A VIDEO IS LEFT ALONE. `<video controls>` puts a
 * scrubber under the finger, and stealing that gesture would make a video
 * impossible to seek. The photo case is unaffected, and a video can still be
 * paged with the buttons or the keys.
 *
 * CLAMPED, NOT WRAPPED. Running off the end back to the start hides how long
 * the set is; here the counter and a disabled button both say so.
 *
 * CENTRED AT EVERY WIDTH, phone included. A photo is not a form: it wants the
 * middle of a dimmed screen, not to rise from the bottom edge the way the
 * dialogs here normally do.
 */
export function Lightbox({
  cloud,
  viewing,
  onIndex,
  onClose,
}: {
  cloud: string;
  viewing: Viewing;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { items, index } = viewing;
  const item = items[index];
  const count = items.length;

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < count) onIndex(next);
    },
    [index, count, onIndex],
  );

  // The arrow keys. Escape is the Sheet's own, so it is deliberately not here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("video")) return;
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    // MOSTLY HORIZONTAL, AND FAR ENOUGH. Without the second test a vertical
    // scroll that drifts sideways pages the gallery; without the first, a tap
    // with a shaky finger does.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(t.clientY - start.y))
      return;
    go(dx < 0 ? 1 : -1);
  };

  if (!item) return null;

  const media =
    item.type === "video" ? (
      <video
        // KEYED BY ASSET so paging swaps the source cleanly. Without it React
        // reuses the element and the previous video keeps playing under the
        // next one's poster.
        key={item.publicId}
        src={mediaUrl(cloud, item)}
        poster={posterUrl(cloud, item, "w_1000,c_limit")}
        controls
        playsInline
        className="max-h-full max-w-full rounded-lg bg-black"
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mediaUrl(cloud, item, "w_1600,c_limit,f_auto,q_auto")}
        alt=""
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    );

  return (
    <Sheet
      label="Punishment media"
      onClose={onClose}
      align="center"
      zClassName="z-[60]"
      backdropClassName="p-3 sm:p-6"
      // NO BACKGROUND AND NO BORDER: the panel is a layout column, not a
      // surface. The only thing that should look like a thing here is the
      // media, which is why the chrome sits above and below it on the dimmed
      // backdrop rather than on top of the photo.
      // A DEFINITE HEIGHT, NOT A MAXIMUM. `max-height` does not give the panel
      // a definite height, so the media's own `max-h-full` resolved against
      // nothing and a tall video grew the column past the screen — taking the
      // close, save and pager rows off the top and bottom with it, which is
      // exactly the report. A fixed height makes `flex-1 min-h-0` bound the
      // media and pins the controls where they can always be reached.
      panelClassName="flex h-[92dvh] w-full max-w-[52rem] flex-col"
    >
      {({ close }) => (
        <div
          className="flex min-h-0 flex-1 flex-col"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <button
              type="button"
              onClick={() => void saveMedia(cloud, item)}
              className="rounded-full bg-ink-800/80 px-3 py-1.5 text-xs font-semibold text-chalk-300 transition-colors hover:bg-ink-700 hover:text-chalk-100"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800/80 text-lg leading-none text-chalk-300 transition-colors hover:bg-ink-700 hover:text-chalk-100"
            >
              <span aria-hidden>×</span>
            </button>
          </div>

          {/* CLICKING THE GAP STILL DISMISSES. The column is wider than a
              portrait photo, so without this the dead space either side of one
              would swallow the click that everywhere else on the site closes a
              dialog. Only a hit on the wrapper ITSELF counts — a click that
              lands on the photo is not a click outside it. */}
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            className="flex min-h-0 flex-1 items-center justify-center"
          >
            {media}
          </div>

          {count > 1 ? (
            <div className="mt-2 flex shrink-0 items-center justify-center gap-5">
              <PageButton
                side="left"
                disabled={index === 0}
                onClick={() => go(-1)}
              />
              <span className="tabular text-xs font-semibold text-chalk-400">
                {index + 1} / {count}
              </span>
              <PageButton
                side="right"
                disabled={index === count - 1}
                onClick={() => go(1)}
              />
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/**
 * A pager control, in the bar under the media rather than over it.
 *
 * DIMMED WHEN IT CANNOT GO, NOT HIDDEN. Removing it at the ends would shuffle
 * the counter sideways on the first and last item, which reads as the bar
 * twitching every time you reach an edge.
 */
function PageButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous" : "Next"}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800/80 text-lg leading-none text-chalk-300 transition-colors hover:bg-ink-700 hover:text-chalk-100 disabled:pointer-events-none disabled:opacity-30"
    >
      <span aria-hidden>{side === "left" ? "‹" : "›"}</span>
    </button>
  );
}
