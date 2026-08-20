<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# One codebase, many leagues

This repo serves SEVERAL fantasy leagues from one codebase. Every feature is
written once and benefits all of them; nothing is duplicated per league.

Currently: **den-ops** (Den Ops Super League, keepers, ESPN history 2019-23),
**masterbatters** (Masterbatters Fantasy Football, redraft, Sleeper-only, 2025-)
and **apartment-401** (redraft, ESPN-ONLY, 2021-25).

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

### League phase

`resolvePhase()` in `lib/phase.ts` derives where in the year the league is, from
Sleeper alone — nothing stored, nothing to edit each September:

| Phase | Test |
| --- | --- |
| `offseason` | no draft date |
| `scheduled` | date set, order not drawn |
| `preDraft` | order drawn |
| `drafted` | draft complete, no week scored |
| `weekPreview` | in season, nobody has points yet |
| `weekLive` | in season, some team has points |
| `weekComplete` | `last_scored_leg >= week` |

PREVIEW VS LIVE KEYS ON POINTS ON THE BOARD, not the day of the week. Thursday
kickoffs move, December has Saturday games, and a clock rule would be wrong
several weeks a season.

`scheduled` IS THE NORMAL STATE FOR WEEKS, not a brief edge case. Bylaw 1.7 draws
the order AFTER the keeper deadline (Appendix A: an early order lets teams trade
keeper picks into better non-keeper slots), so every year runs through a window
where the draft is booked and keepers are due but nobody knows the order.
`DraftPlan` therefore gates on the DATE, not the order — gating on both meant the
panel could not appear until the deadline it exists to warn about had passed, and
`mockDraftOrder` hid that by mocking date and order together. With no order
drawn the order section is hidden outright, header included — it is the expected
state for most of that window, so saying "not drawn yet" every time is noise
around the two dates that do need acting on.

### Previewing a phase

`?mockPhase=weekLive` (any name above). `?mockDraftOrder` and `?mockDraft` still
work as aliases for `preDraft` and `drafted` — they were shared around before the
general form existed.

Every mock ONLY FILLS IN WHAT IS MISSING. Ask for `weekLive` in October and it
does nothing, because the real data already says so — the flags go quiet on their
own as the season catches up, so a stale one cannot fake a state the league has
genuinely reached.

The mocks REPLAY A REAL SEASON rather than inventing one. `derive` writes the most
recent finished season to `public/mock/<slug>.json` (~14KB), and the phases read a
week out of it: `drafted` is week 1 unplayed, and the week phases default to week
6 — before it, during it, after it. `?mockWeek=12` picks another.

That matters for building layouts: they get exercised against the shape of real
data — blowouts, near-ties, a 40-point disaster, co-owned teams — instead of
numbers chosen to look reasonable. Standings are summed from the replayed results
at read time, so any week works from one file.

Fetched ONLY when a flag is on, so nobody who is not developing downloads it, and
`build-all.mjs` prunes other leagues' copies the same way it does avatars.

`<MockBadge />` sits in the nav for as long as any flag is on, because a mocked
surface renders identically to a real one.

Sticky rules: a FULL PAGE LOAD rebuilds the flags from the URL, so editing the
address bar to drop one works; storage only carries them across CLIENT navigation,
where `<Link>` hrefs are written without them.

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
- ~~**ADP beyond pick 170**~~ — SETTLED. It caps at the last round; see below.

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

## The punishment tracker

What the weekly low scorer actually OWES lives in a Google Sheet the league edits
— suggestions, votes, vetoes, which punishment each week drew, whether it has
been served. An Apps Script web app publishes it as JSON and the browser fetches
it. `/punishments/` is the full record; `/history/<season>/` carries the ledger
for its own season.

CLIENT-SIDE, NOT BAKED, unlike every other slow-moving thing here. This is the
one surface the league will WRITE to — submit a suggestion, cast a vote, log a
completion — and someone who just voted has to see their vote. A baked copy would
be up to six hours stale, the whole deploy interval. It fails soft, with the
caveat that there is no baked layer underneath, so an outage leaves the page
saying what happened rather than merely un-annotated.

THE SHEET IS NOT THE SOURCE OF TRUTH FOR WHO LOST. `weekly-lows.json` already
knows, from Sleeper, with the score attached — checked against the 2025 sheet, all
14 weeks agree including the co-owned team, which the sheet writes as "Robbie &
Thomas" and the site keys to its primary owner. So `buildLedger` PREFERS the
derived answer and falls back to the sheet only for a week Sleeper has not scored
yet, which is exactly the window a punishment gets assigned in. On a disagreement
the derived answer wins and the row carries a gold ⚠ — a mismatch is a
data-entry slip, and rendering it silently would make the site restate the
mistake with a straight face.

THE "WHO" COLUMNS ARE OWNER SLUGS. A first name is not a key: two Joshes break
it, a co-owned team is one team and two people, and a rename breaks the join. A
slug is also the URL and the value `[data-owner]` matches, so a ledger row links
to a profile and lights up for whoever is browsing, free.

ONE ENDPOINT, MANY FUNCTIONS. The Apps Script web app is a dispatcher — one
`/exec` URL for the whole sheet, `func` naming the call and `league` naming whose
data to read. `appsScriptEndpoint` in `league.json` therefore holds the BARE URL
with no query string, and each caller appends its own: the tracker asks for
`?func=getWeeklyPunishments&league=<slug>`. A second reader later is a new `func`,
not a new deployment and not a new config key. It omits the optional `season`
because the season switcher works off the whole feed — one fetch, every year,
rather than a round trip per tab.

`punishmentsSource()` builds that URL, or returns
`public/mock/<slug>.punishments.json` when the endpoint is empty — the SAME code
path and the same shape, so connecting the real sheet is a one-line config change
and no component learns which it got. Badged `SAMPLE DATA` either way, for the
reason `<MockBadge />` exists: sample data renders identically to real data, and
"the punishments are logged" is exactly what gets screenshotted and believed.

Sheet tabs are named `<league> weekly <season>` — "masterbatters weekly 2025" —
so one spreadsheet can hold several leagues and several years, and the script
discovers seasons by matching tab names rather than being told.

### The Apps Script API

WIRED AND VERIFIED against the live endpoint, not just the docs — every branch
below was called with `curl` before it was trusted.

```
GET <appsScriptEndpoint>?func=getWeeklyPunishments&league=<slug>[&season=<year>]
```

