# Interface — `snapshot/`

Wraps the browser. Page → Atoms → State.

## Purpose

Take a live browser page and produce a `SnapshotResult` (raw a11y tree +
xpath_map + url_map + parsed Atom[]) and downstream a fully classified `State`
ready to insert into a SiteGraph.

This is the **only** module that imports Playwright (or eventually Stagehand).
Every other module operates on data structures.

## Public surface

```ts
type PageHandle = unknown   // a Playwright Page or Stagehand context.pages()[0]

interface SnapshotResult {
  raw_tree: string                          // accessibility tree text dump (debug + LLM fallback)
  xpath_map: Record<string, string>         // elementId → absolute XPath
  url_map: Record<string, string>           // elementId → URL (for links)
  url: string                               // current page URL
  atoms: Atom[]                             // canonicalizable atoms
}

captureSnapshot(page: PageHandle): Promise<SnapshotResult>
classifyState(snapshot: SnapshotResult): StateKind
snapshotToState(snapshot: SnapshotResult): State
```

## Inputs / outputs

### `captureSnapshot(page)`
- **In:** a Playwright Page (or compatible). Must already be navigated and idle.
- **Out:** `SnapshotResult`.
- **Side effects:** none (read-only — just reads a11y tree and DOM, no clicks).
- **Failure modes:** page closed → throws. Network still in flight → captures
  partial state (caller should `waitForLoadState('networkidle')` first).

### `classifyState(snapshot)`
- **In:** a `SnapshotResult`.
- **Out:** `StateKind` enum.
- **Heuristics (v1):**
  - `dialog` role at root of tree → `modal`
  - `form` role + submit button → `form`
  - `feed` or `list` role with ≥10 similar children → `list`
  - `complementary` or `aside` role → `panel`
  - URL contains `/error` or accessible name "Page not found" → `error`
  - default → `page`

### `snapshotToState(snapshot)`
- Combines `classifyState` + `hashAtomSet` + label derivation.
- Returns a `State` ready to insert into SiteGraph.

## Invariants

1. **No browser state mutation.** Snapshot is a read. If we need to test "what
   happens after click X", that's the explorer's job, not ours.
2. **Stable across visits.** Two calls to `captureSnapshot` on the same logical
   page produce `SnapshotResult`s whose `canonicalizeAtoms(.atoms)` are deep-equal.
   *(This is the invariant the probe tests live.)*
3. **No LLM call.** Pure browser-side operation.

## Dependencies

- **Imports from outside:** `playwright`. (Optionally Stagehand later if we
  want their richer xpathMap, but for v1 we use Playwright's built-in
  `page.accessibility.snapshot()`.)
- **Imports from siteforge:** `core/types`, `core/canonicalize`, `core/hash`.
- **Imported by:** `explorer/`, `runtime/`.

## Errors

- `captureSnapshot` throws if the page is closed.
- `classifyState` returns `'page'` for ambiguous inputs (never throws).

## Performance

- `captureSnapshot`: ~50-200ms typical (Playwright's a11y tree is fast on
  modern Chrome).
- `classifyState`: <1ms.
- `snapshotToState`: dominated by `hashAtomSet` ~ 1ms.

## Test strategy

- **Unit tests:** stub `PageHandle` with a fake a11y tree, verify atom extraction.
- **Live probe:** see `examples/probe-instagram.ts`.
- **Acceptance criterion:** for v0.0.2, captureSnapshot must return ≥30 atoms
  on Instagram's logged-in feed (proxy for "we're seeing the actual UI, not
  just chrome").

## Open questions

1. **Stagehand vs raw Playwright.** v1 uses Playwright's `page.accessibility.snapshot()`.
   Stagehand's `captureHybridSnapshot` has richer xpathMap and frame-hopping. We
   may switch later. Cost of switching: low — same SnapshotResult shape.
2. **Iframe handling.** v1 ignores iframes. Real sites use them (auth flows,
   embedded content). Need to recurse into frames in v0.0.3.
3. **Shadow DOM.** Playwright handles open shadow DOM transparently. Closed
   shadow DOM is invisible — we'd need browser CDP for that. Defer.
4. **Screenshot capture.** Should `SnapshotResult` include a base64 screenshot?
   Useful for debugging but expensive (~50KB per state). v1: optional via flag.

## Files

- `src/snapshot/index.ts` — public exports.
- `src/snapshot/capture.ts` — `captureSnapshot` impl.
- `src/snapshot/classify.ts` — `classifyState` impl (deferred to v0.0.4).
- `src/snapshot/atom-extract.ts` — walks a11y tree, builds Atom[].
