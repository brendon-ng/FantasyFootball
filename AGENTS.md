<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# One codebase, many leagues

This repo serves SEVERAL fantasy leagues from one codebase. Every feature is
written once and benefits all of them; nothing is duplicated per league.

Currently: **den-ops** (Den Ops Super League, keepers, ESPN history 2019-23) and
**masterbatters** (Masterbatters Fantasy Football, redraft, Sleeper-only, 2025-).

Static Next.js deployed to GitHub Pages. Pushing to `main` runs
`.github/workflows/deploy.yml`, which lints, typechecks, builds every league, and
publishes `out/`. Pages **Source** is set to *GitHub Actions* — do not switch it
to a branch deploy, and never commit `out/`.

Live at `https://brendon-ng.github.io/FantasyFootball/`. The repo was renamed
from `DenOpsFF`, which now holds nothing but path-preserving redirects to
`/FantasyFootball/den-ops/` so published links keep working.

## The league is chosen at BUILD time, not request time

`npm run build` runs `next build` ONCE PER LEAGUE with `LEAGUE=<slug>` set, then
assembles the results (`scripts/build-all.mjs`):

```
out/den-ops/        a whole site
out/masterbatters/  a whole site
out/index.html      hand-written league picker
```

So each build is a single-league site and needs NO league plumbing: pages call
`getSeasons()`, never `getSeasons(league)`. `lib/data.ts` resolves `LEAGUE` once
and every accessor reads that league's directory.

Consequence worth knowing: a page showing TWO leagues' data at once is not
possible as things stand, because a build only loads its own league's JSON. If
that is ever wanted, have `build-all.mjs` emit a shared cross-league JSON first.

`LEAGUE=masterbatters npm run build:one` builds one league for quick iteration.
`npm run dev` serves `LEAGUE` too, defaulting to den-ops.

### Adding a league is a config change, not a code change

1. `config/leagues/<slug>/league.json` — `slug` (must equal the directory),
   `name`, `shortName`, `features`, `sport`, `anchorUserId`, `knownLeagueIds`
   (at least one season to bootstrap discovery), `owners`.
2. `config/leagues/<slug>/rules/<year>.json` for every season — `derive` throws
   without one.
3. `npm run data`. Sync, ADP and derive all loop every league by default;
   `--league=<slug>` scopes a run.

`features` gates whole subsystems rather than scattering `if (slug === ...)`:

| Flag | Off means |
| --- | --- |
| `keepers` | no Keepers tab, no contracts on home/owner pages, `resolveKeepers()` not run, `/keepers` says the league does not use keepers |
| `adp` | `npm run adp` skips the league entirely |
| `espnImport` | `npm run import:espn` skips it |
| `keepers` (home) | no keeper-deadline card on the draft panel — a redraft league has no deadline |
| `weeklyLowPunishment` | no weekly-low markers anywhere — no chip on a matchup, no glyph in a season's week list, no column or tally on an owner page |

`slug` is load-bearing — it is the URL segment AND the data directory. It must
never change once published.

`deploy.yml` must be the **only** workflow that calls `actions/deploy-pages`. The
Pages settings UI offers to commit a sample `nextjs.yml`; accepting it creates a
second Pages deploy that races this one. That sample also passes
`static_site_generator: next` to `actions/configure-pages`, which injects its own
`basePath` and bypasses the `env` block in `next.config.ts` — `withBasePath()`
then returns unprefixed URLs and assets 404. If `nextjs.yml` reappears, delete it.

## The bylaws are the spec

`docs/bylaws/den-ops.md` is that league's constitution and the source of truth for every
rule this site models — keeper contracts above all. Read it before changing
anything in `resolveKeepers()`, and check any rule question against it rather
than inferring intent from the code.

It ends with implementation notes: which bylaw lives where, what has been
verified against real data, and four open discrepancies the league has parked.

## Where this stands

A working league hub, no database. Two leagues build and deploy: den-ops (735
pages, six seasons, keepers) and masterbatters (503 pages, one season, redraft).
`npm run preview` is the only way to see them at the real subpath.

The home page's offseason slot carries a Record Book panel (top 3 of highest and
lowest week, biggest blowout, closest win) for EVERY league. It is the whole
offseason story for a redraft league: rosters are empty until the draft and there
are no keeper contracts, so without it that page has nothing current to say.