`func` and `league` are required; `season` narrows to one tab and is OMITTED by
this site, because the tracker's season switcher works off the whole feed.

| Called with | Answers |
| --- | --- |
| a league with no tabs | `ok: true`, `seasons: []` — a league that has not started is not an error |
| `season=` a tab that does not exist | `ok: false` |
| a missing or unknown `func`, or no `league` | `ok: false` |

EVERY RESPONSE IS HTTP 200, including a rejection — Apps Script cannot set a
status code. So `res.ok` proves nothing and `usePunishments` checks the body's
`ok` field. Skipping that parses the error object into an empty feed, and a
misspelt league renders as a league with no punishments.

`access-control-allow-origin: *` on both the 302 and the response it redirects
to, so a browser fetch from Pages works. The `/exec` URL 302s to
`script.googleusercontent.com`; `fetch` follows it.

A WEEK NUMBER ALONE IS NOT DATA. The sheet pre-numbers a row per week of the
year, so a finished season ships blank rows for the playoff weeks the punishment
does not cover — 2025 returns three, weeks 15-17, with every other field null.
`parseFeed` drops a row where the loser, the punishment and the date are all
empty, or the ledger would show "Not drawn yet" against weeks nobody can lose.

THE POOL IS NOT ALWAYS ONE PER WEEK. 2025 selected 17 for a 14-week regular
season, so three were never drawn. Nothing assumes `poolSize` equals the week
count; the remaining pool is computed by subtracting what was drawn.

Verified end to end against the live feed: 14 ledger rows, all 14 losers from
Sleeper with ZERO disagreements against the sheet, 10 served and 4 owed, 3 left
in the pool, 1 vetoed suggestion hidden, and every assignment resolving to a
suggestion.

`PunishmentLedger` is the ONE renderer for a ledger row, shared by both surfaces
— same rule as lineups living only on `/matchups/[id]`.

ONE LINE PER ROW, five columns: week, loser, punishment, score, done. Fourteen
rows is a table, and a table spending two lines a row reads as a feed of events
rather than a season at a glance. The punishment text runs to a full sentence, so
its cell truncates with a native `title`; the SCORE column is `hidden` below `sm`,
because who owes what survives losing it and the punishment text does not. No 🚽
on a row — every row is a weekly low by construction, so marking each one says
nothing and costs width.

Both this and the ballot name their column widths in a `COL`/`BALLOT` object,
because these lists are flex rows rather than `<table>`s and a `ListHeader` cell
has to repeat the width class of the row cell beneath it. One definition each, or
the header drifts off its column the first time one is tweaked.

A CO-OWNED TEAM IS NAMED IN FULL, on the ledger and on the tally — "Robbie &
Thomas", not the primary owner the low happens to be keyed to. `weekly-lows.json`
records a low against the PRIMARY owner because a team has one franchise key, so
rendering that slug straight blames half a team for a week both of them lost.
`getPunishmentTeams()` resolves it, keyed `${season}:${primarySlug}` because
co-ownership changes year to year, and mirroring `creditedNames` — full name when
someone plays alone, first names when the team is shared, since two full names do
not fit the cell. Each name is its own link with its own `data-owner`: the team is
one thing but the people are two, and identity highlighting has to pick one out.

WHICH SEASON LIVES IN THE QUERY STRING, via `useUrlState` — not `useState`, and
not `useSearchParams` (which would need a Suspense boundary under `output:
export`). A season page's "Full tracker" link is `/punishments/?season=2025` and
has to land on 2025 rather than whatever is newest, which only works if the
selection is addressable. The newest season is the fallback, so it clears the
param and an untouched page has a clean URL.

PUNISHMENT IDS ARE INVISIBLE. They are the sheet's join key and mean nothing to a
reader. The one place an id survives is the tooltip on an assignment pointing at a
suggestion that does not exist — the row says "Unknown punishment" and the number
is there for whoever has to go and fix the sheet.

A VETOED SUGGESTION IS NOT SHOWN AT ALL, not even struck through. It was removed
from contention, so listing it invites a reader to weigh something that cannot be
drawn, and pins a rejected idea to a permanent public page. Filtered once where
the feed is read, so no panel below has to remember. The LEDGER is unaffected: it
renders what was actually assigned.

### Three phases, and why this one is STORED

A season is `suggesting`, then `voting`, then `live`, and each is a different
page: the ballot is the whole thing until the pool is set, and the ledger takes
over afterwards.

THE PHASE IS A CELL IN THE SHEET — the one place this parts company with
`resolvePhase()` in lib/phase, which derives the league's phase from Sleeper and
stores nothing. That works there because Sleeper publishes facts that IMPLY the
phase. Here one transition has no such fact: the moment voting opens every count
is still zero, and nothing distinguishes it from suggestions still being open.
Closing suggestions is a decision somebody makes, not an event anything records.

ONE CLAMP, IN ONE DIRECTION: a season with a week lost and a punishment assigned
is `live` whatever the cell says. The phase column arrived with 2025 reading
"suggesting", which taken literally hides a finished season's fourteen weeks
behind a suggestion form. Nothing infers voting from suggesting, or live from
votes alone — those are judgement calls the sheet is entitled to make. A served
punishment is not one.

`derivePhase()` is a FALLBACK for a blank or misspelt cell, never the rule, and
`selected` alone does not mean live — the Selected table fills itself from the top
of the ballot, so 2026 spent its first day holding one unvoted idea that was
already "selected". A pool is only really set once somebody voted it in or a week
has been lost, so that is what it asks for.

| Phase | Page | Ballot columns | Ballot order |
| --- | --- | --- | --- |
| `suggesting` | callout + ballot | punishment, by | newest first |
| `voting` | callout + ballot | + votes | most votes first |
| `live` | stat tiles, ledger, pool, tally, ballot collapsed | + status | most votes first |

NO STAT TILES BEFORE THE SEASON STARTS. A suggestion count and a running vote
total are both already legible from the ballot underneath, one row per
suggestion, and a row of tiles restating them pushes the one thing there is to do
below the fold. The live phase keeps its four, because they summarise fourteen
rows rather than nine.

`PhaseCallout` is a full-width accent banner above the ballot — a headline and a
button, no body copy. It started as a chip beside the title and read as one more
badge; it is the point of the page while the pool is being decided. The button is
a real disabled `<button>` and is here before it works, because its absence is
the layout question: where the call to action sits changes how the page reads,
and wiring the modal in later should not move anything.

