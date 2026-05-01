# `snapshot/` — local language

The bridge between the live browser and our data model. Page → Atoms → State.

## Intent in one paragraph

`snapshot/` is the **only** module that imports `playwright`. It takes a live
Page, walks the accessibility tree, extracts our `Atom[]` representation, and
produces a `SnapshotResult` ready for `core/canonicalize`. Everything else
in the project operates on data structures; this module operates on a browser.

## Local vocabulary

### a11y tree
The browser's accessibility tree — the structured semantic representation of
the page used by screen readers. Roles like `button`, `link`, accessible names,
states (checked/expanded/disabled). The tree is what we trust as "what's on
the page", not the raw DOM. Playwright 1.59 no longer exposes the old
`page.accessibility.snapshot()` API, so v0.0.2 reads Chromium's
`Accessibility.getFullAXTree` via a Playwright CDP session.

### AxNode
A node in the a11y tree. Has a `role`, an optional `name`, an optional
`description`, state flags (`checked`/`pressed`/`expanded`/etc.), and
`children`. Our `extractAtoms()` walks these recursively.

### raw_tree
A JSON string-dump of the a11y tree. Stored on `SnapshotResult` for debugging
and for LLM fallback (Stagehand's `act()` consumes a similar text form).
NOT used for hashing — that's the parsed `atoms[]`.

### xpath_map
elementId → absolute XPath. v0.0.2 leaves this empty; v0.0.4+ populates it
via Stagehand's `captureHybridSnapshot` so we can target Atoms with
deterministic Playwright selectors.

### url_map
elementId → URL (for link-role atoms). Same population strategy as
`xpath_map`.

### page handle
Whatever the caller passes that resembles a Playwright `Page` — a real Page,
a Stagehand `context.pages()[0]`, or a frame. v1 type is `unknown` to keep
the boundary loose; we'll narrow when we add Stagehand.

### state classification
The mapping from a `SnapshotResult` to a `StateKind`
(`page | modal | panel | list | form | error`). Heuristic: `dialog` role at
root → modal, `form` role + submit button → form, etc.

### snapshot stability
The empirical property that two captures of the same logical page produce
`SnapshotResult`s whose `canonicalizeAtoms(.atoms)` are deep-equal. This is
the **invariant the v0.0.2 probe tests**.

## Not in this module

- ❌ Executing actions (that's `runtime/replayer`)
- ❌ Saving snapshots to disk (that's `storage/`)
- ❌ Hashing snapshots (that's `core/hash`)
- ❌ Deciding what to do next (that's `explorer/` or `runtime/`)
- ❌ Calling LLMs (that's `runtime/self-healer`)

## Key invariants

1. **Read-only.** Snapshot never clicks, types, or mutates browser state.
   If you need to test "what happens after click X", that's the explorer's job.
2. **No LLM call.** Pure browser-side operation; no model required.
3. **Stable across visits.** Two captures of the same logical page must yield
   `canonicalize(atoms_1) === canonicalize(atoms_2)` (modulo timing flakes
   handled by `waitForLoadState`).
4. **Iframe-aware (eventually).** v0.0.2 ignores iframes; v0.0.3+ recurses.
5. **Settled before reading.** Caller is responsible for calling
   `waitForLoadState('networkidle')` before `captureSnapshot()`. We add a
   `domcontentloaded` wait as a safety net but don't guarantee SPA settlement.
