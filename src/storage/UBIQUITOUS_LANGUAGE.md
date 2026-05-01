# `storage/` — local language

Filesystem persistence for SiteGraphs, Sessions, and the Registry.
JSON files only. Atomic writes. No databases. No network.

## Intent in one paragraph

`storage/` is the boring durability layer. It takes data structures from
`core/` and writes them to `~/.siteforge/`. Crash-safety is the only thing
that matters: a kill mid-write must never corrupt an existing file. Reads
are O(file size) and called rarely; writes are O(file size) and called rarely
too. Performance is irrelevant; correctness is everything.

## Local vocabulary

### atomic write
The temp + fsync + rename pattern. Write the new content to
`<final-name>.tmp.<random>`, fsync the file, then `rename()` over the
final path. POSIX guarantees rename is atomic on the same filesystem.
GitNexus uses the same pattern for its reindex.

### site_dir
The absolute path to a domain's directory: `~/.siteforge/sites/<domain>/`.
Returned by `siteDir()`. Created on demand by `saveGraph()`.

### registry entry
A row in `~/.siteforge/registry.json` linking a `Domain` to its on-disk
state — `storage_path`, `indexed_at`, summary stats. Updated as a side
effect of every `saveGraph()` so it stays in sync with the truth on disk.

### session
The Playwright `storageState` (cookies + localStorage + IndexedDB) for a
domain. Persisted in `<site_dir>/session.json` after manual login so the
next run skips authentication.

### graph file
`<site_dir>/graph.json` — the canonical persisted form of a `SiteGraph`.
Always validated against `CURRENT_SCHEMA_VERSION` on load.

### meta file
`<site_dir>/meta.json` — small summary file with `last_indexed`,
`drift_score`, and counts. Read cheaply by the registry and CLI without
having to load the full graph.

### schema version error
Thrown by `loadGraph()` when the on-disk `schema_version` doesn't match
`CURRENT_SCHEMA_VERSION`. Caller decides whether to migrate, refuse, or
ignore.

## Not in this module

- ❌ Graph algorithms (that's `core/planPath`)
- ❌ Computing hashes (that's `core/hash`)
- ❌ Serializing screenshots (just stores bytes; `snapshot/` decides what to capture)
- ❌ Network or HTTP (we are local-only)
- ❌ Database engines (no SQLite, no Redis — just JSON files)

## Key invariants

1. **Atomic writes always.** A crashed `saveGraph` never leaves a corrupt
   file. Either the new bytes are visible after rename, or the old ones are.
2. **Schema-checked reads.** `loadGraph` reads `schema_version` first; never
   parses a future-version file as if it were current.
3. **Registry consistency.** Every `saveGraph` updates the corresponding
   `RegistryEntry`. Registry is never stale relative to disk.
4. **Read-null, write-error.** `loadGraph` returns `null` for missing sites
   (not an error). `saveGraph` throws on real I/O errors.
5. **Path safety.** `siteDir(domain)` validates that `domain` is a sensible
   hostname (no `..`, no `/`). Don't let a malicious graph file escape the
   `~/.siteforge/sites/` jail.
