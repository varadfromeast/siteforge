# Site Cartographer Plan

## Thesis

The explorer should not be a free-roaming browser agent. It should be a
bounded **site cartographer**: a harness that safely drives a real browser,
captures states and transitions, and lets reasoning plug in only where a
decision is needed.

The output is not "the agent browsed the site." The output is a durable,
trace-backed `SiteGraph` that can later be compiled into CLI and MCP tools.

```
user prompt + site profile
        ↓
cartographer harness
        ↓
Playwright actions + snapshot captures
        ↓
stable atoms + observed transitions
        ↓
SiteGraph
        ↓
CLI / MCP / skill emitters
```

## Is This A Harness?

Yes. In this project, a harness is the controlled runner around browser
automation. It is responsible for:

- connecting to or launching a browser
- preserving auth/session without exposing credentials to the model
- capturing before/after screenshots and atom snapshots
- enforcing depth, time, branch, and throttle limits
- deciding whether an action is safe to execute
- executing actions through Playwright
- verifying the resulting state
- recording evidence for every accepted or rejected transition

Reasoning can help the harness decide **what to try next**, but the harness
keeps authority over safety and execution.

## Why Not A Pure Agent?

A pure browser agent is too unconstrained for map building:

- it can wander without producing reusable graph structure
- it may click destructive actions
- it may solve one task but fail to build a reusable map
- it mixes exploration, intent execution, and validation into one opaque loop

The cartographer should instead be boring, bounded, and evidence-first.
Its job is to discover stable structure, not complete arbitrary user tasks.

## Promptable Cartography

Users should be able to guide exploration with a prompt:

```bash
siteforge explore https://example.com \
  --prompt "Map login, search, saved items, and checkout up to the payment step. Do not place an order."
```

The prompt is not an instruction to click freely. It becomes a scoped
exploration contract:

- target areas to prioritize
- flows the user cares about
- boundaries and taboos
- safe dummy values for forms
- success criteria for coverage

Example prompt interpretation:

```json
{
  "priorities": ["login", "search", "saved items", "checkout"],
  "stop_before": ["place order", "payment submit"],
  "safe_inputs": {
    "search": "shirt",
    "email": "test@example.com"
  },
  "dangerous_actions": ["buy", "place order", "delete", "publish"],
  "success": "capture reusable states and transitions for each requested flow"
}
```

## Core Architecture

### 1. Browser Harness

Owns Playwright/CDP browser control.

Responsibilities:

- attach to existing CDP browser when available
- otherwise launch headed browser
- preserve real viewport (`viewport: null`) when attached
- let user log in manually
- save/reuse local session
- expose safe primitives:
  - `goto(url)`
  - `click(atomRef)`
  - `fill(atomRef, value)`
  - `press(key)`
  - `scroll(direction)`
  - `backtrack(anchor)`

The browser harness does not reason. It executes validated actions.

### 2. Snapshot Harness

Turns browser state into durable evidence.

For every important moment:

- capture screenshot
- capture full accessibility tree
- extract raw atoms
- canonicalize atoms
- reduce to surface atoms
- classify state kind
- hash canonical atoms and surface atoms
- persist capture JSON

This is the part already prototyped by:

- `examples/map-instagram.ts`
- `examples/inspect-live.ts`
- `examples/cover-instagram.ts`

### 3. Map Recorder

Records the graph:

- `State` node from the current surface
- `Operation` edge from before/after states
- action metadata
- confidence
- validation hash
- screenshot/capture paths
- failure information

The recorder should never store 0-atom loading shells as real states.
It should retry capture while canonical/surface atoms are empty.

### 4. Policy Layer

The policy decides candidate actions. This is where reasoning belongs.

```ts
export interface ExplorerPolicy {
  proposeActions(input: ExplorerContext): Promise<CandidateAction[]>;
}
```

There should be multiple policies:

- `RulePolicy` — deterministic safe defaults
- `PromptPolicy` — uses the user's cartography prompt
- `LlmPolicy` — uses an LLM to rank/propose actions
- `HybridPolicy` — rules first, LLM for ambiguity/prioritization

The policy proposes. The harness validates.

### 5. Safety Gate

Every candidate action passes through safety validation before Playwright
touches the browser.

Reject by default:

- delete
- remove
- unfollow
- block
- report
- buy
- checkout
- place order
- publish
- post
- send
- submit with non-empty user content
- upload
- payment
- account/security changes

Allow with constraints:

- open navigation links
- open tabs
- open/close menus
- open/close modals
- search with configured dummy query
- fill harmless fields with configured dummy values
- proceed through checkout only up to configured stop boundary

For risky actions, record a skipped candidate:

```json
{
  "status": "skipped",
  "reason": "dangerous_action",
  "atom": "button: place order"
}
```

Skipped edges are useful. They tell the emitter not to expose a tool unless
the user later validates it intentionally.

## Explorer Loop

High-level algorithm:

```txt
SETUP
  connect/launch browser
  user logs in manually if needed
  create anchor state

SNAPSHOT
  capture current state
  persist evidence

ENUMERATE
  policy proposes candidate actions from surface atoms
  safety gate filters/ranks candidates

VALIDATE
  for each selected candidate:
    restore current state
    execute action
    wait for settle
    capture result state
    record edge or failure
    backtrack

FRONTIER
  enqueue newly discovered states
  stop at depth/time/action budget

TRACE
  group paths into named flows
  optionally ask LLM to name processes

SAVE
  persist SiteGraph
```

