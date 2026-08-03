# DenOpsFF

A [Next.js](https://nextjs.org) site statically exported to GitHub Pages at
**https://brendon-ng.github.io/DenOpsFF/**.

## Local development

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Edit `app/page.tsx` and the page hot-reloads.

> Dev serves at the **root**; production serves under **`/DenOpsFF`**. See
> [Working under a subpath](#working-under-a-subpath) — this difference is the
> usual cause of "worked locally, broken on Pages".

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at `localhost:3000`, no path prefix |
| `npm run build` | Static export to `out/` |
| `npm run preview` | Builds, then serves at `localhost:3000/DenOpsFF/` — matches production |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Lint + typecheck, the same gate CI runs |
| `npm run clean` | Removes `.next/`, `out/`, `.preview/` |

Run `npm run check` before pushing. Run `npm run preview` too if you touched
assets, routing, or `next.config.ts`.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which lints,
typechecks, builds the static export, verifies every asset URL carries the
subpath prefix, and publishes `out/` to Pages.

Pages **Source** is set to *GitHub Actions* (Settings → Pages → Build and
deployment). Don't switch it to a branch deploy: this is a build-step project, so
a branch deploy would serve raw source, and Jekyll would render `README.md` as
the homepage instead of the app.

`out/` is gitignored and must never be committed — CI is the only thing that
builds it.

`deploy.yml` must stay the only workflow that deploys to Pages. The Pages
settings UI offers to commit a sample `nextjs.yml`; **decline it**. It races this
workflow, and its `static_site_generator: next` option injects a competing
`basePath` that breaks `withBasePath()`. If it shows up, delete it.

## Working under a subpath

Pages serves project repos from `https://<user>.github.io/<repo>/`, so every URL
needs a `/DenOpsFF` prefix. `next.config.ts` sets `basePath` to handle this.

**Applied for you:** `<Link href>`, `next/font`, and imported CSS/JS assets.

**Not applied — wrap in `withBasePath()`:**

```tsx
import Image from "next/image";
import { withBasePath } from "@/lib/base-path";

<Image src={withBasePath("/logo.svg")} alt="" width={100} height={20} />
<a href={withBasePath("/bylaws.pdf")}>Bylaws</a>
const data = await fetch(withBasePath("/data/rosters.json")).then(r => r.json());
```

`next/image` is the easy one to miss — unlike `<Link>`, it does **not** prefix
`src` automatically. Same for raw `<img>`, `url()` in CSS, and anything else that
points at `public/` by hand.

The deploy workflow fails the build if any root-relative `src`/`href` in the
generated HTML is missing the prefix, so this can't reach production silently.

### Renaming the repo

`basePath` reads `GITHUB_REPOSITORY` in CI, so a rename fixes itself on the next
deploy. Two local-only spots hardcode the name: the fallback in `next.config.ts`
and the `preview` script in `package.json`.

## Static export limits

`output: "export"` means no Node server at runtime, so API routes, Server
Actions, middleware, `cookies()`, ISR, and `redirects`/`rewrites`/`headers`
config are all unavailable. Server Components still work but run at **build
time** — for live data, fetch from the client. Full list in
`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`.

Other config in `next.config.ts`:

- `images.unoptimized: true` — the optimizer needs a server
- `trailingSlash: true` — emits `about/index.html` so extensionless URLs resolve

`public/.nojekyll` is insurance: Actions deploys skip Jekyll, but under a branch
deploy Jekyll would strip the `_next/` directory.