The weekly high and low rows name only the team: a single-week score is a
property of ONE team, and the opponent had nothing to do with it. The blowout and
closest-win rows are inherently about both, so they name both. Those are wins by
construction, but the verb is still derived from the two scores rather than
hardcoded — a high or low week can go either way, and Masterbatters' second-lowest
week was won by the team that scored it.

**Pages:** `/` (league at a glance, adapts to offseason), `/keepers`,
`/keepers/history`, `/history`, `/history/[season]`, `/records`,
`/owners/[slug]`, `/players/[id]`, `/h2h/[pair]`, `/matchups/[id]`.

`/matchups/[id]` is the single home for lineups — the head-to-head page lists a
series and links into it. Never render a per-player breakdown in both; two
renderers for the same thing drift apart. The id is
`<season>-<week>-<slugA>-vs-<slugB>` with slugs sorted, deliberately not
Sleeper's `matchup_id`, which is only unique within a week.

**Seasons on record:** 2019-25. Champions: David Collier (2019, 2025), Jake
Gibbons, Brendon Ng, Tyler Jung, Logan Dunn, Jaymie Lew.

### Known gaps

- **Imported brackets have no bracket lines.** ESPN publishes routing for the
  consolation ladder but not the championship bracket, so 2019-23 render as
  round columns. Routing could be inferred further if wanted.
- **Nothing has been verified in a browser by an agent.** Every visual bug this
  session was caught by the user from a screenshot: inverted toilet-bowl
  placements, bracket misalignment, duplicate React keys, a panel clipping its
  last row. Build output and DOM inspection do not catch layout. Ask the user to
  look, or run `npm run preview` and screenshot it.
- **Tooltips are native `title` attributes**, so column hints are unreachable on
  touch devices.

### Draft slots and the projected board

`lib/draft-slots.ts` is the one implementation of bylaws 1.7.2.2.2 — with two
picks in the same round the keeper takes the LOWER slot, 3.10 over 3.05, so the
team keeps its earlier pick to draft with. Shared by the owner profile's pick
list and the keeper page's projected board; two copies of a bylaw would drift.

Keepers are placed in ASCENDING cost round (most constrained first — a round 1
keeper has no fallback, a round 12 keeper has eleven) and take the LATEST pick
within a round. Those are different rules doing different jobs; do not merge them.

WAIT FOR `draft_order`, NOT FOR `slot_to_roster_id`. Sleeper ships the slot map as
an identity placeholder (slot 1 -> roster 1, ...) from the moment a draft exists —
confirmed against a 2024 draft that had a start time set and was still unordered,
so the DATE being set proves nothing either. Trusting the placeholder would render
a confident running order in roster-creation sequence. `orderIsSet()` is the gate.

Verified against the real 2025 draft: `pickLabel` reproduces Sleeper's own numbering
on all 170 picks, `buildBoard` names the right owner for all 170 including the 23
traded, and a team holding 3.01 and 3.07 puts its keeper on 3.07.

### A completed draft reaches the site immediately

`sync` commits `draft.json` and `draft-picks.json` the MOMENT a draft completes,
but withholds `league.json`, `rosters.json` and `users.json` until the SEASON is
over — those keep moving, and committing a moving target would break the
empty-diff property. `loadSeason` needs `league.json`, so a mid-season draft used
to be skipped entirely by derive: the picks sat in `raw/` and reached no page
until January.

`draftOnlySeasons()` closes that. Attribution comes out of `draft.json` alone,
which carries both halves — `slot_to_roster_id` is slot -> roster and
`draft_order` is user -> slot, so composing them gives roster -> user with no
roster snapshot. `picked_by` is the fallback, since it is empty on an autopick.

`/history/<season>/draft/` therefore keys on the DRAFTS, not on finalized seasons,
and its back link falls through to `/history/` when the season page does not exist
yet. Exercised with a fixture: 168 picks, every owner attributed.

### Previewing the draft before it happens

Two sticky flags, both of which only ever fill in a MISSING value — once Sleeper
has the real thing they quietly stop doing anything:

| Flag | Stands in |
| --- | --- |
| `?mockDraftOrder=true` | an order and a date two weeks out, so the keeper deadline is still ahead |
| `?mockDraft=true` | the above PLUS a completed draft dated three days ago, so the deadline reads as passed |

MUTUALLY EXCLUSIVE, and `mockDraft` wins — it is the later state of the same
timeline, so a finished draft implies an order. Both persist across navigation via
`lib/sticky-params.ts`.

A client flag CANNOT fabricate a static page, so neither mocks
`/history/<season>/draft/`; that route only exists once the real picks are
committed. They reach the live surfaces only.

