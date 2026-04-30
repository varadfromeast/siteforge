# Interface — `core/`

Pure data model + algorithms. **Zero I/O. Zero browser.** Everything in this
module is synchronous, deterministic, and unit-testable without any external
dependencies.

## Purpose

Provide the fundamental types and pure functions that the rest of the project
composes:
1. The data model (State, Operation, Process, Cluster, SiteGraph, Registry).
2. Atom canonicalization — the function that decides "are two pages the same logical state?"
3. Hashing — content-addressed ids.
4. Path planning — BFS over a SiteGraph.

If `core/` is wrong, everything downstream is wrong. So this module gets the
most attention to invariants and tests.

## Public surface

```ts
// Types — exported from ./types.ts
import type {
  Domain, Hash, StateId, OpId, ProcessName, ClusterId, ISO8601,
  Atom, State, StateKind, Operation, OpType, ConfidenceReason,
  ArgSpec, Process, Cluster, SiteGraph, SiteGraphMeta,
  Registry, RegistryEntry,
} from 'siteforge/core';

// Algorithms
canonicalizeAtoms(atoms: Atom[]): Atom[]
hashAtomSet(atoms: Atom[]): StateId
hashValue(value: unknown): Hash
planPath(
  graph: SiteGraph,
  from: StateId,
  to: StateId,
  options?: { min_confidence?: number; max_depth?: number },
): PlanResult | NoPathResult

// Constant
const CURRENT_SCHEMA_VERSION = 1
```

## Inputs / outputs

### `canonicalizeAtoms(atoms)`
- **In:** raw `Atom[]` from a snapshot.
- **Out:** filtered, normalized, sorted `Atom[]`. Length is `≤ atoms.length`.
- **Invariant:** `canonicalizeAtoms(canonicalizeAtoms(x)) === canonicalizeAtoms(x)` (idempotent).
- **Invariant:** order is total — same input → same output, byte-identical.

### `hashAtomSet(atoms)`
- **In:** any `Atom[]` (raw or canonical).
- **Out:** `StateId` (hex string, 64 chars).
- **Invariant:** `hashAtomSet(a) === hashAtomSet(b)` ⇔ `canonicalizeAtoms(a)` deep-equals `canonicalizeAtoms(b)`.

### `hashValue(value)`
- **In:** any JSON-serializable value.
- **Out:** `Hash` (hex string, 64 chars).
- **Invariant:** stable across runs/processes/machines for the same value.
- **Invariant:** order-independent for objects (keys sorted before stringify).

### `planPath(graph, from, to, options?)`
- **In:** a SiteGraph + source/target StateIds.
- **Out:** `{ ok: true, path: OpId[], total_confidence }` or `{ ok: false, reason }`.
- **Algorithm:** BFS over edges, treating edges with `confidence < min_confidence` as absent unless that disconnects the graph.
- **Tie-breaker:** higher `total_confidence` wins among equally-short paths.
- **Cycle handling:** standard BFS visited set.

## Invariants

1. **Determinism:** every function is pure. No `Date.now()`, no `Math.random()`, no `process.env`.
2. **No I/O:** no `fs`, no `fetch`, no `playwright`. Imports of those packages are forbidden in this module.
3. **Schema versioning:** any change to the on-disk shape of `SiteGraph` bumps `CURRENT_SCHEMA_VERSION`. Callers compare and refuse to load mismatched.
4. **Stable serialization:** `hashValue` uses canonical JSON (sorted keys) so hashes are reproducible.

## Dependencies

- **Imports from outside:** Node built-ins only (`crypto` for sha256). No npm runtime deps.
- **Imported by:** every other module in the project. This is the foundation.

## Errors

- `canonicalizeAtoms` and `hashAtomSet` never throw. They handle empty arrays, missing fields, and weird Unicode.
- `planPath` returns a `NoPathResult` with reason instead of throwing.

## Performance

| Function | Big-O | Notes |
|---|---|---|
| `canonicalizeAtoms` | `O(n log n)` for sort | n ≤ ~500 atoms typical |
| `hashAtomSet` | `O(n)` | sha256 over canonical JSON |
| `hashValue` | `O(size)` | sha256 over canonical JSON |
| `planPath` | `O(V + E)` | classic BFS |

All functions are sub-millisecond on realistic graph sizes.

## Test strategy

**Unit tests (deterministic):**
- `canonicalize`: empty → empty; idempotent; permuted input → same output; injects noise (timestamps, generated ids) → output unchanged.
- `hash`: order-independent; stable across runs; different input → different hash (collision check).
- `planPath`: trivial graph (A→B), disconnected, cycles, confidence filtering, no-path case.

**Integration test (live, the canonical "does it actually work" check):**
- The probe script (`examples/probe-instagram.ts`) opens Chrome, captures a real
  page twice, verifies the hashes match.
- This is the test that catches "canonicalizer is too permissive" or "atom-set
  drifts on benign content changes."

## Open questions (request for review)

1. **Atom-name normalization aggressiveness.** v1 lowercases + trims + drops pure-numeric.
   Should we also strip leading-emoji? Strip parenthesized-counts ("Inbox (5)" → "Inbox")?
   The probe will tell us.
2. **Generated-id patterns.** v1 drops attrs matching `^_[a-z0-9]{4,}$`.
   Sites use other patterns (e.g. Stripe uses `__priv_<hash>`). May need a per-site override.
3. **Sort stability.** v1 sorts by `(role, accessible_name, JSON.stringify(attrs))`.
   If two atoms have identical role+name+attrs (legitimate duplicates like nav menu items
   shown twice), they'll merge in the canonical output. Acceptable? Or do we want to
   preserve count via a `multiplicity` field?
4. **Confidence aggregation in `planPath`.** v1 uses product of edge confidences as
   `total_confidence`. Sum-of-logs would handle long paths better. Open to either.

## Files

- `src/core/types.ts` — type definitions only, zero logic.
- `src/core/canonicalize.ts` — `canonicalizeAtoms`.
- `src/core/hash.ts` — `hashValue` + `hashAtomSet`.
- `src/core/plan-path.ts` — `planPath` (deferred to v0.0.5).
- `src/core/index.ts` — re-exports.
