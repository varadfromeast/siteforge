# Interface — `explorer/`

The teach loop. Proactively crawls a site and populates a SiteGraph.

## Purpose

Pay the LLM exploration cost **once per site** so that future agents don't
have to. Walk the site systematically, record states and transitions, run
clustering, name top processes.

This is the cache-warming half of the project. Without it, siteforge is just
Stagehand-with-a-graph-format. With it, agents can navigate sites they've
never seen by traversing the cached graph.

## Public surface

```ts
interface ExploreOptions {
  max_depth?: number              // default 3
  max_branching?: number          // default 8 ops per state
  time_budget_ms?: number         // default 5 minutes
  throttle_ms?: { min: number; max: number }   // default 1000-3000
  skip_post_processing?: boolean  // skip CLUSTER + TRACE for fast tests
  headless?: boolean              // default false (so user can watch)
}

interface ExploreResult {
  graph: SiteGraph
  stats: {
    states_discovered: number
    edges_recorded: number
    operations_executed: number
    operations_failed: number
    elapsed_ms: number
  }
}

explore(domain: Domain, start_url: string, options?: ExploreOptions): Promise<ExploreResult>
```

## Pipeline (DAG, modeled after GitNexus's 12 phases)

```
1. SETUP
     - launch Stagehand (headed, unless options.headless)
     - load session.json (storage.loadSession) or prompt manual login
     - on successful login, save session

2. SNAPSHOT
     - captureSnapshot of starting URL
     - normalize URL (strip query params known to be ephemeral: utm_*, ?ref=)

3. CLASSIFY
     - canonicalize atoms → state_id
     - classify kind
     - persist or merge into graph (state already exists? bump last_seen)

4. ENUMERATE
     - for each interactable atom, generate a candidate Operation:
         id = sha1(state_id + atom.role + atom.accessible_name)[:8]
         op_type = inferred from role (button → click, textbox → fill, etc.)
         instruction = "click the {accessible_name}" / "fill the {accessible_name} field"
         args_schema = inferred (textbox → string arg, select → options enum)
         confidence = 0.7 (untested)
         reason = 'llm-inferred-untested'

5. VALIDATE  (the slow phase — bounded)
     - for each candidate (BFS, depth-limited):
         acquire single-flight lock on (domain, state_id, op_id)
         throttle (jittered min..max)
         execute via Stagehand.takeDeterministicAction
         captureSnapshot of resulting page
         if same atom-set hash → skip (no-op)
         else → write Operation edge with validation_hash = hash(new state atoms)
         backtrack: page.goBack() OR navigate to a known anchor state

6. CLUSTER  (post-processing)
     - build undirected graph from edges (graphology)
     - run Leiden (graphology-communities-leiden)
     - assign cluster_id to each state
     - compute cohesion per cluster

7. TRACE  (post-processing)
     - score states as entry-point candidates (URL "/", main role, high out-degree)
     - BFS from each entry point, max depth 6, max branching 4
     - dedupe paths
     - LLM-name top N processes (e.g. "post-photo", "search-user")
     - generate skill.md per cluster (delegated to emitters/)
```

## Invariants

1. **Bounded work.** Every phase respects `time_budget_ms`. The explorer is
   never an infinite crawler.
2. **Resumable.** If the explorer is killed mid-VALIDATE, the partial graph is
   saved; next run picks up from where it left off (uses `last_seen` timestamps).
3. **Idempotent.** Running explore() twice on the same domain extends the graph,
   doesn't duplicate states or operations.
4. **Anti-detection-aware.** Throttling is enforced even on fast hardware. Min
   throttle 1s.
5. **No clicks on dangerous things.** Submit buttons in forms with non-empty
   inputs are skipped (might post a real comment, send a real DM).

## Dependencies

- **Imports from outside:** `playwright`, `@browserbasehq/stagehand` (for
  `act()` on selector misses), `graphology`, `graphology-communities-leiden`.
- **Imports from siteforge:** `core/`, `snapshot/`, `storage/`.
- **Imported by:** `cli/`, `emitters/` (when explore is exposed as MCP tool).

## Errors

- Login timeout (user doesn't log in within N minutes) → throws `LoginTimeoutError`.
- Time budget exceeded → returns early with whatever was discovered (NOT an error).
- LLM API key missing for naming step → skips TRACE phase, logs warning.

## Performance

- A single state visit: ~3-8 seconds (snapshot + classify + persist).
- Full explore at depth 3 on a typical site: ~5-10 minutes.
- LLM cost (TRACE phase only): ~$0.10 per explore (one call to name top processes).
- Storage write: at end of session, single atomic write.

## Test strategy

- **Live probe** for individual phases:
  - SETUP + SNAPSHOT + CLASSIFY tested via the v0.0.2 probe.
  - ENUMERATE tested by counting candidate operations on a logged-in IG home.
  - VALIDATE tested on a sandbox site (no anti-bot) to verify state transitions
    are recorded correctly.
- **Regression test:** save-then-load a partial graph, run explore again,
  verify states aren't duplicated.
- **Anti-flake guard:** explore must produce identical (or extended-but-not-changed)
  graphs on repeated runs of the same site.

## Open questions

1. **Login detection.** v1 prompts the user to press ENTER after manual login.
   Better: detect the URL change away from `/accounts/login/` and proceed
   automatically.
2. **Backtracking.** v1 uses `page.goBack()`. Some sites break on back. Better:
   maintain a list of anchor states (home, profile) and navigate to nearest one.
3. **State-collision threshold.** What if two pages produce *almost* the same
   atom-set hash (one extra atom)? Right now they get separate state_ids. Should
   we add fuzzy matching with Jaccard distance?
4. **Form filling during VALIDATE.** v1 doesn't fill real values into form
   inputs (just clicks them to focus). To fully discover post-submit states,
   we'd need synthetic inputs. Risk: actually submits things. Defer.

## Files

- `src/explorer/index.ts` — public exports.
- `src/explorer/setup.ts` — SETUP phase (Stagehand init, session load).
- `src/explorer/enumerate.ts` — ENUMERATE phase (atoms → candidate operations).
- `src/explorer/validate.ts` — VALIDATE phase (the slow loop).
- `src/explorer/cluster.ts` — CLUSTER phase (Leiden wrapper).
- `src/explorer/trace.ts` — TRACE phase (entry-point scoring + BFS).
