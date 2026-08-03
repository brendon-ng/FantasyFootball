<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DenOpsFF

Static Next.js site deployed to GitHub Pages at `https://brendon-ng.github.io/DenOpsFF/`.
Pushing to `main` runs `.github/workflows/deploy.yml`, which lints, typechecks,
builds, and publishes `out/`. Pages **Source** is set to *GitHub Actions* — do not
switch it to a branch deploy, and never commit `out/`.

`deploy.yml` must be the **only** workflow that calls `actions/deploy-pages`. The
Pages settings UI offers to commit a sample `nextjs.yml`; accepting it creates a
second Pages deploy that races this one. That sample also passes
`static_site_generator: next` to `actions/configure-pages`, which injects its own
`basePath` and bypasses the `env` block in `next.config.ts` — `withBasePath()`
then returns unprefixed URLs and assets 404. If `nextjs.yml` reappears, delete it.

## Two constraints govern almost every change here

### 1. There is no server

`output: "export"` produces plain HTML/CSS/JS. Anything needing a Node runtime
fails the build. Per `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`:

- No Route Handlers that read `Request`, no Server Actions, no middleware/proxy
- No `cookies()`, `headers()`, Draft Mode, or ISR
- No `rewrites`, `redirects`, or `headers` config — Pages ignores them
- Dynamic routes need `generateStaticParams()` and `dynamicParams: false`
- `next/image` needs `unoptimized: true` (already set) or a custom loader

Server Components still work — they run at **build time**. Fetch data there and it
gets baked into the HTML. For live data, fetch client-side from the browser.

Data that changes on a schedule (e.g. Sleeper API) has two options: fetch at build
time and rebuild via a scheduled workflow, or fetch client-side at runtime. Pick
deliberately; there is no middle ground.

### 2. The site is served from a subpath, not a domain root

Production URLs are prefixed with `/DenOpsFF`. Dev (`npm run dev`) is **not** —
this asymmetry is the single most common way to break the deployed site while
everything looks fine locally.

Applies the prefix automatically: `<Link>`, `next/font`, CSS/JS imports.

Does **not** — you must wrap these in `withBasePath()` from `@/lib/base-path`:

```tsx
import Image from "next/image";
import { withBasePath } from "@/lib/base-path";

<Image src={withBasePath("/logo.svg")} alt="" width={100} height={20} />
<a href={withBasePath("/rules.pdf")}>Bylaws</a>
const data = await fetch(withBasePath("/data/rosters.json")).then(r => r.json());
```

Also unprefixed by default: raw `<img>`/`<video>` tags, `url()` in CSS,
`router.push()` with a string literal, and anything in `public/` you reference by
hand. CI fails the build if any root-relative `src`/`href` in the output HTML
lacks the `/DenOpsFF` prefix — trust that check, don't work around it.

`basePath` is derived from `GITHUB_REPOSITORY` in CI, so renaming the repo updates
it automatically. The literal fallback in `next.config.ts` and the `preview` script
in `package.json` would need updating by hand.

## Before you push

```bash
npm run check     # lint + typecheck, same as CI
npm run preview   # real production build served at localhost:3000/DenOpsFF/
```

`npm run preview` is the only local check that reproduces the subpath. Use it
whenever you touch assets, routing, or `next.config.ts` — `npm run dev` will not
catch basePath bugs.

## Gotchas

- Client-side routing works via `<Link>`, but a hard refresh on a deep URL is
  served by Pages as a real file lookup. `trailingSlash: true` makes this work for
  statically generated routes; a client-only route with no generated HTML will 404.
- `public/.nojekyll` is belt-and-braces. Actions deploys skip Jekyll entirely, but
  it protects against someone flipping Pages back to a branch deploy, where Jekyll
  would strip the `_next/` directory.
- Next 16 removed the `eslint` key from `next.config.ts` and `next lint`. Lint runs
  as its own step. Check the bundled docs before assuming any config key exists.
