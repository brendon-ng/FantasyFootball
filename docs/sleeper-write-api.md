# Sleeper write API: lineups, adds, drops, waivers, IR

Sleeper's documented API (`api.sleeper.app/v1`) is READ-ONLY. Everything the app
does to a team goes through its private GraphQL endpoint instead, and this is how
to call it. Nothing in the site uses any of this; it is for driving a team from a
script.

Worked out in October 2026 from three sources, in descending order of trust:
real calls against the "Test" league (`1406767219328724992`), the app's own
JavaScript bundle (which shows the exact mutation strings it sends), and schema
introspection. Each section says which one it rests on.

| Action | Mutation | Status |
| --- | --- | --- |
| Set a week's lineup | `update_matchup_leg` | **Verified** — benched 400 starters for weeks 7-18 |
| Drop | `league_create_transaction` | **Verified** — 106 drops, each `complete` |
| Add a free agent (optionally with a drop) | `league_create_transaction` | **Add verified** — 5 adds, each `complete`; add-plus-drop not yet run |
| Claim off waivers | `submit_waiver_claim` | From the bundle, not yet run |
| Change a claim's FAAB bid | `update_waiver_claim` | From the bundle, not yet run |
| Cancel a claim | `cancel_waiver_claim` | From the bundle, not yet run |
| Move to / from IR | `roster_update_reserve` | From the bundle, not yet run |
| Set the default lineup | `roster_update_starters` | From the bundle, not yet run |

---

## 1. The basics

```
POST https://sleeper.com/graphql
content-type: application/json
authorization: <JWT>              raw token, NO "Bearer " prefix
user-agent: <a browser UA>        see below
{"operationName": "...", "query": "...", "variables": {...}}
```

**The token** is the `authorization` header on any request the logged-in web app
makes to `/graphql` (DevTools → Network). It acts as the WHOLE ACCOUNT — trades,
drops, chat, every league — so it lives in `.sleeper-token` at the repo root,
which is gitignored, and is never echoed or put on a command line. Check it with
a read that changes nothing:

```graphql
query me { me { user_id display_name } }
```

**A browser user-agent is required.** Cloudflare answers Python's default
`urllib` UA with `403 error code: 1010` before Sleeper ever sees the request.
curl's default UA happens to pass. Nothing is written when this fires.

**An unauthenticated write is a 500 HTML page** ("Oops… Antonio Brown"), not a
GraphQL error. Do not try to parse it as JSON.

**Introspection works, in snake_case**: `__schema { mutation_type { fields … } }`,
not `mutationType`. 356 mutations as of this writing.

### Maps are sent as parallel `k_` / `v_` arrays

Sleeper's transactions store adds and drops as `{player_id: roster_id}` maps
(the shape `data/<slug>/raw/*/transactions` already holds). GraphQL arguments
cannot be maps, so every map is FLATTENED into two arrays of the same length:

```
{"4504": 1, "4029": 1}   →   k_drops: ["4504", "4029"],  v_drops: [1, 1]
{"waiver_bid": 12}       →   k_settings: ["waiver_bid"], v_settings: [12]
```

Keys are player ids (strings — team defences are abbreviations like `"SF"`),
values are the roster id. The app builds these with one helper for every call.

### Reading back

The public REST endpoints are CDN-cached for 60 seconds
(`s-maxage=60, stale-while-revalidate=300`), so `/league/<id>/matchups/<week>`
straight after a write shows the OLD lineup. This looked like a failed write the
first time. Read back through GraphQL, which is not cached:

```graphql
query { matchup_legs(league_id: "<id>", round: 7) { roster_id starters players } }
```

or add a throwaway query string to the REST URL to miss the cache.

---

## 2. Edit a lineup

**Verified.** The app sets one week at a time:

```graphql
mutation update_matchup_leg($starters_games: Map) {
  update_matchup_leg(league_id: "<id>", roster_id: 1, leg: 7, round: 7,
                     starters: ["4046", "8228", "0", …],
                     starters_games: $starters_games) {
    leg round roster_id starters
  }
}
```

- `starters` is the WHOLE lineup, in `roster_positions` order with the `BN`
  entries left out. To swap one player you resend the entire list. The bench is
  implicit: anyone in `players` who is not in `starters`.
- `"0"` is an empty slot. Benching everyone is `["0"] * slots`.
- `leg` is the NFL week and `round` the matchup round. They are equal in every
  league here; the app passes the same number for both.
- `starters_games` is optional and is sent as a JSON-STRINGIFIED map. Omitting
  it worked.
- A leg exists for every remaining week of the season before anyone sets it, so
  future weeks can be written now. The Test league had legs 7-18.
- Locked players (game already kicked off) are presumably refused by the server.
  Untested.

**`roster_update_starters(league_id, roster_id, starters)`** sets the ROSTER's
default lineup instead. The app uses it only while the league is `pre_draft`,
`drafting` or `complete`; in season its save button writes `update_matchup_leg`
for the week on screen. Prefer the per-week call. Changing the default part-way
through a week has not been tested.

`force_update_matchup_leg` has the same arguments and is the commissioner
override.

---

## 3. Drop, add, and add-plus-drop

**Drop and add verified; add-plus-drop from the bundle.** One mutation covers all three:

```graphql
mutation league_create_transaction($k_adds: [String], $v_adds: [Int],
                                   $k_drops: [String], $v_drops: [Int]) {
  league_create_transaction(league_id: "<id>", type: "free_agent",
      k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops) {
    transaction_id status type adds drops
  }
}
```

