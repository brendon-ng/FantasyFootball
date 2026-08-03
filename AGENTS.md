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

## Where this stands

A working league hub, ~506 static pages, no database. Nothing has been pushed —
`main` is ahead of `origin/main` by the whole build. `npm run preview` is the
only way to see it at the real subpath.

**Pages:** `/` (league at a glance, adapts to offseason), `/keepers`,
`/history`, `/history/[season]`, `/records`, `/owners/[slug]`, `/players/[id]`,
`/h2h/[pair]`.

**Seasons on record:** 2020-25. Champions: Jake Gibbons, Brendon Ng, Tyler Jung,
Logan Dunn, Jaymie Lew, David Collier.

### Known gaps

- **No draft history page.** `data/derived/drafts.json` is populated (340 picks
  with keeper flags) and nothing renders it. Clearest next piece of work.
- **Imported brackets have no bracket lines.** ESPN publishes routing for the
  consolation ladder but not the championship bracket, so 2020-23 render as
  round columns. Routing could be inferred further if wanted.
- **Nothing has been verified in a browser by an agent.** Every visual bug this
  session was caught by the user from a screenshot: inverted toilet-bowl
  placements, bracket misalignment, duplicate React keys, a panel clipping its
  last row. Build output and DOM inspection do not catch layout. Ask the user to
  look, or run `npm run preview` and screenshot it.
- **Tooltips are native `title` attributes**, so column hints are unreachable on
  touch devices.

### Requested, not yet built

- **Draft history page**: `drafts.json` holds all 340 picks and nothing renders it.

Keeper history shipped at `/keepers/history/` (by team and season) and on player
pages (a "Times kept" tile plus a Keeper History panel). Both read `isKeeper`
off draft picks rather than contract state — a pick records what happened, a
contract asserts what a player is worth. Only Sleeper drafts contribute, so the
record starts at 2025: 2024 was the startup draft and the ESPN seasons kept no
draft data.

### Open decisions the user has parked

- **Bylaws 1.7.2.4.2 vs 1.7.2.4.3 contradict each other** on whether dropping
  and re-adding your own player resets the contract. 4.2 is implemented because
  that matches the real 2025 data (Chase Brown). The user said "let's go with
  4.2 for now, we'll hash this out."
- **Trade deadline**: bylaws say week 11, Sleeper 2025 said 12. Rules files say
  11. User said ignore for now.
- **ADP beyond pick 170** converts to a round past 17, which is meaningless as a
  keeper cost in a 10-team, 17-round draft. Bites in 2027, when the first
  contracts expire.
- **All-time table sorts titles-first**, so a 2-season co-owner can top it. User
  has not asked to change it.

## Automation

Three workflows, all free — Actions minutes are unlimited on public repos, and
this repo is public. If it ever goes private, thin the game-window crons: the
current config is ~500 builds/month and would eat most of the 2,000-minute
free tier.

| Workflow | Cadence | Does |
| --- | --- | --- |
| `deploy.yml` | push + every 15 min in NFL game windows, else 6-hourly | build & publish; bakes in-progress Sleeper data |
| `archive.yml` | Tuesdays 12:00 UTC | `sync` + `derive`, commits only if something newly finalized |
| `keepalive.yml` | 3rd of each month | commits a timestamp so cron workflows are never auto-disabled |

Pushes made with the default `GITHUB_TOKEN` do NOT trigger other workflows —
GitHub suppresses that to prevent recursion. So `archive.yml` does not trigger a
deploy; its data ships on the next scheduled build, at most six hours later.
`keepalive.yml` relies on the same suppression to avoid causing rebuilds.

Manual work is twice a year: `npm run adp:lock` before the keeper deadline, and
adding `config/rules/<year>.json` each new season (`derive` throws without it).
Season discovery finds the new league ID on its own.

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

### Three layers of data

1. **Imported** (`data/manual/`) — 2020-23 ESPN seasons, frozen forever.
2. **Derived** (`data/derived/`) — built from committed Sleeper dumps by
   `npm run derive`. Fixed between deploys.
3. **Live** (`lib/sleeper-browser.tsx`) — fetched in the BROWSER at view time.

