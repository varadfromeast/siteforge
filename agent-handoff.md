# Agent Handoff

## Current State

`siteforge` is a local-first experiment for building a per-site navigation
map from live browser UI surfaces. The arc is:

```
manual map runs (today)
    ↓
stable surfaces (>95% same-state same-hash)
    ↓
auto-explorer (`npm run map --site=<url>`, BFS over interactables)
    ↓
compile to SiteGraph (storage.saveGraph)
    ↓
emit per-site CLI + MCP server
    ↓
agents replace LLM-driven clicks with cached transitions
```

We're now at the end of step 2 for a narrow Instagram vertical slice:
surfaces are stable enough for a first compiler/emitter MVP. Keep
expanding coverage carefully, but the next high-leverage move is no longer
more random clicking — it is compiling the observed map into a real
`SiteGraph` and emitting one or two tools.

Latest useful artifacts:

- `.siteforge/probes/2026-05-01T05-22-10-329Z/`
- `.siteforge/probes/2026-05-01T05-29-15-149Z/`
- `.siteforge/maps/2026-05-01T05-46-28-575Z/` (v1)
- `.siteforge/maps/2026-05-01T06-19-48-063Z/` (v2)
- `.siteforge/maps/2026-05-01T08-25-27-440Z/` (v3)
- `.siteforge/maps/2026-05-01T09-28-10-870Z/` (live v4, captured home →
  Direct inbox before the latest surface-filter patch)
- `.siteforge/inspections/2026-05-01T09-37-42-233Z/` (post-patch Direct
  inbox visual+atom check; stable at 6 surface atoms)
- `.siteforge/maps/2026-05-01T09-40-39-354Z/` (clean current baseline after
  home+Direct context-aware filter patches; mapper is/was live)
- `.siteforge/inspections/2026-05-01T09-40-51-152Z/` (post-patch home
  visual+atom check; stable at 6 surface atoms)
- `.siteforge/coverage/2026-05-01T10-47-50-969Z/` (final focused
  Playwright coverage run; 8/8 flows completed)
- `.siteforge/maps/2026-05-01T10-47-27-492Z/` (final map+Playwright trace:
  7 states, 6 edges, compact surfaces)

Do **not** commit `.siteforge/chrome-cdp/`. It is a reusable Chrome profile
and contains cookies, history, and login data.

## What Was Built

Core / snapshot / storage:

- `src/snapshot/capture.ts` uses Chromium CDP `Accessibility.getFullAXTree`
  (current Playwright no longer exposes `page.accessibility.snapshot()`).
- `src/snapshot/surface.ts` — `surfaceAtoms()`, the navigation-identity
  filter. Has grown across runs as we found leaks; see "Surface filter"
  below.
- `src/snapshot/index.ts` — `classifyState()` (URL-pattern dispatch with
  atom-based fallback) and `snapshotToState()`.
- `src/storage/` — JSON persistence: safe paths, atomic writes,
  graph/session/registry load+save, schema guards.
- `src/core/plan-path.ts` — BFS path planning with confidence filtering and
  fallback.

Examples / tools:

- `examples/probe-instagram.ts` — probe one or more profiles, optionally
  discover random ones via `--discover-profiles N`. Reuses or starts a CDP
  Chrome. Writes captures + summary to `.siteforge/probes/<timestamp>/`.
- `examples/map-instagram.ts` — interactive mapper. `npm run map`. User
  clicks around in a real Chrome window; the script polls the current page,
  records new surface states and transitions. Writes
  `.siteforge/maps/<timestamp>/site-map.json` plus capture JSON files.
  Records `op_type` per edge (`click`/`navigate`/`fill`/`submit`). It now
  retries snapshot capture while canonical/surface atoms are empty so fast
  SPA route changes don't get stored as 0-atom loading shells.
- `examples/cover-instagram.ts` — focused Playwright coverage harness.
  `npm run cover:instagram`. It drives a safe deterministic flow suite
  against the same CDP Chrome and writes screenshots + atom snapshots to
  `.siteforge/coverage/<timestamp>/`. This is the bridge between manual
  mapping and `src/explorer`: Playwright drives, snapshot/surface records,
  and the mapper can run beside it to collect edges.
- `examples/inspect-live.ts` — companion visual inspector. Run
  `npm run inspect:live` while `npm run map` is open. It attaches to the
  same CDP Chrome, does not resize the viewport, and writes screenshots plus
  atom snapshots to `.siteforge/inspections/<timestamp>/`. It exits
  explicitly after writing the summary so CDP connections do not leave
  hanging Node processes.
- `examples/snapshot-self-check.ts` — synthetic checks for `classifyState`,
  `snapshotToState`, and `surfaceAtoms`. Run with `npm run snapshotcheck`.
- `examples/self-check.ts` — pure-function checks for `core/canonicalize`,
  `core/hash`. `npm run selfcheck`.

## Map runs to date

