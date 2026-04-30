# Interface — `emitters/`

Compile a SiteGraph into agent-facing artifacts: a CLI binary, an MCP server,
and a per-cluster `skill.md`.

## Purpose

The SiteGraph is internal data. Agents need surfaces they can actually call:
- A CLI binary (`instagram-cli post-photo --image x.jpg`) — for shell-based
  agents (Claude Code, Codex CLI).
- An MCP server (`site://instagram.com/process/post-photo`) — for MCP-aware
  clients (Cursor, Claude Desktop).
- A `skill.md` doc — markdown the agent reads to know what's available.

These three are different shapes of the same underlying data; one SiteGraph
emits all three.

## Public surface

```ts
interface CliEmitResult {
  binary_path: string
  commands: Array<{ name: string; description: string; args: string[] }>
}

interface McpServerHandle {
  url: string
  close: () => Promise<void>
}

emitCli(graph: SiteGraph): Promise<CliEmitResult>
startMcpServer(domain: Domain): Promise<McpServerHandle>
emitSkillMd(graph: SiteGraph): Promise<string>     // returns the markdown text
```

## CLI emitter

Emits a Node script at `~/.siteforge/bin/<domain>-cli`. The script imports
`siteforge/runtime` and dispatches the requested process.

**Generated structure:**
```
~/.siteforge/bin/instagram-cli      # symlink target executable
~/.siteforge/bin/.commands.json     # list of subcommands per domain
```

**Subcommand mapping:** one CLI subcommand per `Process` in the graph. Args
come from `Process.args` (via Commander).

Example: a Process named `search-user` with `args: [{ name: 'username', type: 'string', required: true }]`
becomes:
```
$ instagram-cli search-user --username someone
```

## MCP server emitter

Spins up an MCP server using `@modelcontextprotocol/sdk`. Exposes:

**Resources** (cheap reads, ~150-500 tokens each):
- `site://<domain>/context` — overview, state count, top processes, drift score
- `site://<domain>/states` — list all states with kind, label, cluster
- `site://<domain>/state/<id>` — atoms, screenshot, outgoing transitions
- `site://<domain>/process/<name>` — BFS path step-by-step
- `site://<domain>/clusters` — Leiden communities with cohesion

**Tools** (expensive, do work):
- `find_path(domain, from_state, to_intent)` — BFS planner
- `run_action(domain, intent, args)` — execute on live browser
- `explore(domain, depth, time_budget)` — re-index in background
- `validate(domain)` — drift check across known states

**This split is GitNexus's exact pattern** — cheap structural reads vs
expensive computational tools.

## skill.md emitter

Renders a single markdown file with one section per Cluster. Format mirrors
GitNexus's per-cluster `SKILL.md`:

```md
---
name: instagram
description: Use when working with Instagram. Top processes: post-photo, search-user, view-profile, send-dm.
---

# instagram

Indexed at: 2026-04-30. Drift score: 0.04. Last validated: 2026-04-30.

## Workflow
1. READ site://instagram.com/context → overview & staleness
2. READ site://instagram.com/clusters → which cluster solves my task?
3. READ site://instagram.com/process/<name> → step-by-step path
4. CALL run_action({ domain: "instagram.com", intent: "<process-name>", args: {...} })

## Cluster: messaging (cohesion 0.81)
Processes:
- send-dm(username: string, body: string)
- read-thread(thread_id: string) → messages[]
- archive-thread(thread_id: string)

## Cluster: post-creation (cohesion 0.74)
Processes:
- post-photo(image: file, caption?: string)
- post-reel(video: file, caption?: string, audio?: string)
- post-story(image: file)

## Resources
| Resource | Tokens |
|---|---|
| site://instagram.com/context | ~150 |
| site://instagram.com/state/<id> | ~300 |
| site://instagram.com/process/<name> | ~200 |
```

## Invariants

1. **Idempotent.** Re-emitting from the same SiteGraph produces byte-identical
   output (subject to deterministic JSON ordering).
2. **No graph mutation.** Emitters read SiteGraph but never modify it.
3. **Schema-versioned.** A graph from a future schema_version refuses to emit
   (clear error).

## Dependencies

- **Imports from outside:** `@modelcontextprotocol/sdk`, `commander` (for the
  CLI script template).
- **Imports from siteforge:** `core/`, `runtime/`, `storage/`.
- **Imported by:** `cli/`.

## Errors

- `emitCli` throws if `binary_path` parent isn't writable.
- `startMcpServer` throws if the requested port is in use; falls back to an
  ephemeral port if `port` is unspecified.

## Performance

- `emitCli`: <100ms. Just templates a small JS file.
- `emitSkillMd`: <50ms. Templating only.
- `startMcpServer`: ~200ms cold start.

## Test strategy

- **Snapshot tests** for CLI script and skill.md output (golden files).
- **MCP integration test:** start server, make a `tools/list` call, verify
  expected tools appear.

## Open questions

1. **CLI installation.** v1: scripts live in `~/.siteforge/bin/`. User adds to
   PATH manually. v2: optional symlink to `/usr/local/bin/`?
2. **MCP transport.** v1: stdio (works with all major MCP clients). v2: also
   expose an HTTP endpoint for browser-based clients.
3. **skill.md scope.** v1: one big file. Could split per cluster (GitNexus
   does that — one SKILL.md per Leiden cluster). Open to either.
4. **Process naming.** TRACE phase calls an LLM to name processes. What if the
   LLM makes a bad name? v1: user can edit graph.json manually to rename.

## Files

- `src/emitters/index.ts` — public exports.
- `src/emitters/cli.ts` — CLI binary emitter.
- `src/emitters/mcp.ts` — MCP server emitter.
- `src/emitters/skill-md.ts` — skill.md emitter.
- `src/emitters/templates/` — CLI script template, skill.md template.