Deterministic, seeded by the draft id: a reload does not reshuffle and a
screenshot stays reproducible. `Math.random()` would also re-order on every render.

NOT gated on NODE_ENV, deliberately. `npm run preview` builds production, and that
subpath is the only place basePath bugs appear, so a dev-only gate would disable
this exactly where the board most needs looking at. Both surfaces badge it "MOCK
ORDER" instead — a stand-in renders identically to a real one, and "the order is
out" is exactly what gets screenshotted and believed.

`/keepers` renders a projected board — pick ownership after trades, with locked-in
keepers filled into the pick they will consume. ENTIRELY LIVE: order, trades and
selections all move until the draft runs, at which point `derive` commits the real
thing to `drafts.json` and `/history/<season>/draft/` takes over. Before the order
is drawn it says so rather than guessing.

`/history/<season>/draft/` renders a season's draft as the board it happened on
— slots as columns, rounds as rows. Only seasons WITH picks get a page, so the
2019-23 ESPN seasons have no link.

Two things it deliberately does not do. There is no ADP column: `getAdp()` is the
CURRENT market, so pricing a 2024 pick against it would compare that draft to a
market that did not exist. And the trade marker lives inline on the pick's top
row rather than in a banner, because a conditional extra row makes traded cells
taller and knocks the whole grid row out of alignment.

A traded pick is found by comparing the pick's own `roster_id` (who used it) with
the draft's `slot_to_roster_id` (whose slot it is) — carried through as
`DraftPickRecord.slotOwnerSlug`. Cross-checked against `traded-picks.json`: both
report the same 23 picks for 2025. The pick is the better source for history,
since `traded-picks.json` describes CURRENT ownership and would rewrite a past
draft after a later trade. A board column is a SLOT, so it is labelled by
`slotOwnerSlug`; labelling from picks names the column after whoever traded in.

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

## The weekly low scorer

Masterbatters punishes whoever scores lowest in a regular-season week; Den Ops
does not. `features.weeklyLowPunishment` gates every marker.

`buildWeeklyLows()` in derive computes it for EVERY league regardless of the flag,
because the low scorer is a FACT and only the punishment is league-specific. The
flag is therefore purely presentational, and turning the rule on is a config
change with no re-derive semantics to think about.

REGULAR SEASON ONLY. A postseason week is not every team playing, so the lowest of
a six-team playoff field would be ranked against a twelve-team regular-season
field. Ties emit one row per tied team, since a shared low is shared.

`getWeeklyLowKeys()` returns an empty set when the flag is off, so callers never
re-check it — a league without the rule simply has no low scorers to mark.

Surfaced in six places: a chip on the matchup page's scoreline, a 🚽 glyph beside
the name in a season's week list, a 🚽 column in the season standings, a 🚽 column
in an owner's season-by-season table, a sortable 🚽 column in the all-time table,
and a career count as the subtitle of the owner profile's "Last places" tile —
subtitle rather than its own tile, which would wrap to a row of one.

TERMINOLOGY. "Weekly low" means lowest in THAT week, i.e. who owes a punishment.
The all-time record lists deliberately say "Highest score" / "Lowest score", never
"weekly high/low" — the two read identically otherwise, and a record badge then
looks like a punishment marker.

## Default all-time ordering

`byAllTimeRank()` in `lib/ranking.ts` is the one definition: titles, wins, average
finish, 2nds, 3rds, playoff appearances — then win% purely so the result does not
depend on input array order. Used by derive (so `owner-records.json` ships in that
order), the home leaderboard, and the sortable all-time table's default view. Three
copies of that chain would drift.

It ranks achievement over accumulation — an owner with one title outranks a
higher-win owner with none.

Two terms break the pattern. Average finish sorts ASCENDING, because 1st beats 8th,
and a null (no finished season) must sort LAST — a naive numeric compare gets both
backwards. Playoff appearances is a COUNT, not the rate the table's Playoffs column
sorts by, matching 2nds and 3rds; the rate-shaped signal is already carried by
average finish earlier in the chain.

The table's 🏆 column keys off the same comparator and carries the default sort
indicator, so clicking back to it reproduces the shipped order rather than a
titles-then-win% approximation.

## League avatar and favicon

`npm run sync` downloads the league's Sleeper avatar to
`public/avatars/<slug>.<ext>`. It appears in three places: the favicon (via
`metadata.icons` in `layout.tsx`), the nav wordmark, and the root league picker —
so two leagues from one repo are distinguishable in a tab strip and at a glance.