| Want | Variables |
| --- | --- |
| drop | `k_drops: [pid], v_drops: [roster]`, no adds |
| add | `k_adds: [pid], v_adds: [roster]`, no drops |
| add and drop in one move | both |

It resolves IMMEDIATELY — the response comes back `status: "complete"`, and the
player is off the roster on the next read. A dropped player goes onto waivers for
the league's `waiver_clear_days` (see §4), so he cannot be re-added as a free
agent straight away.

`type` is always `"free_agent"` from a manager. The app's enum also has
`waiver`, `trade`, `commissioner` and `chopped`.

ONLY FOR A FREE AGENT. A player on waivers needs §4. The app decides which call
to make by checking the player's status first; it does not try one and fall back.

The roster cap is `len(roster_positions)` plus `reserve_slots` and `taxi_slots`
for those lists. The Test league is 400/0/0.

---

## 4. Claim off waivers

**From the bundle, not yet run.**

### Is he on waivers?

```graphql
query { league_players(league_id: "<id>") { player_id settings } }
```

A player on waivers carries `settings.waiver_clears_at`, a unix timestamp. Checked
against the Test league: the players dropped on 2026-10-19 show a clear time two
days out, which matches `waiver_clear_days: 2`. A player with no entry, or a time
already past, is a free agent → §3. The app's own status enum is
`FA "0" / WAIVER "1" / LOCKED "2" / WAIVERFA "3"`.

### Submit

```graphql
mutation submit_waiver_claim($k_adds: [String], $v_adds: [Int],
                             $k_drops: [String], $v_drops: [Int],
                             $k_settings: [String], $v_settings: [Int]) {
  submit_waiver_claim(league_id: "<id>", k_adds: $k_adds, v_adds: $v_adds,
      k_drops: $k_drops, v_drops: $v_drops,
      k_settings: $k_settings, v_settings: $v_settings) {
    transaction_id leg status settings adds drops
  }
}
```

- `k_settings: ["waiver_bid"], v_settings: [12]` ONLY in a FAAB league
  (`settings.waiver_type == 2`; 0 is rolling, 1 reverse standings). The app leaves
  both arguments out of the query entirely otherwise.
- The drop is optional and only happens if the claim wins.
- The claim sits at `status: "pending"` until waivers run (`waiver_day_of_week`,
  or `daily_waivers`), then becomes `complete` or `failed` — real 2025 examples
  of both are in `data/den-ops/raw`, `failed` carrying
  `metadata.notes: "This player was claimed by another owner."`

### Change the bid, or cancel

Both need the claim's `transaction_id` and its `leg`, which the submit response
returns:

```graphql
mutation update_waiver_claim($k_settings: [String], $v_settings: [Int]) {
  update_waiver_claim(league_id: "<id>", transaction_id: "<txn>", leg: 7,
      k_settings: $k_settings, v_settings: $v_settings) { transaction_id settings }
}

mutation cancel_waiver_claim {
  cancel_waiver_claim(league_id: "<id>", leg: 7, transaction_id: "<txn>") {
    transaction_id status
  }
}
```

To find a pending claim you did not keep the id of:

```graphql
query { league_transactions(league_id: "<id>", leg: 7, status: "pending", roster_id: 1) {
  transaction_id type status adds drops settings } }
```

---

## 5. Move to and from IR

**From the bundle, not yet run.**

```graphql
mutation roster_update_reserve {
  roster_update_reserve(league_id: "<id>", roster_id: 1, reserve: ["4029", "8155"]) {
    roster_id players reserve starters
  }
}
```

- `reserve` is the WHOLE IR list, like `starters`. To activate someone, send the
  list without him; `[]` empties IR.
- He stays in `players` either way. IR is a label on a rostered player, not a
  separate roster.
- **The order matters.** When the app saves a roster in season it calls
  `roster_update_reserve` FIRST, then taxi, then `update_matchup_leg`, and
  stops at the first error. So take a player out of `starters` before IR-ing
  him, or the lineup call is working with a player who is no longer eligible.
- Who is eligible comes from the league: `reserve_slots` (0 means no IR at all —
  the Test league, so this could not be tested there) and the
  `reserve_allow_out` / `_doubtful` / `_sus` / `_na` / `_dnr` / `_cov` flags,
  matched against the player's `injury_status`. Den Ops has 2 slots and allows
  Out.
- Activating a player when the active roster is already full should be refused.
  Untested.

`roster_update_taxi(league_id, roster_id, taxi, force)` is the same shape for the
taxi squad.

---

## 6. A minimal caller

What the verified runs used, trimmed. Python only because it was to hand; any
HTTP client works as long as it sends a browser user-agent.

```python
import json, urllib.request

TOKEN = open(".sleeper-token").read().strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

def gql(op, query, variables=None):
    req = urllib.request.Request(
        "https://sleeper.com/graphql",
        data=json.dumps({"operationName": op, "query": query,
                         "variables": variables or {}}).encode(),
        headers={"content-type": "application/json",
                 "authorization": TOKEN, "user-agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=60))

def kv(mapping):   # {"4504": 1} -> (["4504"], [1])
    return list(mapping), list(mapping.values())
```

A GraphQL rejection comes back as `{"errors": [...]}` with no data. Check for it
on every write; the app shows `errors[0]` to the user verbatim.

Make one change per call when dropping or adding in bulk. A failure then costs
one named player rather than an unknown share of a batch, at the price of one
feed entry per player in the league's transaction log.
