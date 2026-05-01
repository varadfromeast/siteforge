# `core/` — local language

Pure data model + algorithms. **Zero I/O. Zero browser.** Everything here is
synchronous, deterministic, and unit-testable without external dependencies.

## Intent in one paragraph

`core/` is the substrate the whole project rests on. It defines the types
(State, Operation, Process, Cluster, SiteGraph), and three operations on those
types: **canonicalization** (atom-list → noise-free atom-list),
**hashing** (atom-list → content id), and **planning** (graph + endpoints →
shortest path). If `core/` is wrong, everything downstream is wrong. If it
imports `fs` or `playwright`, the design is wrong.

## Local vocabulary

### canonicalize
The function that strips noise from a raw atom list and returns a deterministic
sequence. Two visits to the "same" page must canonicalize to the same output.
Idempotent: `canonicalize(canonicalize(x)) === canonicalize(x)`.

### hash
SHA-256 over canonical JSON (sorted keys). The content-addressing primitive.
Used for `StateId` (`hashAtomSet`) and `validation_hash` (`hashValue`).

### plan
BFS over the SiteGraph's edges to find a shortest path between two states.
Filters edges below `min_confidence` unless that disconnects the graph.
Returns `PlanResult | NoPathResult` — never throws.

### canonical JSON
JSON with object keys recursively sorted before serialization. Required for
hashes to be byte-identical across runs/machines/processes.

### interactable role
The set of ARIA roles we treat as Atoms: `button`, `link`, `textbox`,
`searchbox`, `combobox`, `checkbox`, `radio`, `switch`, `tab`, `menuitem`,
`menuitemcheckbox`, `menuitemradio`, `option`, `slider`, `spinbutton`,
`treeitem`. Anything else is dropped during canonicalization.

### stable attribute
The set of HTML/ARIA attributes we keep on Atoms: `id`, `aria-label`,
`aria-labelledby`, `data-testid`, `data-test`, `name`, `type`, `placeholder`,
`role`, `href` (path only). Everything else is noise.

### generated id
An attribute value matching a known pattern for framework-generated identifiers
(`^_[a-z0-9]{4,}$`, `^css-…$`, `^sc-…$`, `^MuiBox-root-…$`). Dropped during
canonicalization because they change across deploys.

### schema version
A monotonic integer (`CURRENT_SCHEMA_VERSION`) bumped on every breaking change
to the on-disk shape of `SiteGraph`. Storage refuses to load mismatches.

## Not in this module

- ❌ Reading or writing files (that's `storage/`)
- ❌ Browser automation (that's `snapshot/`)
- ❌ LLM calls (that's `runtime/` via Stagehand)
- ❌ Pipeline orchestration (that's `explorer/`)
- ❌ Any side effect at all

## Key invariants

1. **Determinism.** No `Date.now()`, no `Math.random()`, no env reads.
2. **No I/O.** No `fs`, `fetch`, `playwright`, `crypto.randomBytes` — just
   `crypto.createHash` (SHA-256).
3. **Stable serialization.** Canonical JSON guarantees identical bytes for
   equal values across runs.
4. **Idempotence.** All transforms are idempotent. `f(f(x)) === f(x)`.
5. **Total functions.** Inputs are validated; pathological cases (empty
   arrays, missing fields) return sensible defaults instead of throwing.