`poolSize` IS NULLABLE, and null is rendered rather than guessed around. The only
thing available to guess from is the size of the Selected table, and that fills
itself from the top of the ballot — so before voting closes it counts ideas
rather than stating a target, and 2026 opened with one suggestion and duly
claimed a pool size of one. The client only falls back to counting selected rows
once the phase is `live`. The Apps Script does the same count on its own side,
which the site cannot see through, so a blank pool-size cell still arrives as a
wrong number: fill the cell.

A COLUMN THAT CANNOT MEAN ANYTHING YET IS WORSE THAN AN ABSENT ONE. A votes
column of zeros reads as "nobody likes these"; an empty status column reads as
"nothing made the pool". Newest-first while suggestions are open so a submission
lands where the person who just made it is looking.

THE PHASE DECIDES THE PAGE, not the row count. Everything but the ballot would
otherwise be a panel explaining that it is empty.

Both action buttons are DISABLED until the write endpoints exist, with a tooltip
saying so. They are here rather than added later because their absence is the
layout question — where a call to action sits changes how the page reads — and a
page that quietly offers no way to take part is worse than one that says why.

`?phase=voting` forces a layout, badged, for looking at a phase the league is not
in. It changes the LAYOUT ONLY; the numbers underneath stay whatever the sheet
says. Same argument as `?mockPhase=`, and badged for the same reason.

### Loading is chrome plus skeletons, never a spinner

The feed arrives from a third party over the network, so both surfaces spend a
moment without it. Neither shows a message: the page frame, the title, the season
switcher and the panel headers are all real from the first paint, and only the
cells that genuinely depend on the sheet shimmer.

HALF THE LEDGER IS ALREADY KNOWN. The week, who lost it and by how much come out
of the build — only the punishment and whether it has been served are pending —
so `PunishmentLedger` takes a `loading` flag and draws the real columns beside
shimmering ones. Same renderer, so the rows cannot land in different places once
the feed arrives.

THE SKELETON'S SHAPE IS INFERRED FROM DERIVED DATA, not guessed: a season with
weeks on the board is live and gets the ledger layout, one with none has not been
played and gets the callout-and-ballot layout. That is the same rule as the phase
clamp, so the panels are already where the feed will want them.

`getPunishmentLows()` therefore SEEDS EVERY SEASON IN `knownLeagueIds` with an
empty `lows` array. Built from weekly lows alone it omits the season being
played, and the page would open on last year, draw a full ledger skeleton and
then rearrange into this year's ballot — the exact jump a skeleton exists to
prevent.

`.skeleton` in globals.css is a SWEEP, not a pulse: a block fading in and out
reads as disabled, a highlight travelling across reads as work in progress.
(`.live-dot` is the other one, and a different job.) The sweep is an `::after`
transform so it animates on the compositor rather than repainting twenty rows a
frame, and it is hidden outright under `prefers-reduced-motion` — the blanket
rule there clamps animations to nothing, which would freeze it mid-sweep as a
bright stripe.

The season page's panel reserves its space the same way, because it sits in the
middle of a long page and appearing late shoved the brackets down under the
reader. One case still moves: a season with weeks lost that the sheet has no
record of gets drawn and then withdrawn. That is every season before the league
started tracking, which for the only league that does is none.

### The punishment text wraps on a phone

One line per row on a desktop — fourteen rows is a table, and two lines a row
reads as a feed of events rather than a season at a glance. Below `sm` the
punishment cell WRAPS instead of truncating, on the ledger and the ballot alike:
the text is a full sentence and there is no width to spare, so one line showed
"Take a selfie with the bar…" and the row named a punishment nobody could read.
Wrapping costs height, which a phone has, rather than meaning, which it does not.

Columns then align to the TOP (`items-start sm:items-center`), because centring
them against a three-line cell floats the week number into the middle of nowhere.

Ledger rows come from the UNION of weeks either source knows, never `1..14`. An
unplayed season would otherwise render fourteen blanks and a season in progress
would advertise weeks nobody has lost yet.

Everything is gated on `features.weeklyLowPunishment`, including the nav link. The
route is still generated in every league's build — static export makes them all —
and says the league does not play this game, matching `/keepers` in a redraft
league.

### Writing back

`addSuggestion` is the first write, POSTed to the same `/exec` URL with `func` in
the body. Voting and the spin-the-wheel draw are still to come; `PhaseCallout`
takes `onAct = null` for a phase whose endpoint does not exist yet and disables
its button rather than opening a modal that cannot save.

`Content-Type: text/plain;charset=utf-8` IS LOAD-BEARING, and the JSON goes in the
body under it. Apps Script cannot answer a CORS preflight, so only a "simple
request" ever reaches it — send the obvious `application/json` and the browser
fires an OPTIONS, gets nothing usable, and the POST never happens. Only the header
is a lie.

THE SERVER SAYS NO, not the form. Duplicate text, the wrong phase, an over-long
entry — the sheet rejects all of it with a message written to be read, and the
modal shows that message verbatim. Re-implementing the rules client-side would
mean two sets to keep in step, and the client's set can be skipped anyway. The
phase check especially belongs there: hiding the button is not the same as
refusing the write, and a suggestion added mid-voting changes the ballot under
people who already voted.

THE ID COMES BACK FROM THE SERVER. Two people submitting at once must not compute
the same next row; the script takes a lock and assigns it.

The response echoes the created row in the feed's own shape, and it is merged
into the loaded feed rather than triggering a refetch — everything needed is
already in hand, and a second Apps Script round trip is another second of
spinner. `parseSuggestion` is shared by both paths so a just-added row and the
same row on the next load are indistinguishable. One exception, invisible today:
the sheet's Selected table auto-fills, so a row comes back `selected: false` and
reads `selected: true` on the next fetch. Nothing renders `selected` before the
live phase, and it self-corrects on reload.

WHO IT IS FROM COMES FROM `useIdentity()`, the slug already in localStorage from
the first visit — nobody types their own name into a league of thirteen people
who know each other. The line under the field names who it will be credited to,
so the auto-fill is visible rather than a surprise, and a checkbox opts out.
Someone who never picked a team posts anonymously and is told so, rather than
being sent to the identity picker first: an unanswered prompt from months ago
should not stand between a person and a one-line idea. The checkbox then has
nothing to opt out of and is not rendered.

