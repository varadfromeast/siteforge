# Interface — `cli/`

The user-facing entry point. Just wires Commander to the other modules.

## Purpose

Be the thing the user types into a terminal. Every subcommand delegates to
exactly one module's public function. The CLI itself contains no business
logic.

## Public surface

```
$ siteforge teach <url>                    # run the explore loop on a site
$ siteforge run <domain> <process> [args]  # execute a named process
$ siteforge mcp <domain>                   # start an MCP server for a site
$ siteforge validate <domain>              # drift check
$ siteforge ls                             # list indexed sites (reads registry)
$ siteforge inspect <domain> [--state ID]  # human-debug view of the graph
$ siteforge probe <url>                    # the live test harness (v0.0.2)
```

## Subcommand mapping

| Command | Delegates to |
|---|---|
| `teach <url>` | `explorer.explore(domain, url, options)` |
| `run <domain> <process>` | `runtime.runProcess(domain, process, args)` |
| `mcp <domain>` | `emitters.startMcpServer(domain)` |
| `validate <domain>` | `runtime.validateGraph(domain)` |
| `ls` | `storage.loadRegistry()` + format table |
| `inspect <domain>` | `storage.loadGraph(domain)` + pretty-print |
| `probe <url>` | (the v0.0.2 live test — see `examples/probe-instagram.ts`) |

## Invariants

1. **No logic in CLI.** If a subcommand needs more than 30 lines of glue, the
   logic belongs in the underlying module.
2. **Stable exit codes.**
   - 0 = success
   - 1 = user error (bad args, missing site)
   - 2 = system error (disk full, network timeout)
   - 3 = LLM/auth error (missing API key, login expired)
3. **Predictable output.** All subcommands accept `--json` for structured
   output (so other tools can parse).
4. **No silent surprises.** `teach` always prompts before navigating to
   anything new. `run` always logs the path it's about to execute.

## Dependencies

- **Imports from outside:** `commander`, `chalk` (color output).
- **Imports from siteforge:** all other modules.
- **Imported by:** nothing (it's the leaf).

## Errors

- All errors print a human message to stderr and exit with the appropriate code.
- With `--json`, errors emit `{ ok: false, error, code }` to stdout (still
  with non-zero exit code).

## Performance

- Cold start: ~200-500ms (Node + deps).
- Real work happens in delegated modules.

## Test strategy

- **Snapshot tests** for `--help` output and `--json` outputs.
- **Smoke test:** every subcommand with `--help` exits 0 and prints expected
  text.
- **Behavioral tests** belong in the underlying modules; CLI tests just verify
  argument parsing.

## Open questions

1. **`teach` interactivity.** v1: prompts user to log in manually. Should
   `--auto` mode use Stagehand to log in via stored credentials? Risk: account
   ban. Default off.
2. **`probe` lifetime.** v0.0.2 ships `probe` as the v0.0.2 test harness.
   When `teach` is solid, drop `probe` from the public CLI (move to internal
   tooling).
3. **Update mechanism.** When the user updates siteforge, on-disk graphs may
   need migration. v1: refuse to load from older schema with a clear error
   pointing at `siteforge migrate`.

## Files

- `src/cli/index.ts` — Commander wiring.
- `src/cli/cmd-teach.ts` — `teach` handler.
- `src/cli/cmd-run.ts` — `run` handler.
- `src/cli/cmd-mcp.ts` — `mcp` handler.
- `src/cli/cmd-validate.ts` — `validate` handler.
- `src/cli/cmd-ls.ts` — `ls` handler.
- `src/cli/cmd-inspect.ts` — `inspect` handler.
- `src/cli/cmd-probe.ts` — `probe` handler.
