# Ubiquitous Language

This document defines every domain term used across siteforge. The goal is the
DDD principle: one term, one meaning, used consistently in code, docs, and
discussion.

When you find ambiguity in a PR, fix it here first.

---

## Core domain

### Atom
The smallest interactable affordance on a page. A button, link, input, select,
textarea, etc. Identified by `(role, accessible_name, stable_attrs)`.

Atoms are leaves of the page's accessibility tree. We do **not** call them
"elements" because that conflates with DOM nodes — most DOM nodes are not
Atoms (e.g., a `<div>` wrapper).

> **Source vocabulary:** GitNexus calls its leaf "Symbol" (function/class).
> Stagehand calls them "elementId" (frame-encoded id mapped to an XPath).
> We deliberately use a new term to keep our model decoupled from either.

### State
A logical screen of a site. The Inbox is a State. The Compose modal is a State.
Two visits to the same logical screen — even with different content (5 vs 6
unread) — produce the same `StateId`.

A State is **identified** by the hash of its canonicalized atom-set, not by URL.
Two URLs can be the same State (e.g. `/inbox?page=1` and `/inbox?page=2` if the
chrome around the content list is identical).

### StateId
SHA-256 of a canonicalized atom-set. The content-addressed identity of a State.

### StateKind
A coarse classification of a State: `page | modal | panel | list | form | error`.
Used by the planner to decide which transitions are sensible (e.g. you don't
"submit" a list).

### Operation
A single transition between two States. Executing an Operation moves the browser
from `from_state` to `to_state` deterministically (modulo drift). Identified by
synthetic `OpId`.

> **Distinction:** an Operation is **not** an action verb on a single element.
> It's a typed edge with a known endpoint (the destination State) recorded after
> validated execution. A click that doesn't change state isn't an Operation.

### OpType
The verb of an Operation: `click | fill | submit | navigate | hover | scroll`.

### ArgSpec
Parameter declaration on an Operation. e.g. a `fill` op takes a `string` named
"username". When an Operation appears inside a Process, its ArgSpecs propagate
upward as the Process's ArgSpecs.

### Process
A named, ordered list of OpIds forming a user journey from an entry State to a
target State. Each Process becomes a CLI subcommand.

> **Source vocabulary:** GitNexus uses "Process" for execution flows traced from
> entry points. We use the exact same term — same meaning, different substrate.

### Cluster
A Leiden community of densely-connected States. e.g. {Inbox, Thread, Compose}
form a "messaging" cluster.

> **Source vocabulary:** GitNexus uses "Community" with the same Leiden algorithm.
> We rename to "Cluster" to avoid clashing with "community" as in OSS community.

### SiteGraph
The full model of a site. One per `Domain`. Persisted as a single `graph.json`.

### Domain
The site identifier. e.g. `instagram.com`. Used as the primary key for
SiteGraphs and Sessions.

### Registry
The global index at `~/.siteforge/registry.json` listing every site indexed on
this machine. Maps `Domain → RegistryEntry` (storage path + stats + freshness).

---

## Operations vocabulary

### Snapshot
The captured a11y tree of a page at one moment, plus xpath/url maps. Includes
both raw form (for debugging) and parsed Atom[] form (what we hash).

### Canonicalize
Take a raw atom list and produce a deterministic, noise-stripped sequence.
Removes generated class names, dynamic counters, timestamps. The same logical
page must canonicalize to the same sequence on every visit.

### Hash
SHA-256 over canonical JSON. Used for `StateId`, `validation_hash`, and any
content-addressing.

### ValidationHash
A field on every Operation. Stores the hash of the expected `to_state.atoms`.
On replay, after executing the op, we hash the observed page and compare. A
mismatch = drift; triggers SelfHealer.

> **First-principles parallel:** this is the DOM-as-body, atom-set-as-ETag analog
> of HTTP's conditional GET / Last-Modified validation.

### Drift
The condition where a cached Operation's `validation_hash` no longer matches the
observed atom-set after replay. Caused by site changes (DOM updated, layout
shifted, role removed). Detected per-replay; recorded in `drift_score`.

### DriftScore
Per-SiteGraph metric: fraction of recent replays that hit drift. Surfaced in
`SiteGraphMeta`. High drift → user prompted to re-explore.

