# `runtime/` — local language

The run loop. Used at execution time when an agent invokes a CLI subcommand
or MCP tool.

## Intent in one paragraph

`runtime/` takes a SiteGraph + a target (named process or arbitrary state)
and executes it on a live browser. The hot path is **deterministic XPath
replay** (no LLM); the cold path is **self-healed via Stagehand `act()`**
(one LLM call) with write-back into the graph. This is where the cache
hierarchy actually pays off — agents that previously asked an LLM what to
click on every step now traverse the cached graph in milliseconds.

## Local vocabulary

### run loop
The execution pipeline: `RESOLVE → CURRENT-STATE → PLAN → EXECUTE → SELF-HEAL
→ RETURN`. Mirrors `explorer/`'s teach loop in shape but lives at run time
instead of teach time.

### replayer
The component that executes a single Operation by passing its `selector_xpath`
+ `op_type` to Stagehand's `takeDeterministicAction`. No LLM call. Fast
(~150-200ms per op).

### self-healer
The fallback when replay fails (Playwright exception or drift). Calls
Stagehand's `act(operation.instruction)` — one LLM call — to re-resolve a
selector against the current page, retries, and on success **writes back**
the updated Operation to the SiteGraph. Confidence becomes `self-healed`.

### drift
The condition where a cached Operation's `validation_hash` no longer matches
the observed `to_state.atoms` after replay. Defined globally in
`docs/UBIQUITOUS_LANGUAGE.md`; here it specifically triggers self-heal.

### L1 cache
The in-memory `Map<Domain, SiteGraph>` that survives across calls within a
single Node process. LRU evict after 5 min idle. Loaded lazily from L2
(`storage.loadGraph`) on first access.

### write-back
Strategy where edge updates from self-heal accumulate in L1 and are flushed
to L2 either on session end or every N changes. Contrasts with write-through
(per-change disk write — too slow).

### single-flight
A lock on `(domain, op_id)` ensuring two concurrent agent calls executing the
same operation queue rather than double-execute. Critical because executing
the same op twice could double-post, double-click "send", etc.

### negative cache
A short-TTL record (5 min) asserting "no path from State S to Intent I".
Prevents the planner from repeatedly trying paths it just learned don't work.
TTL deliberately short because sites add features.

### quarantine
After `max_heals` self-heals all fail on the same edge, mark
`confidence *= 0.5` and surface to the user as
`SelfHealExhaustedError`. The graph keeps the edge but downgrades it; future
runs prefer alternate paths.

### cold start
The case where `CURRENT-STATE` finds no matching `StateId` in the graph
(neither exact nor fuzzy Jaccard match). Falls through to Stagehand `act()`
on the first instruction and lets self-heal kick in repeatedly. Slow but
correct; future runs become hot.

## Not in this module

- ❌ Discovering new states (that's `explorer/`)
- ❌ Naming or tracing processes (that's `explorer/TRACE`)
- ❌ Hashing or canonicalization (that's `core/`)
- ❌ Persisting the graph (just calls `storage/`)
- ❌ Exposing the graph as MCP/CLI (that's `emitters/`)

## Key invariants

1. **Single-flight per op.** Concurrent calls executing the same
   `(domain, op_id)` queue, never double-execute.
2. **Drift is data, not a crash.** A drifted edge gets healed and recorded;
   the user's request still succeeds (within `max_heals` budget).
3. **Write-back is best-effort.** If `saveGraph` fails after a successful
   heal, the run still returns success — we just lose the heal update.
   Logged as a warning; the edge will heal again next time.
4. **No exploration during run.** If the planner returns no-path, we return
   `NoPathError` rather than fanning out a mini-explore. Exploration is the
   user's explicit decision (`siteforge teach`).
5. **Args validated against ArgSpec.** Before execution, the runtime validates
   user-supplied args against the Process's declared schema. Surfaces bugs
   early.