NO SHARED SECRET, by decision. The endpoint URL is public by construction — a
static site ships it in its JavaScript — so a token would be a speed bump against
bots rather than security, and the league chose not to bother for now.

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

## A matchup can span more than one week

ONE GAME, SEVERAL WEEKS, and the two facts are needed in different places.

| Surface | Sees |
| --- | --- |
| head-to-head series, W-L, standings, the matchup's own page | ONE matchup, combined score, one winner |
| the matchup page's lineups | one pair per week, each with its own marks |

### Which records a multi-week matchup can win

TWO QUESTIONS, ASKED IN ORDER, and every list answers both the same way in every
league.

**1. Is the stat about a WEEK or about a GAME?** A week inside a multi-week
matchup is a real score but not a real result — nobody won or lost it on its own.

| Stat | Level |
| --- | --- |
| highest / lowest score, best player week | WEEK |
| highest / lowest scoring matchup, blowout, narrowest win | GAME |

So one week of a two-week matchup never appears in a GAME list, and a two-week
total is never a week's score.

**2. For a multi-week FINAL, does the extra week inflate the number or make the
feat harder?** Inflated means ineligible; harder means eligible. Every list falls
out of that one question:

| List | 1-week | Week inside a multi | Multi-week final |
| --- | --- | --- | --- |
| highest scores | ✓ | ✓ | ✗ |
| lowest scores | ✓ | ✓ | **✓** |
| highest scoring matchups | ✓ | ✗ | ✗ |
| lowest scoring matchups | ✓ | ✗ | **✓** |
| biggest blowouts | ✓ | ✗ | ✗ |
| narrowest wins | ✓ | ✗ | **✓** |
| best player weeks | ✓ | ✓ | n/a |

EVERY LOW OR NARROW LIST TAKES A MULTI-WEEK FINAL; NO HIGH OR BIG ONE DOES. Two
weeks of scoring makes a big number cheap and a small number expensive.

`recordsAtTheTime` answers the same two questions. It takes WHOLE matchups and
emits one WEEK event per week plus, for a multi-week matchup only, one GAME event
landing in the week it finished — `Event.forWeek` / `forGame` / `multiWeek` carry
the answers. An ordinary matchup is a single event that is both, so nothing is
counted twice. Handing it pre-flattened matchups silently disables all of it:
`weeklyViews` strips `weeks`, every event then looks single-week, and a two-week
margin both wins the narrow badge and poisons the blowout baseline for years.

MATCHUP LINKS MUST BE RESOLVED, NOT CONSTRUCTED. A multi-week matchup has ONE page,
keyed by its FIRST week, so a record set in week 17 of a two-week final belongs to
the week-16 page. `matchupPageId()` does the lookup; building the id from the
record's own week produced four dead links on the record book.

`Matchup.weeks` carries the per-week split and is ABSENT on an ordinary matchup,
so nothing changes for the 99% case. `weeklyViews()` flattens a matchup into one
entry per week; `buildLeagueRecords` takes WHOLE matchups and splits them itself,
because scores and margins want different views of the same game. Margins are
collected from whole games only and never from a week inside one, and `blowouts`
is the narrower list the blowout ranking draws from.

`recordsAtTheTime` carries the same rule through an `Event.margins` flag. One gap
there: a multi-week matchup cannot earn a narrow mark AT THE TIME, because that
pass walks weeks in order and the combined game is not one of them. The record
book itself is correct; only the "set a record when played" badge is affected, and
those are #1-only and rare.

WHY THE SPLIT MATTERS: left whole, a two-week total out-ranks every genuine
single-week score ever posted — the highest score in league history would be a
game that took a fortnight. Apartment 401's 2021 final was 327.34 to 218.82 across
two weeks; the record book correctly sees 151.30/139.04 and 176.04/79.78.

Record MARKS are per week for the same reason, and the matchup page renders them
beside the week they belong to rather than beside the combined scoreline.

The lineup importer selects the game COVERING a scoring period, not the one whose
`matchupPeriodId` equals it — period 15 belongs to matchup period 14, while
matchup period 15 is the next round with no roster filled in. Matching on the id
returned zeroes for every team, which its reconciliation caught.

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

### Every dialog is one `Sheet`

`components/sheet.tsx` owns the backdrop, the panel, the escape key, the scroll
lock, the backdrop click, the `stopPropagation` that stops selecting text from
dismissing, and the open/close animation. The trade modal, the suggestion modal
and the identity picker all render through it. Three copies of four behaviours
was three chances for one to be missing, and the identity picker was already
missing the scroll lock.

A SHEET SLIDES UP FROM THE BOTTOM ON A PHONE, and a centred dialog does not.
Below `sm` the panel is flush to the bottom edge, so travelling up from it is
where it appears to come from; centred on a desktop there is no edge to come
from and a full-height slide reads as a flick, so it fades and settles.

THE EXIT IS WHY IT IS A COMPONENT AND NOT A CSS CLASS. A dialog unmounts the
moment it closes, so there is nothing left to transition. `Sheet` keeps it on
screen for one animation and uses `animationend` to know when to let go — with a
450ms backstop, because `animationend` never arrives in a throttled background
tab and a dialog stuck open because a decoration failed is far worse than one
that closes without sliding.

EVERYTHING THAT DISMISSES GOES THROUGH `close()`, which is why children get it
from a render prop. `close(after)` runs `after` INSTEAD of `onClose`, which is
how an action that also dismisses animates out before it takes effect — picking
an owner, or a suggestion that submitted successfully. Calling `onClose`
directly unmounts mid-slide.

A NULL `onClose` MEANS THE DIALOG MUST BE ANSWERED — no escape, no backdrop
click. The first-visit identity prompt is the only one. `close(after)` still
works there, because choosing is how you answer it.

Reduced motion needs no special case: the blanket rule in globals.css clamps
every duration to almost nothing, so both animations finish instantly and
`animationend` still fires.

### A text field under 16px zooms iOS

Safari zooms the whole page when an `input`, `textarea` or `select` is focused and
computes to LESS THAN 16px, so the field is readable. It scales everything, so a
dialog that fits perfectly is suddenly wider than the screen with its close button
off the right edge — which looks like a broken layout and is not one. The
suggestion modal hit this the hard way: it focuses its textarea on open, so at
`text-sm` the zoom fired before anyone had typed.

