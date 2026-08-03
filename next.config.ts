import type { NextConfig } from "next";

// The site is served from https://<username>.github.io/DenOpsFF, so every asset
// and route needs the repo name as a prefix. Local `next dev` runs at the root.
const basePath = process.env.NODE_ENV === "production" ? "/DenOpsFF" : "";

const nextConfig: NextConfig = {
  // GitHub Pages serves static files only — no Next.js server.
  output: "export",
  basePath,
  // Pages has no image optimizer available at runtime.
  images: { unoptimized: true },
  // Emit `about/index.html` rather than `about.html` so Pages resolves
  // extensionless URLs correctly.
  trailingSlash: true,
};

export default nextConfig;
