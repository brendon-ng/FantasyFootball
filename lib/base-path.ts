/**
 * The subpath this site is served from — `/DenOpsFF` in production, `""` in dev.
 * Set by `next.config.ts` and inlined at build time.
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Prefixes a root-relative URL with the deployment's base path.
 *
 * `next/link` and `next/font` handle the prefix themselves. Everything else that
 * takes a root-relative URL needs this, most notably `next/image` `src`, `fetch()`
 * calls for files in `public/`, and plain `<a href>`/`<img src>`:
 *
 * ```tsx
 * <Image src={withBasePath("/logo.svg")} alt="" width={100} height={20} />
 * const res = await fetch(withBasePath("/data/rosters.json"));
 * ```
 *
 * Absolute URLs (`https://…`, `//…`) and fragments/queries are returned unchanged.
 */
export function withBasePath(path: string): string {
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path) || /^[#?]/.test(path)) {
    return path;
  }
  return `${basePath}${path.startsWith("/") ? "" : "/"}${path}`;
}