USE `text-base sm:text-sm` ON ANY TEXT-ENTRY FIELD. The other common fix is
`maximum-scale=1` on the viewport meta, which works by disabling pinch-zoom for
the entire site — do not. Checkboxes and radios are exempt; only fields you type
into trigger it.

The same modal is capped in `dvh` rather than `vh`, because `vh` on a phone is the
viewport WITHOUT browser chrome — a sheet capped in `vh` is taller than the space
it has and its last control hides under the address bar. Its bottom padding is
`max(1rem, env(safe-area-inset-bottom))`, since a bottom sheet runs to the edge
where the home indicator sits.

Separately, a CSS GRID ITEM defaults to `min-width: auto`, so a row wider than its
track overflows the card rather than letting its truncating cell shrink. The home
keeper board needed `min-w-0` on each owner card for exactly this reason — the
cost column was being clipped while the player name refused to truncate.

THIS HAS NOW BITTEN TWICE, both times on a keeper row, so check it whenever a row
of columns goes inside a `grid`. The owner profile's contracts had the identical
symptom: names rendering full-length, the cost column clipped off the right edge,
and no scrollbar because `Panel` is `overflow-hidden`.

The reason the /keepers page never hit it is worth knowing — its grid items are
`Panel`s, and a grid item whose computed `overflow` is anything other than
`visible` gets an automatic minimum size of ZERO. So `overflow-hidden` on the item
fixes it for free, and a bare `<div>` wrapper does not.

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

PLAYER-WEEK MARKS ARE STARTERS ONLY. A big week on the bench scored the team
nothing, so ranking it would make the list measure roster luck rather than
results. `buildLeagueRecords` skips non-starters, and the matchup page's inline
chip re-checks it — a chip on a bench row would assert a record the book does not
contain, inside a collapsed section where nobody would catch it.

PLAYER-WEEK MARKS ARE NOW EXACT TOO. They were Sleeper-only until ESPN's read API
turned out to serve full box scores; `import:espn:lineups` recovered 2019-23, so
the baseline starts in 2019 like every other list and the caveat that used to sit
on the matchup page has been deleted rather than reworded.

## Automation

Three workflows, all free — Actions minutes are unlimited on public repos, and
this repo is public. If it ever goes private, thin the game-window crons: the
current config is ~500 builds/month and would eat most of the 2,000-minute
free tier.

| Workflow | Cadence | Does |
| --- | --- | --- |
| `deploy.yml` | push + every 15 min in NFL game windows, else 6-hourly | build & publish; bakes in-progress Sleeper data |
| `archive.yml` | daily, 08:00 UTC | `sync` + `derive` + `import:player-teams`, commits only if something newly finalized |
| `keepalive.yml` | 3rd of each month | commits a timestamp so cron workflows are never auto-disabled |

`archive.yml` is DAILY BECAUSE IT IS IDEMPOTENT — a run with nothing newly
finalized produces no commit, so most days it only proves there was nothing to
do. Weekly meant a week scored on Tuesday morning could sit unarchived for seven
days. 08:00 UTC is midnight PST and 01:00 PDT; GitHub cron has no timezone field,
and 07:00 UTC would be exact in summer but 23:00 the previous day in winter.

`archive.yml` also runs `npm run adp -- --auto`, so ADP refreshes daily and
freezes itself on schedule — see the ADP section. That step is
`continue-on-error`: beatadp is a third party, and it being down must not stop
finalized league data being archived. It also means the job commits most days
rather than rarely, since the market moves daily.

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

  TRANSACTIONS RUN AHEAD OF SCORING, and are the one exception. A completed trade
  or waiver is final the moment it processes — it does not wait on anyone playing
  a game — so they are fetched through the week the league is ON (`settings.leg`),
  while matchups stop at the week Sleeper has SCORED. Gating both on scoring meant
  every preseason trade sat invisible until week 1 finalised in mid-September,
  straight through the keeper deadline and the draft.

  An in-progress season's week files are re-fetched every run rather than trusted,
  because a week first written in the preseason gains real transactions once it is
  played. `writeIfChanged` keeps that diff-free. A COMPLETE season stays
  write-once.

  Two small companions are committed for an in-progress season, and nothing else:
  `roster-owners.json` (roster -> owner, so a mid-season trade names someone) and
  `draft-meta.json` (just the draft date, which is what separates a preseason
  trade from a week-1 one). Both are stable projections — a full `rosters.json`
  would bake in players, points and records, all of which move weekly.

  `derive` reads them through `loadLiveTradeSources()`, because `loadSeason`
  needs `league.json` and sync withholds that until a season is complete.
- **`npm run derive`** is pure — no network, never touches `data/raw/`. Delete
  `data/derived/` and re-run to rebuild from scratch.

Rules are versioned per season so changing 2027's keeper rules cannot
retroactively rewrite 2024's contracts.

A season with NO file of its own INHERITS the most recent earlier one. Most years
nothing changes, and requiring a hand-written file for every season made a new
year a manual chore that BREAKS THE BUILD when forgotten — a bad failure for
something that runs on a schedule while nobody is watching. Changing next year's
rules is still just writing `rules/<year>.json`; that file always wins.

Inheritance is forward-only, so history stays immutable, and derive still throws
for a season older than every rules file — that is a real gap, not a new year.

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

THE CYCLE ADVANCES THE MOMENT THE DRAFT FINISHES, not when the season does.
`resolveKeepers` takes the draft-only seasons alongside the finished ones, so a
completed draft rolls every contract onto the next year: drafted players get a
fresh cost, kept players burn a keep, and one that exhausts its keeps expires and
is revalued to ADP. Waiting for the season to finalize would leave last year's
costs on screen for four months, exactly while people are using them to plan.

THE DRAFT IS THE ROSTER SNAPSHOT for that pass. A keeper league drafts a full
squad, so anyone neither drafted nor kept is in the free-agent pool — the same job
the final-roster reconciliation does for a finished season. Post-draft waiver moves
land on top in the browser via `lib/keeper-live.ts`, which is unaffected: a draft
is not a transaction, so there is nothing for it to double-apply.

Verified with a fixture 2026 draft: the 2024 and 2025 cycles came out
byte-identical, a 2026 cycle appeared, 36 contracts expired on their second keep,
and the 184 rostered players fell to the 168 actually drafted.

