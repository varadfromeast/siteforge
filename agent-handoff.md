# Agent Handoff

## Current State

This repo is `siteforge`, a local-first experiment for building a per-site navigation map from live browser UI surfaces. The current direction is no longer just "hash one Instagram profile twice"; it is now: let the user click around Instagram, capture the observed surfaces, and convert them into a useful site map.

Latest useful artifacts are committed under:

- `.siteforge/probes/2026-05-01T05-22-10-329Z/`
- `.siteforge/probes/2026-05-01T05-29-15-149Z/`
- `.siteforge/maps/2026-05-01T05-46-28-575Z/`

Do not commit `.siteforge/chrome-cdp/`. It is a reusable Chrome profile and contains cookies/history/login data.

## What Was Built

Core/snapshot/storage work:

- `src/snapshot/capture.ts` now uses Chromium CDP `Accessibility.getFullAXTree` because current Playwright no longer exposes the old `page.accessibility.snapshot()` API.
- `src/snapshot/surface.ts` adds `surfaceAtoms()`, a leaner atom filter for navigation identity.
- `src/snapshot/index.ts` now exports `surfaceAtoms()` and implements basic `classifyState()` / `snapshotToState()`.
- `src/storage/` now has real JSON persistence: safe paths, atomic writes, graph/session/registry load/save, schema guards.
- `src/core/plan-path.ts` implements BFS path planning with confidence filtering and fallback.

Examples/tools:

- `examples/probe-instagram.ts`
  - Can probe one or more profiles.
  - Can discover random profiles with `--discover-profiles N`.
  - Reuses/starts a CDP Chrome.
  - Writes captures and summaries to `.siteforge/probes/<timestamp>/`.
- `examples/map-instagram.ts`
  - Interactive mapper.
  - Run with `npm run map`.
  - User clicks around manually; the script polls the current page and records new surface states and transitions.
  - Writes `.siteforge/maps/<timestamp>/site-map.json` plus capture JSON files.

## Latest Map Run

Latest map directory:

`.siteforge/maps/2026-05-01T05-46-28-575Z/`

Generated files:

- `site-map.json`
- 22 captures under `captures/0001-*.json` through `captures/0022-*.json`

Observed graph summary:

- 19 nodes
- 21 edges
- 22 visits/captures
- kinds: 11 `form`, 3 `list`, 3 `modal`, 2 `page`
- surface atom counts ranged from 9 to 77

Important interpretation:

- The mapper is working: it observed home feed, stories, profile pages, post modal, search overlay, reels/tagged tabs, and profile-to-profile transitions.
- The map is still too sensitive in some places. Home feed surfaces created several separate nodes because story buttons, feed actions, and comment/notification overlays change the surface hash.
- Profile surfaces are much better: the useful surfaces are around 7-10 atoms for ordinary profile pages.
- Search overlays and suggestion panels are still too fat. They include suggested usernames, hashtags, and close buttons as surface atoms.

## Current Diagnosis

The project is progressing well. The architecture should continue in this direction:

1. Full raw/canonical atoms are diagnostic evidence.
2. `surface_atoms` should become the identity layer for navigation states.
3. The mapper should produce a graph from observed browser use.
4. Later, explorer/runtime can replay that graph.

The main issue is not browser control anymore. The main issue is state identity quality.

## Next Best Work

Recommended next steps:

1. Move interactive mapper concepts from `examples/map-instagram.ts` toward real modules:
   - snapshot capture record
   - surface state id
   - transition recorder
   - map serializer

2. Improve `surfaceAtoms()` by adding context-aware modes:
   - `profile` surfaces: keep profile actions/tabs/handle; drop followers, suggested accounts, biography-as-button, post/reel content.
   - `feed` surfaces: keep feed action vocabulary (`like`, `comment`, `share`, `save`, `more`, `audio muted`) but drop individual story usernames and content-specific links.
   - `story` surfaces: keep story controls (`close`, `like`, `reply`, `pause/play`, `previous/next`) but drop ad/profile names where possible.
   - `search` surfaces: keep search box/clear/close and maybe result categories; drop individual result users/hashtags.
   - `post/reel modal` surfaces: keep modal controls; drop hashtags, dates, commenters, and content captions.

3. Add a post-processing summarizer for `site-map.json`:
   - group nodes by URL family (`/`, `/stories/*`, `/p/*`, `/<handle>/`, `/<handle>/reels/`)
   - report oversized surfaces
   - report nodes likely split by content drift
   - suggest new surface filters from diffs

4. Make edge capture better:
   - current click recorder sometimes keeps stale `last_click`.
   - clear `__siteforgeLastClick` after consuming it.
   - include a click sequence number or timestamp threshold so old clicks do not attach to later automatic state changes.

5. Create a first real `SiteGraph` export from the map:
   - nodes from `surface_id`
   - edges from observed transitions
   - store via `storage.saveGraph()`
   - keep debug captures as sidecar files.

## Commands

Useful commands:

```bash
npm test
npm run typecheck
npm run build
npm run probe -- --discover-profiles 3
npm run map
npm run map -- --start https://www.instagram.com/reels/ --duration 300
```

## Verification Status

At handoff time, these passed:

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npx esbuild examples/map-instagram.ts --bundle --platform=node --format=esm --outfile=/tmp/siteforge-map-check.mjs`

## Caution

Instagram is a hostile automation target. Keep this local and personal. Do not commit browser profile/session files. Use throwaway accounts for aggressive exploration.