### Replay
Execute a cached Operation by passing its `selector_xpath` and `op_type` to
`takeDeterministicAction`. No LLM call.

### Self-heal
When Replay fails (Playwright exception or drift), call Stagehand's `act()`
with the cached `instruction` to re-resolve a selector, retry, and on success
write the updated Operation back to the SiteGraph.

### Single-flight
A locking primitive used during exploration and execution to prevent two
concurrent agents from re-exploring or executing the same `(domain, state_id, op_id)`
tuple. Second caller waits on the first's result.

### NegativeCache
A short-TTL record asserting "no path from State S to Intent I". Prevents the
explorer from repeatedly trying paths it just learned don't work. TTL: 5
minutes by default; intentionally shorter than positive cache because sites
add features.

### Teach loop
The user-initiated indexing pipeline (`siteforge teach <url>`). Phases:
SETUP → SNAPSHOT → CLASSIFY → ENUMERATE → VALIDATE → CLUSTER → TRACE.
Output: an updated SiteGraph on disk + emitted CLI/MCP/skill.md.

### Run loop
The execution pipeline invoked when an agent calls a CLI subcommand or MCP tool.
Phases: RESOLVE → CURRENT-STATE → PLAN → EXECUTE → SELF-HEAL → RETURN.

---

## Algorithms vocabulary

### Frontier (BFS)
The set of States discovered but not yet fully explored. Used during the
VALIDATE phase: explorer pulls from frontier, expands one State, pushes
newly-discovered neighbors onto frontier. Bounded by `max_depth`.

### EntryPoint
A State scored as a likely starting point for a user journey. Heuristics:
`/` URL, `main` role with brand-name accessible-name, high out-degree, low
in-degree.

> **Source vocabulary:** identical to GitNexus's entry-point scoring (which
> uses callRatio, isExported, framework decorators).

### Cohesion
The Leiden-derived strength of a Cluster. 0..1. Higher = more internal edges
relative to external. Used to decide which clusters are worth turning into
named Processes.

### Confidence
Per-Operation reliability score. 0..1.
- `dom-direct` (0.95): atom from accessibility tree directly.
- `llm-inferred-validated` (0.85): LLM proposed it, executed successfully.
- `llm-inferred-untested` (0.7): LLM proposed it, not yet executed.
- `self-healed` (0.8): updated after a drift event; provisional until next success.

> **Source vocabulary:** mirrors GitNexus's tier confidence
> (same-file 0.95 → import-scoped 0.9 → global 0.5).

---

## Cache vocabulary (mapped to first principles)

### L1 (hot, in-memory)
The `Map<Domain, SiteGraph>` cache in the runtime. LRU evict after 5 min idle.

### L2 (cold, on disk)
JSON files at `~/.siteforge/sites/<domain>/graph.json`. The source of truth
between sessions.

### L3 (origin)
Live LLM call via Stagehand `act()`. The slow path; only on miss or drift.

### Write-back
Storage strategy: changes accumulate in L1, flushed to L2 on session end or
every N changes. Contrasts with write-through (per-change disk write — too
slow for our case).

### Stale-while-revalidate
Serve a cached path immediately; validate observed state in background; if
validation fails, mark edges drifted but the user got their answer.

---

## Out-of-scope terms (deliberately not used)

| We don't say | Why |
|---|---|
| "Element" | Conflates with DOM. Use `Atom`. |
| "Page" | Ambiguous (is it URL? logical screen?). Use `State` and be explicit about kind. |
| "Action" | Stagehand's term — we use `Operation` to keep our model independent. |
| "Workflow" | Skyvern's term — we use `Process`. |
| "Skill" | Anthropic's overloaded term — we use `Process` for the executable, `skill.md` for the doc. |
| "Crawl" | Implies SEO-style URL discovery — we say `explore` because we discover atoms and transitions. |

---

## Naming conventions

- Types are `PascalCase`: `State`, `Operation`, `SiteGraph`.
- IDs are `<Type>Id`: `StateId`, `OpId`, `ClusterId`.
- Function names are `camelCase` and verb-led: `canonicalizeAtoms`, `planPath`.
- File names are `kebab-case`: `canonicalize.ts`, `plan-path.ts`.
- Module folders are nouns: `core/`, `storage/`, `snapshot/`.