### The contract cycle is THREE seasons, not two

Bylaw 1.7.2.2.1: a contract runs for the offseason a player is ACQUIRED in
(drafted, picked up, or revalued) plus 2 keeps at that same round. Acquisition
does not consume a keep. When both keeps are spent the contract is REVALUED to
that offseason's ADP round and the 2 keeps are restored — and the revaluation
year is itself an acquisition year, so keeping him in it costs the new round and
consumes no keep. The cycle repeats forever.

So Smith-Njigba, drafted R11 in 2024 and kept in 2025 and 2026, is revalued for
2027 and is then keepable at that new round in 2027, 2028 and 2029.

`revalueExhausted()` in `scripts/derive.ts` does this, off the FROZEN
`adp/<season>.json` and never `live.json` — a revaluation permanently rewrites a
contract, so the live market would rewrite committed history daily. A season with
no frozen file cannot be revalued deterministically; those keep `expired: true`
and `costRound()` projects from live ADP, which is right for the window between a
draft and the next deadline.

NOTHING IN THE COMMITTED DATA EXERCISES IT — keepers began in 2024, so the first
revaluation is 2027 and re-deriving today is byte-identical. A synthetic test
covers the whole cycle.

THE ROUND-1 COLLISION IS REAL AND GETS WORSE. Per 1.7.2.1.1-2 a second keeper of
the same round value moves to an earlier pick, and if none exists "the keeper
selection may not be made" — so two keepers both pricing in round 1 is impossible,
and revalued studs cluster there.

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

### Recovering ESPN-era lineups

`npm run import:espn:lineups` fills the one gap the MHTML archives could not:
lineups. ESPN's read API serves the whole box score and needs no auth for these
leagues, so the caveat that player records were "Sleeper-era only" is gone rather
than reworded. The page fantasy.espn.com serves is a React shell with nothing in
its HTML; the endpoint it calls is what this uses.

```
lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<year>/segments/0/leagues/<id>
  ?view=mBoxscore&view=mRoster&view=mTeam&scoringPeriodId=<week>
```

`espnLeagueIds` in `league.json` is keyed BY SEASON: ESPN mints a new league each
year exactly as Sleeper does, and Den Ops' 2019 id is unrelated to 2020-23's.

IDS ARE NORMALISED TO SLEEPER'S, in three tiers, and the order matters:

| Tier | How | 2019 | 2023 |
| --- | --- | --- | --- |
| `espn_id` | Sleeper publishes ESPN's id for ~6,700 players | 2787 | 1881 |
| defence | pro-team id -> abbreviation; a D/ST is a team, not a person | 278 | 280 |
| name, then surname+position | last resort | 0 | 1202 |

Coverage of `espn_id` thins for players who arrived after about 2020, so the
NEWER the season the more it falls through to names — which is the opposite of
what you would guess. Names alone are not enough either: people are not stored
under the name they played under. Nyheim Hines is "Nyheim Miller-Hines", Will
Fuller V is "William Fuller", Kenneth Gainwell is "Kenny".

THE SURNAME TIER IS DELIBERATELY NARROW — unique candidate, matching position,
matching first initial. A wrong match there is invisible: the points still sum to
the right team score and are merely credited to the wrong player.

Two reports print for exactly that reason, and they are the only output a human
has to read:

- **renamed** — the two databases spell the player differently. Two lines across
  five seasons, both Gainwell, plus Chig Okonkwo in 2023.
- **same name, several candidates** — the dangerous one, because the names agree
  so nothing looks wrong. NONE in five seasons: DeVonta Smith and Michael Carter
  each collide with a defensive back and both resolve on position.

THE INVARIANT IS ENFORCED IN THE IMPORTER AND THROWS. Started points must equal
the score the team posted on the already-reconciled scoreboard. It guards the
failure this import is most exposed to: `matchupPeriodId` and `scoringPeriodId`
are not the same number in every postseason format, and hanging week 15's roster
on week 14's game would look entirely plausible. 986 of 990 ESPN team-weeks
reconcile to the cent; the four that cannot are first-round byes, which have a
roster but no game — and the bye week MOVES (14 in 2019-20, 15 from 2021).

`manual/lineups/<season>.json` is merged into, not rewritten, so `espnOnly` is
pruned to ids a lineup still references on every run — otherwise a player the
importer later resolved properly lingers as a phantom and sync publishes a page
for someone who does not exist. Re-running is byte-identical.

### An ESPN-only league

apartment-401 has never been on Sleeper. That needed NO code change to sync or
derive: `discoverSeasons` finds nothing, sync writes an empty `raw/seasons.json`,
and derive builds the whole league from `manual/`. Its config carries
`anchorUserId: ""` and `knownLeagueIds: {}`.

ONE ESPN LEAGUE ID FOR EVERY YEAR, unlike Den Ops. ESPN kept the league in place
rather than minting a new one each season, so `espnLeagueIds` repeats 86258199.

THE HISTORY IS PRIVATE. ESPN's visibility is per SEASON: 2026 is public and
2021-25 return 401. `espnAuth()` reads `espn_s2` and `SWID` from a gitignored
`.espn-auth.json` and sends them on every ESPN request; a public league never
notices. Do NOT commit that file — `espn_s2` is a session token for the whole
ESPN account, not one league.

OWNERS RESOLVE BY ESPN MEMBER ID FIRST, then by name (`ownersByTeam`). Two people
here hold two accounts each and map to one slug apiece, so neither is
double-counted; one of those accounts has no real name for the name tier to match.

### Recovering a season from the read API

`npm run import:espn:seasons` rebuilds standings, results and the bracket from
`mTeam` + `mMatchupScore` + `mSettings` — the same things `import:espn` gets from
saved MHTML, without the ninety manual saves.

VALIDATED AGAINST THE MHTML IMPORT, not trusted. `--check` rebuilds a league and
diffs rather than writing. All five Den Ops seasons reconcile: every one of 493
games matches on week, owners and score, and standings match on record, points
for and points against. What differs is only `gameId`/`routing` — printed on
ESPN's consolation ladder page and absent from the API — plus matchup ORDER
within a week, and the `source` string.

A MATCHUP PERIOD IS NOT ALWAYS A WEEK. `playoffMatchupPeriodLength` can be 2, and
was for apartment-401 in 2021-22: matchup period 14 covers scoring periods 14 AND
15, and its scoreboard total is their SUM. `scheduleSettings.matchupPeriods` is
the authority; taking `matchupPeriodId` as the week puts the final two weeks early
and hands a two-week score to a one-week lineup. Sleeper can do this too,
including for the championship only, so this is not an ESPN quirk.

