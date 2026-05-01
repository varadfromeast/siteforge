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

We're at step 1, converging on step 2. **Stabilize surfaces before
automating exploration** — an unstable surface filter would let the
auto-explorer generate dozens of duplicate states per logical screen.

Latest useful artifacts:

- `.siteforge/probes/2026-05-01T05-22-10-329Z/`
- `.siteforge/probes/2026-05-01T05-29-15-149Z/`
- `.siteforge/maps/2026-05-01T05-46-28-575Z/` (v1)
- `.siteforge/maps/2026-05-01T06-19-48-063Z/` (v2)
- `.siteforge/maps/2026-05-01T08-25-27-440Z/` (v3)

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
  Records `op_type` per edge (`click`/`navigate`/`fill`/`submit`).
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
- `isMediaPlaceholder` — `media thumbnail`, `video player`, `thumbnail`
- `isFooterChrome` — link-only: `language`, `press`, `careers`, `sign up …`,
  `log in …`. **Role-restricted to link** so we never drop the actual
  primary login button on a login page.
- `isCaptionLink` — long (≥20 char) link/button names with sentence
  punctuation, bullet, or hashtag runs.
- `isCommentCounter` — `^comment\s+\d[\d,.]*[kKmM]?$`
- `isHashtagAtom` — link/button name starting with `#`
- `isDmSidebarItem` — the four DM sidebar phrases above
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

- **Atom extraction is stable.** Same DOM → same hash. v3 reel
  `40bf5d6e` was visited 7 times with identical surface_id every time.
- **Surface filter has known leaks** that are being patched as data
  exposes them.
- **Forms went from 58% false-positive → 0% → 4/18 (reels) → expected 0%
  after this commit.**

## Next Best Work

Recommended order:

1. **Run v4 of the map** with the latest patches landed. Click around the
   surfaces v3 covered, **plus exercise messaging and commenting** so we
   capture the comment-compose flow and the DM thread surface. Compare
   v3 → v4:
   - home `/` should be 1 node (was 3)
   - `/<handle>/` per profile should be 1 node (was up to 4)
   - reel page should be `page` not `form`, surface ~10–20 atoms (was 94)
   - DM thread (`/direct/t/<id>/`) should be 1 node per thread

2. Promote interactive-mapper concepts from `examples/map-instagram.ts` to
   real modules:
   - snapshot capture record
   - surface state id
   - transition recorder
   - map serializer

3. Add **context-aware** modes to `surfaceAtoms()` (deferred — current
   global filters got us most of the way):
   - `profile` surfaces, `feed` surfaces, `story` surfaces, `search`
     surfaces, `post/reel modal` surfaces.

4. Build the auto-explorer (`npm run map --site=<url>`). Playwright clicks
   every interactable atom on the current state, snapshots, records
   transitions, backtracks to anchor. Time-bounded, depth-bounded,
   throttled. Only worth doing once surfaces are stable.

5. Compile the observed map to a real `SiteGraph` (nodes from `surface_id`,
   edges from observed transitions, persist via `storage.saveGraph()`).
   Keep debug captures as sidecar files.

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