The nav takes an ALREADY-PREFIXED src. It renders a plain `<img>`, which Next does
not rewrite for `basePath`, so the layout wraps it in `withBasePath()` — see the
subpath section.

SELF-HOSTED, NOT HOTLINKED. `sleepercdn.com` would otherwise be a live dependency
for the tab icon of a site whose whole point is needing no server.

Three things that are easy to get wrong:

- The EXTENSION VARIES. Sleeper stores whatever was uploaded and serves it as
  `application/octet-stream` regardless — Den Ops' is a PNG, Masterbatters' a JPEG.
  Sync sniffs the magic bytes and deletes any stale file in the other format;
  `leagueAvatar()` probes for the extension rather than assuming one.
- `app/favicon.ico` WAS DELETED ON PURPOSE. That file convention is per build
  TREE, not per build, so it could only ever give every league the same icon, and
  it emits a competing `<link rel="icon">` next to the one from `metadata.icons`.
- `public/` is copied into every build, so `build-all.mjs` prunes other leagues'
  avatars from each output.

## Postseason labels at phone width

The chip column that marks a playoff, consolation or placement game is `hidden`
below `sm`, so without help every row reads as a regular-season game on a phone.
Two shapes, both `sm:hidden` so nothing is double-labelled once the column returns:

- Head-to-head series and a matchup's rest-of-series: a line UNDER the season/week.
- The record book: pinned to the END of the meta line (`KindInline`), because that
  page stacks seven tables and an extra line per row costs real height. The label
  is `shrink-0` so the OPPONENT truncates first — the label is what a reader cannot
  infer from the rest of the row.

The record book also filters to labels worth showing (`SHOWN_LABELS`), so only a
handful of rows carry one — 4 of ~60 in Den Ops. Most keep the full meta line.

## Wide tables on mobile

Anything with more than a few fixed-width columns needs
`overflow-x-auto` around it and a min-width on the inner table, or a `Panel`
(which is `overflow-hidden`) silently CLIPS the right-hand columns instead of
scrolling them. Currently wrapped: the all-time table, a season's standings, an
owner's season-by-season, and the head-to-head record splits.

THE MIN-WIDTH MUST BE `max-sm:` SCOPED. An unconditional `min-w-[34rem]` fixed
mobile and broke desktop: the table stopped squishing to its card and overflowed by
a few pixels, which reads as a scrollbar appearing for no reason. Desktop already
fits — only the phone needs the floor. (`components/all-time-table.tsx` is the one
exception; it is wide at every size and has always scrolled.)

PREFER `max-sm:min-w-max` OVER A FIXED FLOOR. A fixed floor leaves surplus width
that table auto-layout dumps somewhere arbitrary, and where it lands depends on the
column count — the same `34rem` put W-L flush against the card edge in a 5-column
league and left a wide gap before it in a 6-column one. Sizing to content puts
every column where it belongs whatever shape the league is. Pair it with a
`max-w` on the widest text cell (see below) so content sizing has a bound.

Do not wrap everything. A list whose fixed columns total well under the ~21.5rem a
phone gives fits fine, and a needless min-width introduces scrolling that was not
there. Measure before adding: sum the `w-*` classes in the `ListHeader`.

Separately, a CSS GRID ITEM defaults to `min-width: auto`, so a row wider than its
track overflows the card rather than letting its truncating cell shrink. The home
keeper board needed `min-w-0` on each owner card for exactly this reason — the
cost column was being clipped while the player name refused to truncate.

## Charts

`components/finish-timeline.tsx` uses eight hues from the dataviz skill's dark
categorical palette, in that ORDER. They were checked with its validator against
this surface — lightness band, chroma floor, adjacent CVD separation (worst ΔE 8.4
protan), normal-vision separation (worst ΔE 19.3), 3:1 contrast, all pass. The
order is what makes adjacent slots separable, so do not reorder or substitute
without re-running:

```
node <dataviz-skill>/scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767" --mode dark
```

COLOUR ALONE DOES NOT SCALE TO 16 OWNERS. Past eight the palette repeats with a
DASHED stroke rather than inventing more hues, which stop being separable — that
is composite encoding, and it is the documented answer for a ninth series.

Four things about that chart were got wrong first and are worth not repeating:

- A LABEL SITS ON ITS LAST DOT. Stacking labels in a right-hand gutter to dodge
  collisions removed the only cue tying a name to a line.
