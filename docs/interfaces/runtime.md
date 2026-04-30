# Interface — `runtime/`

The run loop. Used at execution time when an agent invokes a CLI subcommand
or MCP tool.

## Purpose

Take a SiteGraph + a target (named process or arbitrary state) and execute it
on a live browser. Cached XPaths replay deterministically; Stagehand `act()`
fills in on misses with write-back.

## Public surface

```ts
interface RunOptions {
  fail_fast?: boolean      // stop on first failure (default false)
  max_heals?: number       // self-heal attempts per step (default 2)
  headless?: boolean       // default false (user can watch in v1)
}

interface RunResult {
  ok: boolean
  process: ProcessName
  steps_executed: Array<{ op_id: OpId; healed: boolean; elapsed_ms: number }>
  ended_at: StateId
  output?: unknown         // optional structured payload from extract calls
  error?: string
}

interface ValidateResult {
  states_checked: number
  states_drifted: number
  edges_quarantined: number
  drift_score: number      // 0..1
}

runProcess(domain: Domain, process: ProcessName, args: Record<string, unknown>, options?: RunOptions): Promise<RunResult>
navigateTo(domain: Domain, target: StateId, options?: RunOptions): Promise<RunResult>
validateGraph(domain: Domain): Promise<ValidateResult>
```

## Sub-components

### PathPlanner
Pure delegate to `core.planPath(graph, current, target)`. Lives here only as
an integration point — actual algorithm in `core/`.

### Replayer
Given an Operation, calls Stagehand's `takeDeterministicAction(selector, op_type, args)`.
Catches Playwright exceptions and translates them into a SelfHealer trigger.

### SelfHealer
On replay failure or drift:
1. Capture fresh snapshot.
2. Call Stagehand `act(operation.instruction)` — single LLM call.
3. Receives a new action with potentially-different XPath.
4. Execute the new action.
5. On success: update the cached Operation (new selector_xpath, recompute
   validation_hash, set `reason: 'self-healed'`, increment success_count).
6. Mark dirty in L1 cache; flush to L2 on next batch.

## Run loop (the canonical execution path)

```
1. RESOLVE
     - load SiteGraph from L1 (cache hit) or L2 (storage.loadGraph) or fail.
     - look up Process by name → list of OpIds → list of Operations.

2. CURRENT-STATE
     - launch browser (Stagehand or Playwright).
     - if process has a known starting state: navigate to its url_template.
     - captureSnapshot, hash, look up StateId in graph.
     - if no match: try Jaccard fuzzy-match against known states.
     - if still no match: cold start — call Stagehand.act() on first instruction
       and let it fail/recover.

3. PLAN
     - core.planPath(current_state, first_op.from_state)
     - on no-path: return early with NoPathError.

4. EXECUTE
     - for each op in (planned-path + process.steps):
         acquire single-flight lock on (domain, op.id)
         start_t = now()
         try:
           Replayer.run(op, args)
         catch: SelfHealer.heal(op, args, max_heals)
         capture new snapshot, compare to op.validation_hash
         if mismatch: SelfHealer.heal(op, args, max_heals - 1)
         else: bump op.success_count, op.last_success_at

5. SELF-HEAL  (only on Replay failure or drift)
     - Stagehand.act(op.instruction)
     - update op.selector_xpath, recompute validation_hash, set reason='self-healed'
     - if heal fails max_heals times → quarantine: confidence *= 0.5, return error.

6. RETURN
     - structured RunResult.
     - flush L1 changes to L2 (write-back).
```

## Invariants

1. **Single-flight per op.** Two concurrent `runProcess` calls hitting the same
   `(domain, op_id)` queue, don't double-execute.
2. **Drift is data, not a crash.** A drifted edge gets healed and recorded; the
   user's request still succeeds (within max_heals budget).
3. **Write-back is best-effort.** If saveGraph fails, the run still returns
   success — we just lose the heal update. Logged as warning.
4. **Negative cache.** If `planPath` returns no-path, cache the (from, to)
   pair as unreachable for 5 min; subsequent calls fail fast.

## Dependencies

- **Imports from outside:** `@browserbasehq/stagehand`, `playwright`.
- **Imports from siteforge:** `core/`, `snapshot/`, `storage/`.
- **Imported by:** `cli/`, `emitters/` (when run is exposed as MCP tool).

## Errors

- `NoPathError` — planner found no route under confidence threshold.
- `LoginRequiredError` — session.json missing or expired.
- `SelfHealExhaustedError` — `max_heals` self-heals all failed.
- `ScreenNotRecognizedError` — current page doesn't match any state in graph.

## Performance

| Step | Cached | Cold (self-heal) |
|---|---|---|
| Snapshot | ~100ms | ~100ms |
| Plan | <1ms | n/a |
| Execute one op | ~200ms (XPath replay) | ~3-8s (LLM call + execute) |
| Drift check | ~50ms (hash) | n/a |

A 5-step process: ~1.5s when fully cached, ~25s when every step heals.

## Test strategy

- **Live test on a non-hostile site.** Reddit's `/r/<sub>/comments` URL pattern
  is stable enough for repeat tests.
- **Drift simulation test.** Manually inject a class-name change in DevTools,
  verify SelfHealer kicks in and updates the cached selector.
- **Concurrency test.** Spawn two `runProcess` calls on the same domain,
  verify single-flight serializes them.

## Open questions

1. **L1 cache scope.** Per-process? Per-thread? In-memory map per node process
   is fine for v1. If we ever go multi-process, switch to a tiny shared LRU.
2. **Self-heal LLM choice.** Use Stagehand's default? Or expose the model
   choice as an option? Stagehand supports OpenAI/Anthropic/Gemini — keep
   their default, override via env var.
3. **What "structured output" from a process looks like.** v1: return whatever
   the last step's extract() produced. Long-term: each Process declares its
   output schema via Zod, runtime validates.
4. **Args validation.** Right now `args` is `Record<string, unknown>`. Should
   we validate against `ArgSpec[]` from the Process? Cheap to add, surfaces
   bugs earlier. Yes, do it.

## Files

- `src/runtime/index.ts` — public exports.
- `src/runtime/replayer.ts` — Replayer class.
- `src/runtime/self-healer.ts` — SelfHealer class.
- `src/runtime/run-process.ts` — orchestrates the loop.
- `src/runtime/single-flight.ts` — locking primitive.
- `src/runtime/l1-cache.ts` — in-memory SiteGraph cache.
