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

## Data pipeline

League data lives in `data/` as committed JSON. There is no database and no
runtime API — the site reads these files at build time.

```
config/league.json        owners, league IDs, discovery anchor
config/rules/<year>.json  per-season rules; NEVER edit a past season's file
data/raw/<year>/          finalized Sleeper dumps (source of truth)
data/derived/*.json       computed output (standings, keepers, records)
data/players.json         slim player index (~44KB, not Sleeper's 5MB map)
data/manual/              hand-entered pre-Sleeper seasons
```

`npm run data` = `sync` then `derive`.

- **`npm run sync`** hits Sleeper and writes only *finalized* data — a week once
  Sleeper has scored it, a season once its status is `complete`. It is
  idempotent: an unchanged league produces an empty git diff, so any diff you
  see is real new history. Flags: `--force`, `--season=2025`, `--skip-players`.
- **`npm run derive`** is pure — no network, never touches `data/raw/`. Delete
  `data/derived/` and re-run to rebuild from scratch.

Rules are versioned per season so changing 2027's keeper rules cannot
retroactively rewrite 2024's contracts. Adding a season means adding
`config/rules/<year>.json`; `derive` throws if one is missing.

### Season discovery

Sleeper mints a new `league_id` every year and only links *backward* via
`previous_league_id`. `sync` finds each new season by listing `anchorUserId`'s
leagues and matching on `previous_league_id`, which also filters out that user's
unrelated leagues. Nothing needs editing in September.

Always resolve a draft through `league.draft_id`. `/league/:id/drafts` is unsafe:
the 2024 league carries two abandoned drafts alongside the real one.

### Keeper contracts

Sleeper models no part of this — `is_keeper` is a bare boolean with no round and
no contract length. `resolveKeepers()` in `scripts/derive.ts` replays every draft
and transaction to reconstruct cost, keeps used, and lineage per bylaws 1.7.2.
Every contract carries a `provenance` array that the UI renders, so the maths is
auditable. Corrections go in `config/keeper-overrides.json` — never in code.

Ownership is reconciled against each season's final roster snapshot, because the
transaction log is not a complete record of roster mutation.

### The toilet bowl is inverted

Sleeper's `w` field means "advances", and in the losers bracket you advance by
LOSING — you play your way down to last place. So the advancing team is the
LOWER scorer. Verified against 2024 match 1: Sleeper reports `w: 2`
(davidrcollier, 109.66) over brendonn8 (110.56).

Placement therefore counts in opposite directions:

| Bracket | Sleeper `p` | Overall places `[winner, loser]` |
| --- | --- | --- |
| Winners | 1 | `[1, 2]` |
| Winners | 3 | `[3, 4]` |
| Losers | 1 | `[10, 9]`  ← winner takes LAST |
| Losers | 3 | `[8, 7]` |

Losers-bracket formula: winner = `totalTeams - p + 1`, loser one better. Getting
this backwards silently swaps the toilet-bowl champion with the team that
escaped it. `BracketMatch.inverted` carries the flag through to the UI so it
never renders the advancing team as "W".

Both derived seasons are verified against screenshots of the Sleeper app — all
20 placements match.

### Local development

Node's native TypeScript stripping runs `scripts/*.ts` directly, which is why
relative imports there carry explicit `.ts` extensions and `tsconfig.json` sets
`allowImportingTsExtensions`. Behind a proxy, `fetch` needs
`NODE_USE_ENV_PROXY=1 npm run sync` — Node ignores `HTTP_PROXY` otherwise.

### ADP

Sleeper publishes no ADP — verified, not assumed: the REST player object exposes
only `search_rank` (positional; Bijan Robinson and Josh Allen are both `1`), and
the GraphQL schema at `sleeper.com/graphql` has 238 root fields with zero ADP
types. So it is scraped from beatadp.com's server-rendered Sleeper column, whose
default state is already PPR / Redraft / 1QB.

**Baked at build time, never fetched in the browser.** beatadp sends no
`access-control-allow-origin`, so a client-side fetch is blocked outright, and
the page is 826KB of HTML. Since deploys already run on a schedule and ADP moves
daily at most, build-time capture is effectively live and costs the client zero
bytes and zero JS.

Two files with different authority:

| File | Written by | Authority |
| --- | --- | --- |
| `data/adp/live.json` | every `npm run data` | display only |
| `data/adp/<season>.json` | `npm run adp:lock` | revalues expired contracts |

`adp:lock` refuses to overwrite without `--force`, because bylaws 1.7.2.2.1 fixes
ADP a week before the keeper deadline and a silent re-capture would move keeper
costs after the fact. `getAdp()` prefers the frozen file and falls back to live.

Round conversion divides ADP by *this league's* team count, so pick 15 is round 2
in a 10-team league. Surplus value shown in the UI is `costRound - adpRound`:
positive means the keeper pick is cheaper than market. Mind the direction —
round numbers count up as value counts down.
