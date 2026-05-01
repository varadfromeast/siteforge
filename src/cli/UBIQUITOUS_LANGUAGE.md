# `cli/` — local language

The user-facing entry point. Just glue.

## Intent in one paragraph

`cli/` is the thing the user types into a terminal. Each subcommand is a thin
wrapper that parses args via Commander and delegates to exactly one public
function in another module. **No business logic lives here.** If a subcommand
needs more than ~30 lines of glue, the logic belongs elsewhere.

## Local vocabulary

### subcommand
A single verb in the CLI — `teach`, `run`, `mcp`, `validate`, `ls`, `inspect`,
`probe`. Each maps to one underlying module function:
| Subcommand | Delegates to |
|---|---|
| `teach <url>` | `explorer.explore` |
| `run <domain> <process>` | `runtime.runProcess` |
| `mcp <domain>` | `emitters.startMcpServer` |
| `validate <domain>` | `runtime.validateGraph` |
| `ls` | `storage.loadRegistry` + table format |
| `inspect <domain>` | `storage.loadGraph` + pretty-print |
| `probe <url>` | the v0.0.2 live test (drops in v0.0.5+) |

### exit code
A stable, documented integer the CLI returns:
- `0` — success
- `1` — user error (bad args, missing site, expired session)
- `2` — system error (disk full, network timeout, port in use)
- `3` — LLM/auth error (missing API key, login expired, quota)

### `--json` flag
A universal flag every subcommand accepts. Switches output from human-readable
to structured JSON `{ ok: true, data }` or `{ ok: false, error, code }`.
Other tools parse this; humans don't read it.

### handler
The function for a single subcommand, e.g. `cmd-teach.ts:run()`. Lives in
its own file. Receives parsed Commander args and returns a Promise<number>
(the exit code). Throws are caught by `cli/index.ts` and translated to
exit codes.

### glue
The pejorative-but-affectionate name for what this module does. CLIs are
glue. They argue with arg parsers, format errors, and call other people's
functions. They don't reason about the domain.

## Not in this module

- ❌ Logic of any kind. Seriously. If you find yourself writing a loop or a
  conditional that does domain work, it belongs in another module.
- ❌ Direct browser, filesystem, or network calls.
- ❌ Anything that imports `playwright`, `fs`, or `crypto` directly.

## Key invariants

1. **No logic in CLI.** If a subcommand handler exceeds ~30 lines, refactor —
   the logic belongs in the module being delegated to.
2. **Stable exit codes.** Documented above. Don't add new codes without
   updating `interfaces/cli.md`.
3. **`--json` everywhere.** Every subcommand respects `--json`. Tooling
   depends on it.
4. **No silent surprises.** `teach` prompts before opening a browser. `run`
   logs the path it's about to execute before executing.
5. **Errors print human messages to stderr.** Stack traces only with `--debug`.
