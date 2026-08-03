import type { NextConfig } from "next";

// GitHub Pages serves this repo from a subpath, https://<user>.github.io/FantasyFootball,
// so every route and asset URL needs the repo name in front of it.
//
// In Actions, GITHUB_REPOSITORY is "owner/repo", so renaming the repo updates the
// prefix automatically. The literal fallback keeps local production builds
// (`npm run preview`) identical to CI. Dev runs at the root, unprefixed.
//
// ONE BUILD PER LEAGUE. `LEAGUE` selects which league this build serves, and the
// basePath gains it as a second segment, so the assembled site looks like:
//
//   /<repo>/den-ops/...        one build
//   /<repo>/masterbatters/...  another
//   /<repo>/                   a picker page written by scripts/build-all.mjs
//
// Each build is therefore a single-league site and needs no league plumbing of
// its own — see scripts/build-all.mjs for the assembly.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "FantasyFootball";
const league = process.env.LEAGUE ?? "den-ops";
const basePath = process.env.NODE_ENV === "production" ? `/${repo}/${league}` : "";

const nextConfig: NextConfig = {
  // Pages serves static files only — there is no Next.js server.
  output: "export",
  basePath,
  // `next/image` optimization needs a server at runtime.
  images: { unoptimized: true },
  // Emit `about/index.html` rather than `about.html` so Pages resolves
  // extensionless URLs correctly.
  trailingSlash: true,
  // Surface the prefix to app code. `next/link` applies basePath on its own, but
  // raw URLs — `next/image` src, fetch(), <a href>, CSS url() — do not.
  // Use `withBasePath()` from `@/lib/base-path` for those.
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_LEAGUE: league },
  // Per league so builds cannot poison each other, and split by phase because
  // `next build` empties its distDir — sharing one with a running dev server
  // makes the build fail on the dev cache it is trying to delete.
  //
  // With `output: "export"` and a custom distDir, the exported site lands IN
  // distDir rather than in `out/`. scripts/build-all.mjs reads it from there.
  distDir: process.env.NODE_ENV === "production" ? `.next/export-${league}` : `.next/dev-${league}`,
  // Fail the build on type errors instead of shipping a broken export.
  // (Next 16 removed the `eslint` config key — linting is a separate CI step.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
