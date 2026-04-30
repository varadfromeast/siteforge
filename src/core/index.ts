/**
 * @module core
 *
 * Pure data model + algorithms. Zero I/O, zero browser.
 *
 * What lives here:
 *   - Types: State, Operation, Process, Cluster, SiteGraph (see ./types.ts)
 *   - Hashing: canonicalize an atom-set → state id (sha256)
 *   - Planner: BFS over a SiteGraph to find shortest path between states
 *   - Atom canonicalization: strip noise, sort deterministically
 *
 * GitNexus parallel: this is `gitnexus-shared/` — the pure-logic core
 * that doesn't depend on Tree-sitter or LadybugDB.
 */

export * from './types.js';

// ---------------------------------------------------------------------------
// Atom canonicalization & state hashing
// ---------------------------------------------------------------------------

import type { Atom, StateId, SiteGraph, OpId, Hash } from './types.js';

/**
 * Take a raw atom list and produce a deterministic, canonical sequence.
 * Strips dynamic noise (text content, timestamps, generated class names).
 * Two visits to the "same" page must produce identical output.
 *
 * IMPLEMENTATION DEFERRED — TODO in v0.0.2.
 */
export function canonicalizeAtoms(atoms: Atom[]): Atom[] {
  throw new Error('canonicalizeAtoms: not implemented');
}

/**
 * Hash a canonical atom list into a StateId.
 * Cache key design (per first-principles): stable + complete + minimal.
 * SHA-256 over JSON-stringified canonical atoms.
 *
 * IMPLEMENTATION DEFERRED — TODO in v0.0.2.
 */
export function hashAtomSet(atoms: Atom[]): StateId {
  throw new Error('hashAtomSet: not implemented');
}

/**
 * Hash any value into a Hash. General-purpose for validation_hash, etc.
 *
 * IMPLEMENTATION DEFERRED — TODO in v0.0.2.
 */
export function hashValue(value: unknown): Hash {
  throw new Error('hashValue: not implemented');
}

// ---------------------------------------------------------------------------
// Path planner — BFS over the SiteGraph
// (GitNexus parallel: BFS in `traceFromEntryPoint`.)
// ---------------------------------------------------------------------------

export interface PlanResult {
  ok: true;
  path: OpId[];
  total_confidence: number;
}
export interface NoPathResult {
  ok: false;
  reason: 'no-path' | 'unknown-source' | 'unknown-target';
}

/**
 * Find shortest path from source state to target state over edges.
 * Filters edges below `min_confidence` unless that would yield no path.
 *
 * IMPLEMENTATION DEFERRED — TODO in v0.0.3.
 */
export function planPath(
  graph: SiteGraph,
  from: StateId,
  to: StateId,
  options?: { min_confidence?: number; max_depth?: number },
): PlanResult | NoPathResult {
  throw new Error('planPath: not implemented');
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 1;