### Recovering ESPN-era drafts

`npm run import:espn:drafts` fills the last gap. `/history/<season>/draft/` now
exists for every season the league has played, with no change to the page that
draws it — the importer writes `DraftPickRecord` directly, so nothing downstream
can tell an ESPN draft from a Sleeper one.

Three things ESPN models differently, all translated at import time:

- **The slot is computed, not given.** ESPN records `roundPickNumber` — which pick
  of the round — not which board column it came from, and in a snake those differ
  in every even round. Verified by the numbers falling out right: 2019 round 1
  runs slots 1..12 and round 2 runs 12..1.
- **`pickOrder` is `slot_to_roster_id`.** Slot -> ESPN team id, which is what makes
  a traded pick visible: the team that used the pick is not the team the slot
  belongs to.
- **A pick carries a bare `playerId` and no name.** So the season's player
  universe is fetched too — `/seasons/<year>/players?view=players_wl`, whose page
  size defaults to 50 and needs `x-fantasy-filter` to lift. Without it the name
  tiers are blind and any player Sleeper has no `espn_id` for is unresolvable.

NO PICK WAS EVER TRADED IN THE ESPN ERA — zero across all five seasons, all 960
picks. That is a real finding rather than a modelling artefact: pick trading was
ENABLED in 2020 and 2023, and a wrong snake model would have shown roughly half of
every even round as traded rather than none.

Two invariants throw: the pick count must equal rounds x teams, and a missing
`pickOrder` is fatal rather than assumed, since without it a traded pick is
indistinguishable from a normal one.

Keeper flags are all false, correctly — ESPN's `keeperCount` was 0 every year, and
keepers began with the 2024 startup draft on Sleeper.

### Bye weeks, and the one ESPN dependency that outlives the import

A bye must not count as a zero: the player's NFL team was idle, so it says nothing
about him or about the owner who started him, and counting it docks a per-game
average for the schedule. `getPlayerUsage()` drops those weeks.

SLEEPER DOES NOT PUBLISH BYE WEEKS. Its player record has no such field — checked,
not assumed. So `import:player-teams` fetches them from ESPN, one unauthenticated
call per season, and this remains the only part of the FORWARD pipeline that needs
ESPN at all. It runs inside `npm run data` and in `archive.yml`; if it stops
running, a new season simply has no byes and every one counts as a zero again,
with nothing on a page to say so. That is why the importer warns loudly rather
than quietly writing nothing.

A ZERO IS ALSO REQUIRED before a week is dropped. Team is recorded per SEASON, and
a player traded mid-season carries the wrong team — and therefore the wrong bye.
Hockenson went DET to MIN in 2022, and matching on the bye week alone discarded
his real week 7 for Detroit as Minnesota's bye, deleting 8.8 points he scored. A
bye always scores zero, so a non-zero week proves it was not one.

From 2026 `sync` records the exact team as each week finalizes and the bye lookup
prefers it, so a midseason trade resolves to the right bye. Sync also SEEDS a new
season's baseline the first time it sees one — without that every player counts as
a difference and the weekly bucket takes three hundred entries a week.

### Recovering ESPN-era transactions

`npm run import:espn:transactions`. FOUND ON THE PLAYER CARD, not a league view —
`view=mTransactions2` returns an empty list for these closed leagues, which is why
this looked unrecoverable at first and was documented as such. The log hangs off
`kona_playercard`: ask for the players and each carries the transactions it was
part of; deduping by transaction id reassembles the league's whole log. A bare
`limit` is rejected ("Limit request must be accompanied by a sort"), so the sort
in the filter is load-bearing.

1,115 transactions across 2019-23 — adds, drops, waivers and 7 trades.

`status === "EXECUTED"` IS THE ONLY TRUTH TEST. `isPending` is NOT: two 2021
trades carry `isPending: true` and every player in them demonstrably changed
hands, checked against the imported lineups for the weeks either side. Treating
that flag as a veto would have silently deleted two real trades.

ESPN's `ROSTER` type is a standalone DROP (`toTeamId: 0`), not a lineup move, so
it is kept. `DRAFT` transactions are skipped — `import:espn:drafts` already has
them in a shape that knows about draft slots.

### Trades are first-class

`derived/trades.json` is ONE RECORD PER TRADE, from both providers.
`player-history.json` still emits an event per player, which is right for a player
page and useless for a trade: a three-for-two renders as five unrelated lines, and
a trade of nothing but picks produces no events at all and vanishes entirely — two
of Den Ops' seventeen Sleeper trades are picks-only.

MODELLED AS LEGS, not as two sides. Den Ops has a THREE-team trade (2025 week 1,
one player and six picks) where David sends picks to two different owners while
receiving a player from a third. No "A gave X for Y" shape can state that without
lying about who gave what to whom. A leg is a player, a pick, or FAAB.

A pick leg records whose pick it ORIGINALLY is, not who sent it — a pick can be
traded more than once, and the league calls it "Reagan's 2026 4th" however many
hands it passes through. Sleeper's `roster_id` on a `draft_picks` entry is that
original owner; `previous_owner_id` and `owner_id` are the sender and receiver.

ONLY COMPLETED TRADES REACH IT. Sleeper marks a vetoed or withdrawn trade `failed`
and ESPN anything other than `EXECUTED`; both are dropped, so a deal the league
threw out never appears.

Surfaced at `/trades` (grouped by season, with totals), on an owner page (their
last eight), and on a player page (every deal he was in, whole — the transaction
list above it can say he was traded and to whom, but not what came back).

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

ROSTERS AND DRAFTS ARE NO LONGER ABSENT — see the two importers below. Only
TRANSACTIONS still are: ESPN returns an empty log for these closed leagues, with
or without a filter header, so player pages show no add/drop/trade history before
2024. Keeper contracts are unaffected, since keepers began in 2024 anyway.

The two ESPN pages cross-validate: placement reconstructed from the brackets
must equal the standings RK column, or the import throws. All 60 placements
across five seasons agree.

### ESPN brackets have three sections and a different consolation format

Sleeper has two postseason sections; ESPN has THREE — championship bracket,
winner's consolation ladder (3rd-6th), and the main ladder (7th-12th). Merging
the last two loses both the structure and the placements.