- CO-OWNERS SHARE A TEAM, so they share a line and a final placement and their
  names landed on top of each other. They merge into one label — "Jake & Maddy" —
  each first name in its own hue, and each name is its own click target.
- OWNERS WHO HAVE LEFT get a key below the chart, not an in-plot label: their line
  stops mid-chart, so a label there floats free of any axis.
- CLICK PINS, hover only previews. Without pinning, moving the cursor off the line
  you just selected silently deselects it. A click ANYWHERE clears the pin, via a
  document listener; the series handlers `stopPropagation` so the click that makes
  a selection does not immediately undo it. Requiring a second hit on the same
  thin line to release was a selection you could get stuck in.

Give the SVG `h-auto`, never a fixed height. With a fixed height the viewBox
scales to fit it and centres, leaving dead space either side of a wide card.

Finish charts invert Y — 1st at the TOP, since a championship is a peak — and
scale to each season's team count, so 12th of 12 and 10th of 10 both sit on the
floor.

## Viewer identity

`components/identity.tsx` remembers who the visitor is in localStorage, under
`ff:<league>:identity` — scoped per league, because one browser visits both and
the owner lists differ. THREE states, and they are not interchangeable:

| State | Prompt on load? | "My Team" in nav? | Highlight? |
| --- | --- | --- | --- |
| `unset` — never answered | yes | no | no |
| `neutral` — chose to browse | no | no | no |
| `owner` — picked a team | no | yes | yes |

Collapsing `unset` and `neutral` into one falsy value re-prompts someone who
explicitly opted out. Keep them distinct.

Emphasis is ONE injected CSS rule, not a prop threaded through every table:

```
a[href$="/owners/<slug>/"]:not([data-me-exempt]),
[data-owner="<slug>"]:not([data-me-exempt])
```

The link form catches owner names that link to a profile. `[data-owner]` covers
everything else — and that is most surfaces now, because rows on the record
book, season matchups, head-to-head and matchup pages link to the GAME, so the
name inside them is a plain span. WHEN ADDING A NEW SURFACE THAT SHOWS AN OWNER
NAME, put `data-owner={slug}` on it unless it is already a profile link.

The rule uses a literal hex, not `var(--color-me)`. Tailwind tree-shakes theme
tokens to the utilities actually used, so dropping the last `text-me` class
would silently resolve the var to nothing and fall back to inherited white.

`[data-me-exempt]` opts an element out, and matters: the rule is injected after
the stylesheet, so it beats every Tailwind text colour including semantic ones.
Gold champions, bracket winner tints and toned `Stat` tiles are all exempt —
those colours already mean something.

Identity uses `--color-me` (violet), never the accent. The accent green is
overloaded across live state, winners, keeper surplus and cost rounds, so
identity in green is invisible.

State is read with `useSyncExternalStore`, not an effect: an effect that calls
setState on mount is a cascading render and flashes the default for a frame.

## Preseason moves must be applied live

`sync.ts` only persists a week once Sleeper has scored it, so NOTHING that
happens in the preseason reaches `data/raw` until week 1 finalises — which is
after the keeper deadline and after the draft. Drops and trades genuinely happen
in that window, and bylaws 1.7.2.4 reprices a dropped-and-re-added player, so a
purely baked board is wrong exactly when it is being used to decide keepers.

`lib/keeper-live.ts` fetches the current season's unfinalised transactions in the
browser and applies them on top of the derived contracts, then reconciles owner
against the live roster. `components/player-live.tsx` does the same for a player
page's transaction list and owner.

THE UI ALWAYS SHOWS THE CURRENT TRUE STATE. Live data is merged into the same
rows, in the same order, as committed data — never fenced off in a banner or a
separate list. A reader asking "was this player dropped" wants one answer. A
small gold dot with a tooltip records that an event has not been archived yet;
it disappears on its own once the sync catches up. Do not reintroduce a
prominent unsynced treatment.

ITS RULES MIRROR `resolveKeepers()` in `scripts/derive.ts`. If one changes,
change both, or a contract will flicker the moment a week finalises.

Real case that motivated it: Brendon dropped the SF and NE defences in the 2026
preseason. The board showed 19 contracts for a 17-man roster and still listed
both as his.

## Records set at the time

`recordsAtTheTime()` in `derive.ts` flags games that set a league record the
moment they were played — #1 marks only, so the badge stays rare and meaningful
(17 games, 21 marks, 5 still standing).

TEAM-SCORE MARKS ARE NOW EXACT. Every season 2019-2025 has week-by-week scores, so
a mark is measured against the full history rather than a bracket-only sample. It
took no change to this function when each year arrived — the baseline is derived,
not stored.

