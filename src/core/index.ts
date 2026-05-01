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
export { planPath, type PlanResult, type NoPathResult } from './plan-path.js';

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 1;