Layer 3 exists because Sleeper sends `access-control-allow-origin: *`, so a
no-server site on Pages can show data fresher than its last build. Use it only
for facts that genuinely move faster than the deploy schedule — keeper
selections before the deadline, live scores on a Sunday. Anything stable belongs
in layer 2, where it costs the client nothing.

`useLiveRosters()` fails soft on purpose: a Sleeper outage leaves the page
showing its baked data rather than an error, because everything on it is still
correct — just not annotated. Keep that property.

Do not fetch in the browser from `lib/sleeper.ts`; it is build-time only and
carries Node assumptions. `lib/sleeper-browser.tsx` must stay dependency-free.

### What imported seasons cannot support

2020-23 came from archived ESPN pages, imported ONCE. The league is on Sleeper
permanently now, so `npm run import:espn` is a historical artifact — the JSON it
produced is the deliverable, not the script.

Those seasons have standings, final placement and full playoff scores. They have
NO weekly matchups, rosters, drafts or transactions. So they feed standings,
finishes, the trophy case and postseason head-to-head, and are excluded from
regular-season head-to-head, weekly records, player records and keeper
contracts. `SeasonSummary.imported` is the flag, and every affected surface says
so in the UI rather than silently mixing eras.

The two ESPN pages cross-validate: placement reconstructed from the brackets
must equal the standings RK column, or the import throws. All 48 placements
across four seasons agree.

### ESPN brackets have three sections and a different consolation format

Sleeper has two postseason sections; ESPN has THREE — championship bracket,
winner's consolation ladder (3rd-6th), and the main ladder (7th-12th). Merging
the last two loses both the structure and the placements.

ESPN's consolation is a LADDER, not Sleeper's anti-tournament: winning moves you
UP a rung, and the loser of the bottom rung in the final week finishes last. So
`inverted` is false for imported brackets. `ladderConsolation` picks the right
copy; do not unify the two formats.

Three parsing traps, all of which produced plausible-looking wrong output:

1. ESPN prints a ladder label AFTER its game ("… 109.72 | GmC1 - W to GmC4"),
   so attaching it to the next game shifts every id and routing by one.
2. Bye synthesis must be off when the data has explicit byes or the section
   starts after round 1 — otherwise every unlinked team gets a phantom bye.
   Sleeper omits byes and needs them inferred; ESPN publishes them.
3. Feeder inference must pick the NEAREST earlier round. A finalist also won in
   round 1, so matching the earliest link collapses the bracket.

### Co-owners are first-class owners

Every person has their own slug and record. A co-owned team's record is credited
to EACH owner, so Maddy is credited for Jake's seasons and Katie for Jaymie's.
Consequence: all-time columns double-count co-owned seasons and will not sum to
league totals. That is intended — these are personal records — and the UI says
so on the all-time table.

A team-season still has one primary owner (`StandingsRow.ownerSlug`) used to
group keeper contracts and key franchise URLs; `ownerSlugs` is the full credit
list. For Sleeper that is `owner_id` plus `co_owners`; for ESPN, the order in
"Olivia Nelli, Lauren Gross".

Departed owners carry `active: false`. They stay in all history — Logan Dunn won
2023 — but never appear on the keeper board or current-season views.

### Events must be replayed chronologically, not draft-then-transactions

Sleeper stamps every preseason move as `leg: 1`, but many happen BEFORE that
season's draft — 15 across 2024-25. Joe Burrow was traded from Lauren to Brendon
on 2025-08-22, four days before the 2025 draft, after which Brendon kept him.
Replaying the draft first claims Brendon kept a player he did not yet own.

`seasonTimeline()` in `scripts/derive.ts` merges picks and transactions into one
stream ordered by timestamp — picks at `draft.start_time + pick_no`, transactions
at `status_updated`. Both the keeper resolver and the player history read from
it. `PlayerTransaction.preseason` carries the distinction to the UI so a
pre-draft trade never renders as "week 1".

A TRADE IS ONE EVENT. Sleeper stores it as an add and a drop inside a single
transaction; emitting those separately renders as "Dropped by Lauren / Added by
Brendon", two half-events that never say a trade happened. `buildPlayerHistory`
pairs them into a single `trade` action with `fromSlug`/`toSlug`.

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