| Run | Nodes | Edges | Visits | Form % (false-pos) | Median surface | Home `/` | bhav profile |
|-----|------:|------:|------:|-------------------:|---------------:|---------:|-------------:|
| v1 (05-46) | 19 | 21 | 22 | 11/19 (58%) | ~? | 7 nodes | 3 nodes |
| v2 (06-19) | 23 | 28 | 29 | 0/23 (0%) | 24 | 6 nodes | 3 nodes |
| v3 (08-25) | 18 | 21 | 30 | 4/18 (reels) | 28 | 3 nodes | 4 nodes |
| final (10-47) | 7 | 6 | 7 | 0/7 | 6 | 1 node | 1 node |

Each run we close one leak class and find the next one.

## What v3 surfaced

Three new leak patterns showed up in v3 (the user opened reels and DMs for
the first time):

1. **Reels viewer (`/reels/<id>/`) was bloated to 94 atoms** and
   misclassified as `form`. Root causes:
   - URL classifier's regex matched `/(p|reel)/` (singular) but missed
     `/reels/<id>/` (plural with id). Path fell through to atom-based
     fallback. IG's comment composer has a `form` role wrapper, so
     `looksLikeForm` returned true.
   - 11 per-comment counter buttons (`comment 1,368`, `comment 10.3k`,
     `comment 14`) — change as engagement happens.
   - 61 hashtag-shaped link/button atoms (`#fyp`, `#chess`, ...) from
     suggested-reel captions.

2. **Profile pages (`/<handle>/`) split by DM sidebar leak.** When the
   messages tray is visible alongside the profile, each visible
   conversation produces 4 atoms with usernames embedded:
   ```
   "open the profile page of <handle>"
   "react to message from <handle>"
   "reply to message from <handle>"
   "see (more) options for message from <handle>"
   ```
   The list rotates as new messages arrive.

3. **Home feed (`/`) split by geo location links.** `"bangalore, india"`,
   `"los angeles, california"` — geo-tagged post locations rotate with
   whichever posts are currently in the feed window.

## Surface filter — current state

`src/snapshot/surface.ts` runs in two steps: normalize names, then drop
predicates. Predicates currently in use:

- `dedupeRepeatedPhrase` — collapse `"home home"` → `"home"`,
  `"professional dashboard dashboard"` → `"professional dashboard"`.
- `isStoryDrawerButton` — `^story by\s.+`
- `isFeedTimestamp` — link with name like `10 h`, `4 d`, `2 w`
- `isSocialAggregate` — `1,605 others`
- `normalizeSurfaceName` — currently normalizes the IG current-account
  dropdown (`<handle> verified down chevron icon`) to `account menu`.
- `isMediaPlaceholder` — `media thumbnail`, `video player`, `thumbnail`
- `isFooterChrome` — link-only: `language`, `press`, `careers`, `sign up …`,
  `log in …`. **Role-restricted to link** so we never drop the actual
  primary login button on a login page.
- `isCaptionLink` — long (≥20 char) link/button names with sentence
  punctuation, bullet, or hashtag runs.
- `isCommentCounter` — `^comment\s+\d[\d,.]*[kKmM]?$`
- `isHashtagAtom` — link/button name starting with `#`
- `isDmSidebarItem` — the four DM sidebar phrases above
- `isDmConversationRow` — Direct inbox row buttons beginning with
  `user-profile-picture ...`; keeps the raw private row in captures but
  drops it from reusable surface identity.
- `isContextualGlobalChrome` — URL-aware chrome handling. Example: left-nav
  `reels` is dropped on `/` and `/direct/*`, but the profile tab `reels`
  is kept on `/<handle>/`.
- `isHomeFeedContent` — home-only drops for rotating feed content:
  unread-chat badge buttons, `audio is muted`, content `follow`, caption
  `more`, right-rail `switch`, `original audio`, ad CTAs, verified/content
  person links, and display-name links.
- `isGeoLocation` — link with `<city>, <region>` shape
- `isRepeatedSuggestionAction` — `dismiss`, `see all`, `next`
- `isGlobalChrome` — IG nav vocabulary list (28 entries inc.
  `consumer health privacy`, `new post create`, `settings more` —
  some doubled forms get there via `dedupeRepeatedPhrase`).
- `isContentItem` — generic content patterns: photo/reel/video suffix,
  caption-as-button, profile-picture, ≥70 char names, etc.
- `isSocialCounter` — `1,234 followers` etc.
- `isTransientAccountUi` — `note...`, `dismiss`, `similar accounts`, etc.
- `isOtherUserHandle` — username-shaped links unless equal to current
  profile handle. **Runs unconditionally** (not guarded by current handle
  presence) so home-feed suggested-user names get dropped too.

## URL classifier (`classifyState`)

Order of dispatch:
1. **Overlay**: `dialog`/`alertdialog`/`alert` role or "error"-text →
   `modal` / `error`. Trumps URL because a dialog opened on a profile is
   the modal, not the profile.
