# siteforge

> Build a per-site CLI + MCP server from any website. Proactive exploration, state-graph cache, deterministic replay with self-heal.

**Status:** early research project. Not production-ready. Use throwaway accounts only.

## What it does

`siteforge` indexes a website into a state-machine graph, then compiles that graph into a per-site CLI binary and MCP server. Once indexed, an AI agent can navigate the site by traversing cached transitions instead of asking an LLM what to click on every step.

```
$ siteforge teach instagram.com
  → opens browser, prompts you to log in manually
  → agent proactively explores (depth-3, 5 min budget)
  → emits ~/.siteforge/sites/instagram.com/{graph.json, skill.md, session.json}
  → generates an instagram-cli binary

$ instagram-cli search-user --username someone
  → BFS over graph, replays cached XPaths in ~150ms per step
  → falls back to live LLM (via Stagehand) on selector miss, writes back the fix
```

## Why it exists

Three workloads in any agent-driven site task:
1. **Navigation** — get from A to B. (Easy to cache. 80% of LLM cost today.)
2. **Extraction** — read structured data from a page. (Stagehand `extract()` already solves this.)
3. **Synthesis** — reason about what was extracted. (Pure LLM work; nothing to cache.)

Existing tools (Stagehand, Browser-use, Skyvern) make every navigation a fresh LLM call. siteforge caches navigation as a graph and replays it deterministically. LLM budget goes entirely toward (2) and (3).

## How it's built

- **Browser substrate:** [Stagehand](https://github.com/browserbase/stagehand) (MIT, Playwright + AI primitives).
- **Graph algorithms:** inspired by [GitNexus](https://github.com/abhigyanpatwari/GitNexus) — Leiden clustering for functional areas, BFS from scored entry points to trace user journeys.
- **Storage:** filesystem JSON, one file per site. (Same shape every other browser-agent uses.)
- **Self-heal:** on selector failure, fall back to Stagehand `act()`, update the cached edge, write back.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Status

Early scaffold. No working binary yet. See [issues](../../issues) for the roadmap.

## License

MIT. See [LICENSE](./LICENSE).
