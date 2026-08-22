/**
 * Punishment photos and videos.
 *
 * THE MEDIA DOES NOT TOUCH THE SHEET, AND DOES NOT TOUCH APPS SCRIPT. The
 * browser uploads straight to Cloudinary with an UNSIGNED preset, and reads
 * back through Cloudinary's public list endpoint. There is no server in the
 * path either way, which is the only reason a static site can host this at all.
 *
 * WHICH WEEK A FILE BELONGS TO RIDES ON THE ASSET, in Cloudinary's `context`,
 * rather than in an index somewhere else. That was the thing worth checking
 * before designing around it: an unsigned upload accepts both `tags` and
 * `context`, and the list endpoint gives `context` back — verified against the
 * real cloud, not assumed. So one request per season returns every asset
 * already carrying its own week and uploader, and nothing has to be kept in
 * step with anything.
 *
 * The tag is the season and the context is everything else:
 *
 *     tags     masterbatters-2025
 *     context  week=3|by=ross-bechtel
 *
 * DEPENDENCY-FREE AND CLIENT-SAFE: this ships to the browser.
 */

export interface MediaItem {
  publicId: string;
  /** "image" or "video" — decides which delivery path and which list it came from. */
  type: MediaType;
  version: number;
  format: string;
  week: number | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

export type MediaType = "image" | "video";

/** One tag per league-season. The only thing the gallery has to know to ask. */
export const seasonTag = (league: string, season: number) =>
  `${league}-${season}`;

const BASE = "https://res.cloudinary.com";

/**
 * A delivery URL, with an optional transformation.
 *
 * Transformations are why a gallery is cheap: `w_400,c_fill,f_auto,q_auto`
 * turned a 120KB source into 4.8KB on the real cloud, and `f_auto` serves AVIF
 * or WebP to whatever asked. The full-size view uses no transform at all.
 */
export function mediaUrl(
  cloud: string,
  item: Pick<MediaItem, "publicId" | "type" | "version" | "format">,
  transform?: string,
): string {
  const parts = [BASE, cloud, item.type, "upload"];
  if (transform) parts.push(transform);
  parts.push(`v${item.version}`, `${item.publicId}.${item.format}`);
  return parts.join("/");
}

/**
 * A still to show before a video plays.
 *
 * Cloudinary renders a frame from a video by asking for it as an image
 * extension — `so_0` is the first second. A video with no poster is a black
 * rectangle in a grid of photos.
 */
export const posterUrl = (cloud: string, item: MediaItem, transform: string) =>
  [
    BASE,
    cloud,
    "video",
    "upload",
    `${transform},so_0`,
    `v${item.version}`,
    `${item.publicId}.jpg`,
  ].join("/");

/** Thumbnails are square so the grid stays a grid whatever shape the photos are. */
export const THUMB = "w_400,h_400,c_fill,f_auto,q_auto";

const toItem = (raw: unknown, type: MediaType): MediaItem | null => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const publicId = typeof r.public_id === "string" ? r.public_id : null;
  const version = Number(r.version);
  if (!publicId || !Number.isFinite(version)) return null;

  const ctx =
    (r.context as { custom?: Record<string, string> } | undefined)?.custom ??
    {};
  const week = Number(ctx.week);
  return {
    publicId,
    type,
    version,
    format: typeof r.format === "string" ? r.format : "jpg",
    week: Number.isFinite(week) ? week : null,
    uploadedBy: ctx.by?.trim().toLowerCase() || null,
    uploadedAt: typeof r.created_at === "string" ? r.created_at : null,
  };
};

/**
 * Everything tagged for one season.
 *
 * TWO REQUESTS, because images and videos are separate delivery types and
 * therefore separate lists. A 404 from either is EMPTY, NOT AN ERROR: that is
 * what Cloudinary returns for a tag no asset of that type carries, which is the
 * normal state for video in a league that has only posted photos. Treating it
 * as a failure would blank a working gallery.
 *
 * CACHED FOR 60 SECONDS by the CDN, so a file uploaded a moment ago will not
 * appear here yet. The caller merges its own upload rather than refetching —
 * the same thing the suggestion and draw flows do for the same reason.
 */
export async function listMedia(
  cloud: string,
  tag: string,
): Promise<MediaItem[]> {
  const fetchList = async (type: MediaType): Promise<MediaItem[]> => {
    const res = await fetch(`${BASE}/${cloud}/${type}/list/${tag}.json`, {
      cache: "no-store",
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Cloudinary said ${res.status}`);
    const body = (await res.json()) as { resources?: unknown[] };
    return (body.resources ?? [])
      .map((r) => toItem(r, type))
      .filter((x): x is MediaItem => x != null);
  };

  const [images, videos] = await Promise.all([
    fetchList("image"),
    fetchList("video"),
  ]);
  return [...images, ...videos].sort((a, b) =>
    (a.uploadedAt ?? "").localeCompare(b.uploadedAt ?? ""),
  );
}

/**
 * Uploads one file and returns it in the same shape the list gives back.
 *
 * MULTIPART, NOT `text/plain`. Unlike every write to Apps Script, this one goes
 * to a service that answers CORS preflights properly — and `FormData` is a
 * simple content type anyway, so nothing is being worked around here.
 *
 * The response is normalised through the same `toItem` as the list, so a file
 * that has just been added and the same file on the next load are
 * indistinguishable.
 */
export async function uploadMedia({
  cloud,
  preset,
  file,
  league,
  season,
  week,
  by,
}: {
  cloud: string;
  preset: string;
  file: File;
  league: string;
  season: number;
  week: number;
  by: string | null;
}): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", preset);
  form.append("tags", seasonTag(league, season));
  // Pipe-delimited key=value is Cloudinary's own context format.
  form.append("context", `week=${week}${by ? `|by=${by}` : ""}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/auto/upload`,
    {
      method: "POST",
      body: form,
    },
  );
  const body = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string };
    resource_type?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `Upload failed (${res.status}).`);
  }

  const type: MediaType = body.resource_type === "video" ? "video" : "image";
  const item = toItem(body, type);
  if (!item)
    throw new Error("Cloudinary accepted the file but described it oddly.");
  return item;
}
