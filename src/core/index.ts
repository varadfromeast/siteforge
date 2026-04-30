/**
 * @module core
 *
 * Pure data model + algorithms. Zero I/O, zero browser.
 *
 * GitNexus parallel: `gitnexus-shared/` — the pure-logic core that doesn't
 * depend on Tree-sitter or LadybugDB.
 */

export * from './types.js';
export { canonicalizeAtoms } from './canonicalize.js';
export { hashAtomSet, hashValue } from './hash.js';

import type { OpId, SiteGraph, StateId } from './types.js';

// ---------------------------------------------------------------------------
// Path planner — BFS over the SiteGraph (deferred to v0.0.5)
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
 * IMPLEMENTATION DEFERRED — TODO in v0.0.5.
 */
export function planPath(
  graph: SiteGraph,
  from: StateId,
  to: StateId,
  options?: { min_confidence?: number; max_depth?: number },
): PlanResult | NoPathResult {
  // Suppress unused-arg warnings while deferred.
  void graph;
  void from;
  void to;
  void options;
  throw new Error('planPath: not implemented (v0.0.5)');
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 1;
