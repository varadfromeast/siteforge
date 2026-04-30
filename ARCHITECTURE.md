# Architecture

This document describes the design of siteforge from first principles.

## Core abstraction: the SiteGraph

A site is modeled as a directed labeled multigraph:

- **States (nodes)** — logical screens identified by an atom-set hash. Two visits to "the same" page (e.g. Inbox with 5 vs 6 unread) collide on the same state id.
- **Operations (edges)** — interactions (click/fill/submit/navigate/hover/scroll) that transition between states.
- **Processes** — named BFS paths from entry states to common goals. Each process becomes a CLI subcommand.
- **Clusters** — Leiden communities of densely-connected states (e.g. messaging vs post-creation).

See `src/core/types.ts` for the full schema.

## First-principles parallels

| Concept | GitNexus (code) | CPU/web cache | Stagehand (browser) | siteforge |
|---|---|---|---|---|
| Atomic unit | Symbol (function/class) | Cache line | a11y atom (button/link) | Atom (role+name+attrs) |
| Group of units | File / cluster | Set / way | Page | State (atom-set hash) |
| Relationship | CALLS edge | Translation table | (none — Stagehand is stateless) | Operation edge |
| Hot path | Cypher on indexed graph | L1 hit | Cached XPath replay | Cached transition replay |
| Cold path | Re-parse with Tree-sitter | RAM/disk fetch | LLM via `act()` | LLM via Stagehand `act()` |
| Confidence | 0.95 same-file → 0.5 global | (n/a) | (none) | 0.95 dom-direct → 0.7 llm-untested |
| Drift signal | `git rev-parse HEAD` vs `meta.lastCommit` | ETag/Last-Modified | (none) | Atom-set hash mismatch on replay |
| Discovery | Leiden + scored-entry-point BFS | (n/a) | Reactive `agent()` loop | Same — Leiden + scored-entry BFS |
| Outputs | MCP resources + tools | Cache lookup API | act/extract/observe primitives | MCP resources + tools + per-site CLI |

The pattern transfers directly. **GitNexus solves "agents lose context navigating code." siteforge solves "agents lose context navigating UIs."**

## Modules

```
src/
  core/        # data model, hashing, BFS, canonicalization. zero I/O.
  storage/     # read/write SiteGraph JSON, atomic temp+mv, registry.
  snapshot/    # wraps Stagehand: page → atoms → state hash + kind.
  explorer/    # teach loop pipeline (SETUP → SNAPSHOT → CLASSIFY →
               #                       ENUMERATE → VALIDATE → CLUSTER → TRACE).
  runtime/     # run loop: PathPlanner (BFS), Replayer, SelfHealer.
  emitters/    # compile SiteGraph → CLI binary + MCP server + skill.md.
  cli/         # user-facing entry: siteforge teach, run, mcp.
```

Each module exposes a clean interface (its `index.ts`); internals are private.

## Indexing pipeline (7 phases, modeled after GitNexus's 12-phase DAG)

```
1. SETUP      — launch Stagehand (headed), load session.json or prompt manual login.
2. SNAPSHOT   — captureHybridSnapshot → { atoms, xpathMap, urlMap, url, screenshot }.
3. CLASSIFY   — canonicalize atoms → state_id (sha256). Assign kind (page/modal/...).
                Persist or merge with existing state.
4. ENUMERATE  — for each interactable atom, generate candidate Operation.
5. VALIDATE   — execute candidates (single-flight, throttled, depth-bounded).
                Snapshot resulting page, write Operation edge with validation_hash.
6. CLUSTER    — Leiden over the edge graph → cluster_id per state.
7. TRACE      — score entry points, BFS from each, name top processes,
                generate skill.md per cluster.
```

## Execution path (when an agent invokes a CLI command)

```
1. RESOLVE        — look up process or target state in graph.
2. CURRENT-STATE  — snapshot current page → atoms → hash → match.
3. PLAN           — BFS from current state to target. Filter by confidence.
4. EXECUTE        — for each op: replay XPath via Stagehand.takeDeterministicAction,
                    snapshot new state, compare to validation_hash.
5. SELF-HEAL      — on drift or Playwright exception: call Stagehand.act() to
                    re-resolve, write back updated edge.
6. RETURN         — structured result + which ops self-healed.
```

## Cache strategy

| Concept | Mechanism |
|---|---|
| L1 hot | `Map<domain, SiteGraph>` in-memory, LRU evict after 5min idle |
| L2 cold | JSON on disk per site, write-back batched |
| L3 origin | Live Stagehand `act()` (LLM call) |
| Drift detection | `validation_hash` on every edge — observed vs expected atom-set hash |
| Single-flight | Lock on `(domain, state_id, op_id)` during exploration AND execution |
| Negative cache | "intent X unreachable from state S" cached with 5min TTL |
| Stale-while-revalidate | Serve cached path immediately, validate observed state in background |

## Storage layout

```
~/.siteforge/
  registry.json                      # global: list of indexed sites
  sites/
    instagram.com/
      graph.json                     # SiteGraph (states, edges, processes, clusters)
      skill.md                       # auto-generated agent doc
      session.json                   # Playwright storageState (manual login persisted)
      meta.json                      # { last_indexed, schema_version, drift_score }
      screenshots/<state-id>.png     # optional
      logs/2026-04-30.log
```

JSON for v1. Switch to SQLite if any site exceeds ~5k states. (GitNexus uses LadybugDB but at this scale, JSON is enough.)

## What we explicitly inherit from Stagehand vs build above

| Layer | Source |
|---|---|
| Browser control | Stagehand → Playwright |
| a11y tree + xpathMap | Stagehand `captureHybridSnapshot` |
| XPath action execution | Stagehand `takeDeterministicAction` |
| LLM-driven action | Stagehand `act()` |
| **State concept** | **NEW (siteforge)** |
| **Multi-page planner** | **NEW (siteforge)** |
| **Proactive exploration** | **NEW (siteforge)** |
| **Drift detection / write-back** | **NEW (siteforge)** |
| **Leiden clustering + processes** | **NEW (siteforge, GitNexus pattern)** |
| **MCP resources/tools split** | **NEW (siteforge, GitNexus pattern)** |

## Risks (known)

1. **State identification fragility.** Atom-set hashing is heuristic. Pages with infinite content lists may collide too aggressively or not enough.
2. **Anti-bot detection on hostile sites** (Instagram, etc.). Throttling helps but doesn't eliminate.
3. **Graph drift.** Sites change; cached transitions go stale. Drift detection is the defense.
4. **Exploration completeness.** Bounded DFS will miss deep features. Re-explore on demand is the mitigation.
5. **License contagion.** We use Stagehand (MIT) and graphology (MIT). Avoid AGPL deps (Skyvern, Hyperbrowser) for OSS distribution safety.
