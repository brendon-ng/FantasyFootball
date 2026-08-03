import type { NextConfig } from "next";

// GitHub Pages serves this repo from a subpath, https://<user>.github.io/DenOpsFF,
// so every route and asset URL needs the repo name in front of it.
//
// In Actions, GITHUB_REPOSITORY is "owner/repo", so renaming the repo updates the
// prefix automatically. The literal fallback keeps local production builds
// (`npm run preview`) identical to CI. Dev runs at the root, unprefixed.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "DenOpsFF";
const basePath = process.env.NODE_ENV === "production" ? `/${repo}` : "";

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
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Fail the build on type errors instead of shipping a broken export.
  // (Next 16 removed the `eslint` config key — linting is a separate CI step.)
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