PLAYER-WEEK MARKS ARE NOT, and the UI still says so. ESPN kept no lineups, so that
baseline genuinely starts empty in 2024 and a 2024 player mark is measured against
nothing earlier. The matchup page's "coverage" tooltip states this; do not remove
it or the badge becomes a claim the data cannot support.

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
adding `config/leagues/<slug>/rules/<year>.json` for each league each new season
(`derive` throws without it). Season discovery finds the new league IDs on its
own.

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

Production URLs are prefixed with `/<repo>/<league>` — e.g. `/FantasyFootball/den-ops`.
Dev (`npm run dev`) is **not** —
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
hand. CI fails the build if any root-relative `src`/`href` in a league's output HTML
lacks that league's `/<repo>/<slug>/` prefix — checked per league, so a page
linking into another league's subtree fails too. Trust that check, don't work
around it.

`basePath` is derived from `GITHUB_REPOSITORY` in CI, so renaming the repo updates
it automatically. The literal fallback in `next.config.ts` and the `preview` script
in `package.json` would need updating by hand.

## Before you push

```bash
npm run check     # lint + typecheck, same as CI
npm run preview   # builds EVERY league, served at localhost:3000/FantasyFootball/
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

## Build speed

`npm run build` is ~27s for both leagues. It was ~4 MINUTES until the data
accessors were memoised.

The cost was never the page count — Masterbatters did 503 pages in 5.5s while Den
Ops took 104s for 1178. It was that `load()` re-read and re-parsed its JSON on
EVERY call, and `getAllMeetings()` is O(owners²): 120 owner pairs, each rescanning
all 655 matchups, recomputed on every one of ~750 matchup pages. Den Ops page
generation is now 2.3s.

Cached: `load()` by path, plus `getAllMeetings`, `getMeetings` (per pair),
`getOwnerMap`, `getWeeklyLowKeys` and `weeklyCoverage` via `once()`.

THE HAZARD IS MUTATION. Every caller now shares one object, so a single in-place
`sort`/`push` on an accessor's return value would corrupt every later read. Nothing
does today — the two `getSeasons().filter(...).sort(...)` sites are safe because
`filter` copies first — but if you add one, copy before mutating.

Builds run SEQUENTIALLY per league and must: Next takes a project-level build lock
and rejects a second concurrent `next build` even with a separate distDir
("Another next build process is already running"). Parallelising would need a
separate checkout per league, which buys nothing now that the whole build is 27s.

## Data pipeline

League data lives in `data/` as committed JSON. There is no database and no
runtime API — the site reads these files at build time.

Everything is per league except the player index.

```
config/leagues/<slug>/league.json        owners, league IDs, features, anchor
config/leagues/<slug>/rules/<year>.json  per-season rules; NEVER edit a past one
config/leagues/<slug>/keeper-overrides.json  optional; keeper leagues only
data/<slug>/raw/<year>/                  finalized Sleeper dumps (source of truth)
data/<slug>/raw/player-ids.json          which players THIS league references
data/<slug>/derived/*.json               computed output
data/<slug>/manual/                      hand-entered pre-Sleeper seasons
data/<slug>/adp/                         captured ADP
data/players.json                        SHARED slim player index (~44KB)
docs/bylaws/<slug>.md                    that league's bylaws
```

`data/players.json` is shared because player metadata is league-agnostic, and it
is the UNION across leagues — so it is built ONCE, after every per-league pass,
from ALL leagues regardless of any `--league=` filter. Building it from only the
league being synced silently deletes the others' player names (this happened;
`--league=masterbatters` dropped 88 Den Ops players).

Each league also records `raw/player-ids.json`, and `getPlayers()` narrows the
shared map to it. Without that narrowing every league generates a player page
for every other league's players, with no data on them.

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

### Sleeper API reference

`https://docs.sleeper.com` is a SINGLE-PAGE Slate doc, so every `#anchor` below
returns the same HTML. Fetch the root once; do not fetch per section.

`WebFetch` is blocked in this environment (a hook rejects it), but plain `curl` in
Bash reaches the internet. Pipe through an HTML-to-text strip.

The sections the user pointed at, in their order:

```
https://docs.sleeper.com
https://docs.sleeper.com/#user
https://docs.sleeper.com/#avatars
https://docs.sleeper.com/#leagues
https://docs.sleeper.com/#get-all-leagues-for-user
https://docs.sleeper.com/#get-a-specific-league
https://docs.sleeper.com/#getting-rosters-in-a-league
https://docs.sleeper.com/#getting-users-in-a-league
https://docs.sleeper.com/#getting-matchups-in-a-league
https://docs.sleeper.com/#getting-the-playoff-bracket
https://docs.sleeper.com/#get-transactions
https://docs.sleeper.com/#get-traded-picks
https://docs.sleeper.com/#get-nfl-state
https://docs.sleeper.com/#drafts
https://docs.sleeper.com/#get-all-drafts-for-user
https://docs.sleeper.com/#get-all-drafts-for-a-league
https://docs.sleeper.com/#get-a-specific-draft
https://docs.sleeper.com/#get-all-picks-in-a-draft
https://docs.sleeper.com/#get-traded-picks-in-a-draft
https://docs.sleeper.com/#players
https://docs.sleeper.com/#fetch-all-players
https://docs.sleeper.com/#trending-players
https://docs.sleeper.com/#errors
```

Base `https://api.sleeper.app/v1`, read-only, no auth, stay under ~1000 calls/min.
Every endpoint this site uses is a typed function in `lib/sleeper.ts` — read that
first, since it also records where the docs are WRONG or incomplete:

- The docs say `loses_bracket`; the real path is `losers_bracket`.
- `/draft/<id>` returns `draft_order` and `slot_to_roster_id`, which the draft-LIST
  endpoints omit. Always resolve a draft through `league.draft_id`.
- `/state/nfl` returns an undocumented `season_has_scores`, and `week`,
  `display_week` and `leg` are three different numbers.
- Fantasy points are split integer/decimal: `fpts` + `fpts_decimal` (1617 + 78 =
  1617.78). Same for `fpts_against`.
- `adds`/`drops` on a transaction are `{player_id: roster_id}` maps, not arrays.
- Player ids are numeric strings EXCEPT team defences, which use abbreviations
  ("DET").
- `/players/nfl` is ~5MB. Cache it; call at most once a day.
- A missing resource returns `null` with HTTP 200, not a 404.
- Avatars: `https://sleepercdn.com/avatars/<id>` and `.../avatars/thumbs/<id>`.
  Not under `api.sleeper.app`, and the content type is `application/octet-stream`
  whatever the real format is.

### Season discovery

Sleeper mints a new `league_id` every year and only links *backward* via
`previous_league_id`. `sync` finds each new season by listing `anchorUserId`'s
leagues and matching on `previous_league_id`, which also filters out that user's
unrelated leagues. Nothing needs editing in September.

Always resolve a draft through `league.draft_id`. `/league/:id/drafts` is unsafe:
the 2024 league carries two abandoned drafts alongside the real one.

### Keeper contracts

KEEPERS BEGIN IN 2024. The 2024 draft was the startup draft — the first time
contracts were set — so nothing before it has keeper state, and the ESPN seasons
(2019-23) never will, however much of them gets recovered. Weekly scoreboards for
those years are now imported, which makes it tempting to backfill; do not. There
were no keepers to track.

Consequences already visible in the data: `keepers.json` covers 2024-25 only, the
2024 draft has zero keeper picks against 2025's forty, and 53 contracts carry
origin `startup`.

Sleeper models no part of this — `is_keeper` is a bare boolean with no round and
no contract length. `resolveKeepers()` in `scripts/derive.ts` replays every draft
and transaction to reconstruct cost, keeps used, and lineage per bylaws 1.7.2.
Every contract carries a `provenance` array that the UI renders, so the maths is
auditable. Corrections go in `config/leagues/<slug>/keeper-overrides.json` — never in code.
The file is optional; a league with nothing to correct omits it.

Ownership is reconciled against each season's final roster snapshot, because the
transaction log is not a complete record of roster mutation.

### Three layers of data

1. **Imported** (`data/<slug>/manual/`) — 2019-23 ESPN seasons, frozen forever.
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

### Recovering a season's weekly scoreboards

Drop `<anything><season>W<week>.mhtml` into `data/<slug>/manual/source/` — one per
week, postseason included — and re-run `npm run import:espn`.

Teams are joined on TEAM NAME, not ESPN's numeric `teamId`. The id is stable and
tempting, but the standings page labels only 11 of 12 teams with an owner: the
logged-in account is listed separately as "My Team" with no owner attached, so an
id-based join silently loses a team. Both archives were saved at the same moment,
so their names agree exactly.

TWO INVARIANTS, both enforced by throwing. Each team's regular-season scores must
sum to its standings Points For, and its win-loss-tie derived from those games must
equal the standings record. A missing or mis-parsed week would otherwise corrupt
every all-time record silently. 2019: 12/12 teams reconcile on both.

Postseason weeks are classified against the bracket, the only source that knows
whether a game was a playoff or a consolation match.

Once a season has weekly data, derive MUST STOP scraping its brackets for scores —
`seasonsWithWeeklyData()` guards the three fallbacks that do. Otherwise every
postseason game is counted twice.

### What imported seasons cannot support

2019-23 came from archived ESPN pages. The league is on Sleeper
permanently now, but `npm run import:espn` is NOT a one-off: 2019 was recovered
and imported long after the others. Drop both MHTML files for a season into
`data/<slug>/manual/source/` and re-run it — the script reimports every season it
finds and is idempotent, so existing years are rewritten identically.

If a season introduces an owner nobody has seen, the import THROWS rather than
inventing a slug. Add them to `league.json` with `active: false` (2019 brought in
Camina Balmores this way), or as an `espnNames` alias if it is an existing owner
under a different label.

Every imported season now has standings, final placement, full playoff scores AND
weekly scoreboards — 2019-23 were all recovered, so every ESPN year is a full
participant in head-to-head, the record book and every weekly list. No season
contributes postseason-only meetings any more, though the code path for one still
exists and is still correct.

`ManualSeason.matchups` carries the weekly games and `hasWeeklyMatchups` states it.

NEVER HARDCODE THE COVERAGE. It read "2024 onward" until 2019 turned up, which
silently falsified that sentence in five places. `weeklyCoverage()` in
`lib/data.ts` derives it.

The caveat only RENDERS when `coverage.missing.length` is non-zero. Every season is
complete today, so it says nothing — "week-by-week scores exist for 2019-2025,
every season is complete" is noise that makes a reader look for a problem. The
machinery stays so a partially-imported league starts warning again by itself.

Rosters, drafts and transactions are still absent for every ESPN year, so player
records and keeper contracts stay Sleeper-only, and a matchup page for one of
those games says it has no lineup rather than rendering an empty table headed
"0.00 from starters".

The two ESPN pages cross-validate: placement reconstructed from the brackets
must equal the standings RK column, or the import throws. All 60 placements
across five seasons agree.

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

### Placeholder keeper picks

Sleeper will not let a team attach a keeper to a draft pick it ACQUIRED BY
TRADE. When that happened, the league drafted a similarly-named scrub into the
slot as a stand-in. In 2025: Devin Smith stood in for DeVonta Smith (David
Collier) and Malik Earl for Malik Nabers (Tyler Jung), both at R5.

`config/keeper-overrides.json` records the substitutions and `derive.ts` applies
them AT LOAD TIME, rewriting the pick to the real player with `is_keeper` set.
Correcting the record rather than patching the result means the resolver, draft
history, keeper history and player pages all see what actually happened with no
special cases. Placeholders are listed in `ignorePlayerIds` and disappear from
the site entirely, including their generated player pages.

Left uncorrected this is not cosmetic: both players showed 0 keeps used, so the
site claimed 2027 was their final keep year when it is really 2026.

### What the all-time columns actually measure

Career totals count EVERY game, regular season and postseason. They are summed
from `matchups`, not from standings — standings only ever describe the regular
season, so they cannot express this. A season with no matchups (an import whose
weekly scoreboards are still lost) falls back to its standings row; nothing is in
that state today, but the path exists so a partial import degrades rather than
disappears.

| Column | Scope |
| --- | --- |
| W-L, Win%, PF, PA, PF/G, PA/G | EVERY game, postseason included |
| Head-to-head (incl. its PF/PA) | EVERY meeting, postseason included |
| Championships / 2nd / 3rd / Last | final placement, so postseason by definition |
| A SEASON's standings table (PF, PA, W-L) | regular season — that is what standings are |

Win% is `(wins + ties/2) / games`, a tie as half a win. It is stored to FOUR
decimals: the UI prints one decimal place of a percentage, so a value rounded to
two could only ever render "59.0%".

Per-game rates divide by games actually played, so a 13-game 2020 compares fairly
with a 14-game 2021 and a deep playoff run is not free.

Summing a single owner's head-to-head PF across opponents will EXCEED their career
PF, and not only because of the postseason: a meeting with a co-owned team is
credited against each of its owners. That is the same intentional double count as
everywhere else — see below.

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
