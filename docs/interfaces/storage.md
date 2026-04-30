# Interface — `storage/`

Filesystem persistence for SiteGraphs, Sessions, and the global Registry.
JSON only. Atomic writes. No databases.

## Purpose

Store a SiteGraph durably between sessions. Maintain a global Registry of
indexed sites (for the CLI and MCP server to discover what's available).
Persist Playwright `storageState` per domain so manual logins survive restart.

## Public surface

```ts
interface StorageOptions {
  root?: string  // override `~/.siteforge`. Useful in tests.
}

siteDir(domain: Domain, options?: StorageOptions): string

loadGraph(domain: Domain, options?: StorageOptions): Promise<SiteGraph | null>
saveGraph(graph: SiteGraph, options?: StorageOptions): Promise<void>

loadSession(domain: Domain, options?: StorageOptions): Promise<unknown | null>
saveSession(domain: Domain, state: unknown, options?: StorageOptions): Promise<void>

loadRegistry(options?: StorageOptions): Promise<Registry>
saveRegistry(registry: Registry, options?: StorageOptions): Promise<void>
```

## Storage layout

```
~/.siteforge/
├── registry.json                          # global index of indexed sites
└── sites/
    └── instagram.com/
        ├── graph.json                     # the SiteGraph
        ├── skill.md                       # auto-generated agent doc
        ├── session.json                   # Playwright storageState
        ├── meta.json                      # { last_indexed, drift_score, ... }
        ├── screenshots/<state-id>.png     # optional, for debugging
        └── logs/2026-04-30.log            # rotated daily
```

## Invariants

1. **Atomic writes.** All saves use temp file + fsync + rename pattern. A crash
   mid-write never leaves a corrupt file. Same approach as GitNexus's reindex.
2. **Schema check on load.** `loadGraph` reads `schema_version` first; refuses
   to load if it doesn't match `CURRENT_SCHEMA_VERSION`.
3. **Registry consistency.** Every `saveGraph` updates the corresponding
   `RegistryEntry`. The registry is never out of sync with what's on disk.
4. **No partial saves.** A `SiteGraph` write either fully succeeds or has no
   effect on existing files.

## Dependencies

- **Imports from outside:** Node `fs/promises`, `path`, `os`.
- **Imports from siteforge:** `core/types` only.
- **Imported by:** `explorer/`, `runtime/`, `emitters/`, `cli/`.

## Errors

- `loadGraph` returns `null` (not throws) if the site has never been indexed.
- `loadGraph` throws `SchemaVersionError` if the on-disk file is from a future
  schema version.
- `saveGraph` throws on disk full / permission denied; partial writes are
  reverted via the temp-file pattern.

## Performance

- `loadGraph`: 10-100ms typical (small JSON, ~100KB for a medium site).
- `saveGraph`: 20-200ms (write + fsync). Called rarely (end of session, or
  every N changes). NOT in the hot replay path.

## Test strategy

- **Unit tests:** in-memory fs (via `memfs`) for round-trip tests.
- **Atomicity test:** kill the process during `saveGraph`, verify the previous
  version is intact and the temp file is cleaned up.
- **Schema migration test:** load a v0 file, verify clean error.

## Open questions

1. **Concurrency.** Two `siteforge` processes saving to the same domain race.
   v1: file lock via `proper-lockfile`. Or single-flight at a higher layer?
2. **Session encryption.** `session.json` contains login cookies. Plaintext is
   acceptable for v1 (local-only) but eventually we want OS-keychain (similar
   to Unbrowse's approach with `keytar`).
3. **Compression.** Large SiteGraphs may benefit from gzip. Defer until we
   measure.
4. **Backup / undo.** A buggy explorer pass could overwrite a good graph with
   garbage. Should we keep N previous versions in `.bak/`? Cheap insurance.

## Files

- `src/storage/index.ts` — public exports.
- `src/storage/paths.ts` — `siteDir` + path helpers.
- `src/storage/atomic-write.ts` — temp+fsync+rename helper.
- `src/storage/graph.ts` — `loadGraph` / `saveGraph`.
- `src/storage/session.ts` — `loadSession` / `saveSession`.
- `src/storage/registry.ts` — `loadRegistry` / `saveRegistry`.
