# DenOpsFF

A [Next.js](https://nextjs.org) site published to GitHub Pages at
`https://<username>.github.io/DenOpsFF`.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Edit `app/page.tsx` and the
page hot-reloads.

To preview the production build exactly as Pages will serve it:

```bash
npm run build    # writes static HTML to ./out
npm run preview  # serves ./out on http://localhost:3000
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the
static export and publishes `out/` to GitHub Pages.

One-time repo setup: **Settings → Pages → Build and deployment → Source →
GitHub Actions**.

## GitHub Pages specifics

Because the site lives under a repo subpath rather than at a domain root,
`next.config.ts` sets:

- `output: "export"` — Pages serves static files only, so there is no Next.js
  server. API routes, middleware, and ISR are unavailable.
- `basePath: "/DenOpsFF"` in production — prefixes all routes and assets.
  Local `next dev` runs at the root, so `basePath` is empty there.
- `images.unoptimized: true` — `next/image` optimization needs a server.
- `trailingSlash: true` — emits `about/index.html` instead of `about.html` so
  extensionless URLs resolve.

`public/.nojekyll` stops Pages from running Jekyll, which would otherwise drop
the `_next/` directory.

If you rename the repository, update `basePath` to match.
