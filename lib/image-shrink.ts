/**
 * Making an oversized photo fit, in the browser, before it is uploaded.
 *
 * ONLY WHEN IT HAS TO. A file under the limit is returned untouched — this is a
 * rescue for the 48-megapixel case, not a policy of re-encoding everything. Most
 * phone photos are a few megabytes and never come near this.
 *
 * WHY IT IS WORTH DOING AT ALL: without it an oversized file is uploaded in
 * full, over a phone connection, and only then rejected. The person waits
 * several minutes to be told no.
 *
 * IMAGES ONLY. There is no honest browser-side answer for video — see
 * `VIDEO_LIMIT` in lib/cloudinary and the note in AGENTS.md.
 *
 * BROWSER-ONLY: canvas and `createImageBitmap`. Never import this from build-time
 * code.
 */

import { IMAGE_LIMIT } from "./cloudinary";

/**
 * THE TARGET IS THE LIMIT, near enough.
 *
 * There is no guesswork to leave room for: `blob.size` is the exact number of
 * bytes that will be sent, and Cloudinary measures the same thing — its
 * rejection quoted the file size to the byte. The 1% is for nothing more than
 * arithmetic nerves.
 */
const target = (limit: number) => Math.floor(limit * 0.99);

/** Decodes to a bitmap, honouring EXIF rotation so a portrait photo stays upright. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari has been late to `imageOrientation`, and some formats decode only
    // through the element path. An <img> applies EXIF orientation itself.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const draw = (
  src: ImageBitmap | HTMLImageElement,
  w: number,
  h: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context.");
  // WHITE FIRST. The output is JPEG, which has no alpha, and an un-filled
  // canvas composites transparency to BLACK — a screenshot with a transparent
  // margin would come out framed in black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const toBlob = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Could not encode the image.")),
      "image/jpeg",
      quality,
    ),
  );

/**
 * Returns the file unchanged if it already fits, or a JPEG that does.
 *
 * AS LITTLE AS WILL DO, in that order: re-encode at FULL resolution first, then
 * step quality, and only then scale — and stop the moment it fits. A photo that
 * fits at full size and q=0.92 is never touched further, which is the common
 * case for a large HEIC or PNG.
 *
 * IT GIVES UP RATHER THAN LOOPING. If nothing fits, the ORIGINAL is returned so
 * the upload proceeds and Cloudinary's own message is what the person sees. A
 * silent, indefinite grind is worse than an honest rejection.
 */
export async function shrinkImage(file: File, limit = IMAGE_LIMIT) {
  if (file.size <= limit) return file;

  const src = await decode(file);
  const w0 = "width" in src ? src.width : 0;
  const h0 = "height" in src ? src.height : 0;
  if (!w0 || !h0) return file;

  const TARGET = target(limit);
  const wrap = (blob: Blob) =>
    new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });

  let scale = 1;
  let quality = 0.92;
  let blob = await toBlob(draw(src, w0, h0), quality);
  if (blob.size <= TARGET) return wrap(blob);

  // QUALITY BEFORE PIXELS, and both only as far as needed. Re-encoding at full
  // resolution is usually enough on its own — a 12MB HEIC or PNG becomes a
  // fraction of that as JPEG with no visible loss — so every pixel is kept
  // until quality alone has been given a fair try.
  for (const q of [0.85, 0.75]) {
    quality = q;
    blob = await toBlob(draw(src, w0, h0), quality);
    if (blob.size <= TARGET) return wrap(blob);
  }

  /*
   * ONLY NOW SCALE, AND ONLY AS FAR AS THE MEASUREMENT SAYS. Bytes track pixel
   * COUNT at a fixed quality, so the linear scale needed is the square root of
   * the ratio — which lands in one step rather than groping downwards in fixed
   * increments and overshooting. The 0.97 covers the estimate being slightly
   * optimistic; the loop covers it being badly wrong.
   */
  for (let pass = 0; pass < 3 && blob.size > TARGET; pass++) {
    scale *= Math.sqrt(TARGET / blob.size) * 0.97;
    blob = await toBlob(draw(src, w0 * scale, h0 * scale), quality);
  }

  // Still over after all that: send the ORIGINAL and let Cloudinary have the
  // last word, rather than uploading something degraded that also fails.
  return blob.size <= TARGET ? wrap(blob) : file;
}