## Candidate Action Shape

```ts
export interface CandidateAction {
  id: string;
  from_state: StateId;
  atom: Atom;
  op_type: 'click' | 'fill' | 'submit' | 'navigate' | 'hover' | 'scroll';
  instruction: string;
  args?: Record<string, unknown>;
  expected_result?: string;
  risk: 'safe' | 'needs_confirmation' | 'dangerous';
  source: 'rule' | 'prompt' | 'llm' | 'user';
  priority: number;
}
```

## Explorer Context Shape

```ts
export interface ExplorerContext {
  domain: string;
  url: string;
  user_prompt?: string;
  state: State;
  surface_atoms: Atom[];
  recent_edges: Operation[];
  visited_surface_ids: string[];
  depth: number;
  budgets: {
    max_depth: number;
    max_actions_per_state: number;
    remaining_ms: number;
  };
  safety_profile: SafetyProfile;
}
```

## LLM Reasoning Contract

The LLM should only produce structured candidate actions. It should not
directly operate the browser.

Prompt shape:

```txt
You are a site cartographer policy. Your job is to propose safe exploration
actions, not complete the user's task.

User cartography goal:
<prompt>

Current state:
<url, kind, label>

Surface atoms:
<atoms>

Already visited:
<short edge summary>

Return JSON candidate actions. Mark risky/destructive actions. Prefer actions
that discover navigation structure and reusable flows.
```

The harness then validates JSON against a schema and applies safety rules.

## Auth Model

Use two separate auth concepts:

1. **Website auth**  
   The user logs in manually in headed Chrome. The local browser profile or
   storage state is reused. The LLM should never see passwords or OTPs.

2. **Reasoning auth**  
   If `LlmPolicy` is enabled, it uses an API key from the local environment.
   It only receives URL/state/atoms/redacted text, not secrets.

OAuth for the target website may be part of manual login, but the explorer
should not own the website OAuth flow in v1.

## Prompt Examples

### SaaS App

```txt
Map dashboard navigation, project creation up to the final submit step,
settings pages, and user invite screens. Do not create or delete real data.
Use "Test Project" where a harmless draft name is required.
```

### Ecommerce

```txt
Map search, product detail, add to cart, cart editing, and checkout up to
payment. Do not place an order or enter real payment information.
Use "backpack" for search.
```

### Instagram-like Site

```txt
Map home feed, search, profile tabs, direct inbox, direct thread composer,
reels viewer, and comment composer. Do not follow, like, post, or send public
comments. Sending a DM is only allowed if I explicitly confirm.
```

## Relationship To Current Examples

Current examples are prototype pieces:

- `cover-instagram.ts` is a hand-written `RulePolicy` plus browser harness.
- `map-instagram.ts` is the map recorder and transition observer.
- `inspect-live.ts` is a visual evidence sampler.
- `surface.ts` is the evolving state identity filter.

The real explorer should combine these:

```txt
cover-instagram.ts       map-instagram.ts       inspect-live.ts
        \                    |                    /
         \                   |                   /
          └── src/explorer cartographer harness ┘
```

## Phased Implementation Plan

### Phase 1 — Generalize The Current Harness

- Move shared capture logic out of examples.
- Create `ExplorerRun`.
- Create `BrowserHarness`.
- Create `MapRecorder`.
- Create `RulePolicy`.
- Support user prompt as metadata, but do not call LLM yet.

Goal: run deterministic safe coverage for any configured site.

### Phase 2 — Prompt-Aware Rule Policy

- Parse user prompt into:
  - priorities
  - safe dummy values
  - stop boundaries
  - dangerous verbs
- Use rules to prioritize matching atoms.
- Still no LLM required.

Goal: user can guide exploration without giving free-form browser control.

### Phase 3 — LLM Policy

- Add `LlmPolicy`.
- It receives redacted `ExplorerContext`.
- It returns structured `CandidateAction[]`.
- Safety gate remains mandatory.
- Log all LLM proposals and rejections.

Goal: reason over unfamiliar sites while preserving harness control.

### Phase 4 — Process Discovery

- Use observed paths to propose named processes.
- LLM may help name flows:
  - `open_direct_inbox`
  - `search_products`
  - `edit_profile`
- User can approve which processes become emitted tools.

Goal: transform raw graph paths into human-facing tool names.

### Phase 5 — Compiler / Emitter

- Compile `SiteGraph` into CLI subcommands and MCP tools.
- Each emitted tool has:
  - required args
  - graph path
  - selectors/instructions
  - validation hashes
  - fallback instructions

Goal: future agents use tools, not exploratory browsing.

## Non-Goals For V1

- fully autonomous open-ended browsing
- bypassing site anti-automation defenses
- solving arbitrary user tasks during exploration
- submitting destructive actions
- handling credentials with the LLM
- building a universal semantic model of every website

## Success Criteria

The explorer is working when:

- a user can provide a URL and cartography prompt
- the harness discovers stable states and transitions within a bounded budget
- skipped dangerous actions are recorded, not clicked
- repeated runs merge states instead of duplicating them
- the resulting `SiteGraph` can emit at least one reliable CLI/MCP tool
- screenshots and captures explain every emitted tool's origin

## Strong Opinion

Build the harness first. Then plug in reasoning.

The product is not an agent that browses websites. The product is a system
that turns one careful exploration pass into durable tools for future agents.