2. **URL pattern (IG-scoped)**: hostname must be `*.instagram.com`.
   Recognised families:
   - `/accounts/(login|signup|password|emailsignup)` → `form`
   - `/stories/*` → `modal`
   - `/direct/*` → `panel`
   - `/(p|reel)/<id>/` → null (atom-fallback decides — could be page or
     modal overlay)
   - `/reels/` (no id) → `list`
   - `/reels/<id>/` → `page` *(added in this iteration; was misclassified
     as form before)*
   - `/explore/...` → `list`
   - `/<handle>/(reels|tagged|saved|reposts)/` → `list`
   - `/<handle>/` → `page`
3. **Atom fallback**: only fires when URL didn't match. Loose
   `looksLikeForm` (input + submit-like button) is OK here because IG
   never reaches this path.

## Edge capture

`MapEdge` carries `op_type ∈ OpType`:
- `click` — recorded click on a button/link/role-bearing element.
- `navigate` — URL changed without a recorded click (back, URL bar,
  auto-refresh).
- `fill` — click on textbox/searchbox/combobox/input.
- `submit` — button text matches submit/send/post/publish/share/log
  in/sign in/sign up/save changes.

`__siteforgeLastClick` is cleared after read. Clicks older than
`CLICK_STALENESS_MS` (5 s) are discarded so an old click doesn't attach to
a later auto-refresh edge.

## Viewport bug fix (this iteration)

The mapper used to call
`page.setViewportSize({ width: 1280, height: 900 })` after attaching to a
user-owned Chrome via CDP. `setViewportSize` resizes the actual rendered
viewport in Chromium, which on the user's own window cropped the page so
the footer / lower buttons disappeared off-screen and were unclickable.

Fix: when attached via CDP, leave the viewport alone. Any newly created
context uses `viewport: null` so it inherits the real window size. The
fallback launch path (when no CDP Chrome is found) still uses the
1280×900 viewport because we control that window.

## Current Diagnosis

The architecture is right. State identity quality is the live work.

- **Atom extraction is stable enough for emitter MVP.** Final focused
  coverage completed all 8 target flows with compact surfaces:
  - home feed: 6 atoms
  - Direct inbox: 6 atoms
  - Direct thread: 8 atoms
  - profile: 8 atoms
  - profile reels route: 1 atom on this account (`messages`; likely a
    thin/unavailable tab state)
  - reels feed/page: 4 atoms
  - reel comments modal: 7 atoms
  - search panel: 2 atoms
- **False classifiers are fixed in the covered slice.** Empty IG `alert`
  nodes no longer force `error`; `/reels/<id>/` no longer misclassifies as
  `form`; Direct threads remain `panel`.
- **Map + Playwright is a good workflow.** The mapper records the edge
  trace while `cover:instagram` drives repeatable flows and writes visual
  evidence. This is the practical shape `src/explorer` should grow into.

## Next Best Work

Recommended order:

1. Compile the final map into a real `SiteGraph`:
   - source map: `.siteforge/maps/2026-05-01T10-47-27-492Z/site-map.json`
   - use `surface_id` as `State.id`
   - turn observed `MapEdge`s into `Operation`s
   - persist via `storage.saveGraph()`

2. Emit the first narrow CLI/MCP vertical slice:
   - `open_direct_inbox`
   - `open_direct_thread`
   - `send_dm({ text })`
   - optionally `open_reels` and `open_search`

3. Promote interactive-mapper concepts from `examples/map-instagram.ts` to
   real modules:
   - snapshot capture record
   - surface state id
   - transition recorder
   - map serializer

4. Convert `examples/cover-instagram.ts` into the first concrete
   `src/explorer` implementation. Keep it bounded, resumable, and safe:
   no public comment submit, no accidental like/follow, no fast click loops.

5. Build the auto-explorer (`npm run map --site=<url>`). Playwright clicks
   every interactable atom on the current state, snapshots, records
   transitions, backtracks to anchor. Time-bounded, depth-bounded,
   throttled. Only worth doing once surfaces are stable.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run selfcheck                                            # core
npm run snapshotcheck                                        # snapshot/surface
npm run probe -- --discover-profiles 3
npm run map
npm run map -- --start https://www.instagram.com/reels/ --duration 300
npm run cover:instagram                                     # focused Playwright coverage
npm run inspect:live
npm run inspect:live -- --duration 120 --interval-ms 3000
```

## Verification Status

At handoff time the following pass:

- `npm run typecheck`
- `npm run build`
- `npm test` (combined selfcheck + snapshotcheck)
- `npx esbuild examples/map-instagram.ts --bundle --platform=node --format=esm --outfile=/tmp/siteforge-map-check.mjs`

## Caution

Instagram is a hostile automation target. Keep this local and personal. Do
not commit browser profile/session files. Use throwaway accounts for
aggressive exploration. The mapper does not click on its own — the user
drives the browser; the script just observes.