ESPN's consolation is a LADDER, not Sleeper's anti-tournament: winning moves you
UP a rung, and the loser of the bottom rung in the final week finishes last. So
`inverted` is false for imported brackets. Do not unify the two formats.

A LADDER IS NOT A TREE, AND IS NOT RENDERED AS ONE. Both teams continue — the
winner climbs a rung, the loser drops one — so there are no feeders and no byes.
`section()` returns early for a ladder rather than inferring winner-feeders, and
`Bracket` takes a `ladder` prop that switches it to a plain grid: one column per
round, games stacked in rung order, no connectors.

Getting this wrong is not subtle. The tree layout has no parent to centre a
round-2 game against, so the games scatter down the column, and the bye inference
conjures a phantom bye for every team that DROPPED a rung — which is half of them.

PLACEMENTS COME FROM THE STANDINGS, not from arithmetic. The old `7 + 2 * i`
assumed twelve teams and a six-team playoff; apartment-401 plays four, so its
ladder covers 5th-10th and the old rule printed "11th place" in a ten-team league.
`labelFinalRung()` looks each team's real `finalPlace` up instead. Den Ops is
unchanged by that — twelve teams and six playoff spots is what the constant
encoded — which is the check that the new rule agrees where the old one was right.

A RUNG CAN SPAN TWO WEEKS. `BracketMatch.weekEnd` carries the end of the span so
the header reads "Weeks 14-15" rather than naming only the first, which is what
ESPN's own "ROUND 1 | NFL WEEK 14-NFL WEEK 15" says.

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
| `data/adp/live.json` | `npm run adp`, daily in `archive.yml` | display only |
| `data/adp/<season>.json` | `adp:lock`, or `adp --auto` when the window opens | the market keeper costs were decided against |

`adp:lock` refuses to overwrite without `--force`, because bylaws 1.7.2.2.1 fixes
ADP a week before the keeper deadline and a silent re-capture would move keeper
costs after the fact.

### Live except inside the lock window

The site shows the CURRENT market, until the bylaws say it must stop moving. That
window opens ten days before the draft — the keeper deadline is three days out
(bylaw 1.7) and ADP fixes a week before that — and closes when the draft is
archived, at which point the board is already pricing the NEXT cycle and wants a
live market again.

`getAdp()` implements all of that WITHOUT COMPARING A SINGLE DATE:

```ts
const season = keeperCycleSeason();
const frozen = load(`adp/${season}.json`, null);
const snapshot = frozen ?? load("adp/live.json", null);
```

The frozen file does not exist before the lock, and `keeperCycleSeason()` steps
forward the moment the draft is archived, so the same two lines give live → frozen
→ live with nothing to schedule and nothing to expire. Verified in all three
states.

`keeperCycleSeason()` is `max(finished seasons, ARCHIVED DRAFT SEASONS) + 1`, and
it is what every label describing CONTRACTS uses — the home keeper board's title
and the keepers page heading. THE DRAFT SEASON IS A DIFFERENT NUMBER and they
diverge for five months a year: from the day the 2026 draft is archived, the
contracts are priced for 2027 while the 2026 draft is still the one that just
happened, the live league id is still 2026's, and the projected board (which hides
itself once `status === "complete"`) is done for the year. Use the cycle for
contracts, the draft season for anything fetching or naming a draft.

A DRAFT ADVANCES THE CYCLE, NOT A FINISHED SEASON — `resolveKeepers` rolls contracts
onto the next year the moment a draft completes, so from the day the 2026 draft is
archived the board quotes 2027, five months before the 2026 season ends. Deriving
it from finished seasons alone left ADP a year behind for that whole stretch, and
pinned it to the stale frozen snapshot the entire season.

`npm run adp -- --auto` is the write half, and takes the lock itself: it asks
Sleeper for the draft date (the only place it exists before a draft runs), and
freezes on the first daily run at or after the window opens. It never overwrites
an existing snapshot, so it can fire only once per cycle, and it bails quietly for
every reason it might not apply — no draft, no date, already drafted, already
frozen, too early. Cron granularity means the snapshot lands within 24 hours of
the bylaw moment, always after it and never before.

DERIVE NEVER READS ADP — checked, not assumed. Refreshing it daily therefore
cannot move a committed keeper contract; the only thing that changes is the market
column beside one.

`getAdp()` is still the ONE place that decides. Do not add a second date check in
a page.

### What an expired contract costs

Bylaws 1.7.2.2 revalue a contract with no keeps left to ADP
(`resetsToAdpAfterContract`). NOTHING DID THAT — derive left `round` at the
original figure forever and every surface printed the literal word "ADP" in the
cost column, so the number a team would actually pay was nowhere on the site. The
projected board went further and placed those keepers on no pick at all. It went
unnoticed because there are zero expired contracts today: keepers began in 2024
with two keeps, so the first ones appear in 2027.

`costRound(contract, adp, draftRounds)` in `lib/draft-slots.ts` is the one rule,
used by every cost cell, both sorts, and both board allocators.

COMPUTED AT READ TIME, NOT STORED. Writing it into `keepers.json` would make a
committed contract move every day the market does, which breaks the empty-diff
property the pipeline depends on and rewrites history in git. The contract keeps
its true original round; what it costs today is derived beside it from whatever
`getAdp()` returns — frozen inside the bylaw window, live outside it.

CAPPED AND FLOORED AT THE LAST ROUND. ADP is an overall pick number divided by the
league size, so a deep bench player converts to round 21 in a 17-round draft, and
129 of 372 ranked players have no ADP at all. The cheapest a keeper can ever cost
is your last pick, so that is what an off-the-board contract costs — every expired
contract stays keepable. `ValueBadge` still tells the truth about it: paying R17
for a player the market has at R21 shows as -4.

`assignKeeperSlots` now takes an EFFECTIVE round and has no `expired` branch —
run a contract through `costRound()` before calling it.

Unit-checked across all seven cases (live contract, elite ADP, mid ADP, past the
draft, round 40, unpriced, and a zero guard) plus board placement.

Round conversion divides ADP by *this league's* team count, so pick 15 is round 2
in a 10-team league. Surplus value shown in the UI is `costRound - adpRound`:
positive means the keeper pick is cheaper than market. Mind the direction —
round numbers count up as value counts down.
