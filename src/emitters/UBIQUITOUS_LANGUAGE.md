# `emitters/` — local language

Compile a SiteGraph into agent-facing artifacts: a CLI binary, an MCP server,
and a `skill.md` doc.

## Intent in one paragraph

`emitters/` translates the SiteGraph (internal data) into surfaces agents can
actually call. One graph emits three shapes of the same information: a per-site
CLI binary (for shell-using agents), an MCP server (for MCP-aware clients), and
a markdown skill doc (for agents to discover what's available). All three are
read-only views of the graph — emitters never mutate it.

## Local vocabulary

### CLI binary
A generated Node script at `~/.siteforge/bin/<domain>-cli`. It imports
`siteforge/runtime` and dispatches the requested process. One subcommand per
`Process` in the graph. Args from `Process.args` via Commander.

### MCP server
A `@modelcontextprotocol/sdk` server exposing the SiteGraph as **resources**
and **tools** (the GitNexus split):
- **Resources** = cheap reads (`site://<domain>/context`, `/states`, `/state/<id>`,
  `/process/<name>`, `/clusters`). ~150-500 tokens each.
- **Tools** = expensive operations (`find_path`, `run_action`, `explore`,
  `validate`).

### skill.md
A single markdown file at `<site_dir>/skill.md` with one section per Cluster
(Louvain community). Mirrors GitNexus's per-cluster `SKILL.md` shape: YAML
frontmatter (`name`, `description`) + workflow checklist + token-budgeted
resource table. Agents read this to discover the site's capabilities.

### resource (MCP)
A read-only MCP endpoint identified by URI (`site://...`). Returns small
structured data. Cheap to call; meant for agents to gather context cheaply
before deciding which tool to invoke.

### tool (MCP)
A callable MCP endpoint with a JSON Schema for inputs. Performs work
(navigates the browser, runs queries). Expensive. Agents should call these
sparingly.

### subcommand
The CLI counterpart to an MCP tool. `instagram-cli send-dm --username foo
--body "hi"`. Maps 1:1 to a `Process` in the graph.

### emit
The act of generating one of the three artifacts from a graph. Emitters are
pure-function-shaped: same SiteGraph in → same artifact bytes out
(deterministic).

### cluster section
A region of `skill.md` describing one Louvain cluster — its label, its
processes, their args, and the cohesion score. Helps agents pick the right
cluster for a task without reading the whole graph.

## Not in this module

- ❌ Mutating the graph (we're read-only views)
- ❌ Running the explorer (we expose it as a tool but the impl is `explorer/`)
- ❌ Running processes (we wrap `runtime/runProcess` but don't reimplement)
- ❌ Loading the graph (we just call `storage/loadGraph`)
- ❌ Hashing or planning (that's `core/`)

## Key invariants

1. **Idempotent.** Same `SiteGraph` → byte-identical `skill.md`, byte-identical
   CLI script. (Subject to deterministic JSON ordering.)
2. **No graph mutation.** Emitters are read-only over the graph. Side effects
   are confined to disk writes (CLI binary, skill.md) and process startup
   (MCP server).
3. **Schema-versioned.** Refuses to emit from a future-`schema_version` graph
   with a clear error pointing at `siteforge migrate`.
4. **Cheap-resource discipline.** MCP resources stay under 500 tokens each.
   If a resource grows past that, it's redesigned (often by adding a new
   resource that returns a slice).
5. **Bin-path safety.** CLI binaries land in `~/.siteforge/bin/`, never
   in system paths. Adding to `$PATH` is the user's explicit choice.
