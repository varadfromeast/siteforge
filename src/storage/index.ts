/**
 * @module storage
 *
 * Persists the SiteGraph and Registry to disk. Filesystem JSON only.
 * No databases, no servers. (GitNexus uses LadybugDB; we don't need it at
 * this scale — switch to SQLite if any site exceeds ~5k states.)
 *
 * Atomic writes: write to temp file, fsync, rename. Same approach as
 * GitNexus's reindex (writes to temp dir, mv to final).
 *
 * Storage layout:
 *
 *   ~/.siteforge/
 *     registry.json
 *     sites/<domain>/
 *       graph.json
 *       skill.md
 *       session.json
 *       meta.json
 *       screenshots/<state-id>.png
 *       logs/YYYY-MM-DD.log
 *
 * GitNexus parallel: `~/.gitnexus/registry.json` + per-repo `.gitnexus/`
 * directory with `lbug/` (LadybugDB) and `meta.json` (lastCommit, indexedAt).
 */

import type { Domain, SiteGraph, Registry } from '../core/types.js';

export interface StorageOptions {
  /** Override the storage root. Defaults to `~/.siteforge`. */
  root?: string;
}

/**
 * Returns the absolute path to a site's directory.
 * IMPLEMENTATION DEFERRED.
 */
export function siteDir(domain: Domain, options?: StorageOptions): string {
  throw new Error('siteDir: not implemented');
}

// ---------------------------------------------------------------------------
// SiteGraph persistence
// ---------------------------------------------------------------------------

/**
 * Load a SiteGraph from `~/.siteforge/sites/<domain>/graph.json`.
 * Returns null if the site has never been indexed.
 * IMPLEMENTATION DEFERRED.
 */
export async function loadGraph(
  domain: Domain,
  options?: StorageOptions,
): Promise<SiteGraph | null> {
  throw new Error('loadGraph: not implemented');
}

/**
 * Save a SiteGraph atomically (temp + fsync + rename).
 * Updates the registry entry. Updates `meta.json` summary.
 * IMPLEMENTATION DEFERRED.
 */
export async function saveGraph(
  graph: SiteGraph,
  options?: StorageOptions,
): Promise<void> {
  throw new Error('saveGraph: not implemented');
}

// ---------------------------------------------------------------------------
// Session (Playwright storageState) persistence
// ---------------------------------------------------------------------------

/**
 * Load Playwright storageState (cookies, localStorage) for a site.
 * Returns null if not yet logged in.
 * IMPLEMENTATION DEFERRED.
 */
export async function loadSession(
  domain: Domain,
  options?: StorageOptions,
): Promise<unknown | null> {
  throw new Error('loadSession: not implemented');
}

/**
 * Save Playwright storageState. Called after manual login.
 * IMPLEMENTATION DEFERRED.
 */
export async function saveSession(
  domain: Domain,
  state: unknown,
  options?: StorageOptions,
): Promise<void> {
  throw new Error('saveSession: not implemented');
}

// ---------------------------------------------------------------------------
// Registry — global index of indexed sites
// ---------------------------------------------------------------------------

/**
 * Load the global registry. Returns empty if not yet created.
 * IMPLEMENTATION DEFERRED.
 */
export async function loadRegistry(options?: StorageOptions): Promise<Registry> {
  throw new Error('loadRegistry: not implemented');
}

/**
 * Save the registry. Called whenever a site graph is saved.
 * IMPLEMENTATION DEFERRED.
 */
export async function saveRegistry(
  registry: Registry,
  options?: StorageOptions,
): Promise<void> {
  throw new Error('saveRegistry: not implemented');
}
