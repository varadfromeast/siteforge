/**
 * @module snapshot
 *
 * Wraps Stagehand's accessibility-tree snapshot into our domain.
 * Page → Atoms → State.
 *
 * What we use from Stagehand:
 *   - `captureHybridSnapshot(page)` returns { combinedTree, xpathMap, urlMap }
 *   - The a11y tree is a multiline text representation of the page semantics
 *   - xpathMap maps elementId ("0-76") → absolute XPath ("/html/body/...")
 *
 * What this module adds:
 *   - Parse Stagehand's tree into our Atom[] type
 *   - Strip dynamic noise (timestamps, generated class names, ad slots)
 *   - Classify the page into a StateKind (page/modal/form/list/...)
 *   - Hash → return a State
 *
 * GitNexus parallel: this is the Tree-sitter parsing phase — we extract
 * structure-bearing atoms from a substrate (DOM/a11y tree, not source code).
 */

import type { Atom, State, StateKind } from '../core/types.js';

/** Anything that resembles a Stagehand or Playwright Page. Kept loose for v1. */
export type PageHandle = unknown;

export interface SnapshotResult {
  /** Raw a11y tree text (for debugging / LLM fallback). */
  raw_tree: string;
  /** elementId → absolute XPath. From Stagehand's xpathMap. */
  xpath_map: Record<string, string>;
  /** elementId → URL (for link atoms). */
  url_map: Record<string, string>;
  /** The current page URL. */
  url: string;
  /** Parsed and canonicalized atoms — what we actually persist + hash. */
  atoms: Atom[];
}

/**
 * Capture an accessibility-tree snapshot via Stagehand and parse into atoms.
 * IMPLEMENTATION DEFERRED.
 */
export async function captureSnapshot(page: PageHandle): Promise<SnapshotResult> {
  throw new Error('captureSnapshot: not implemented');
}

// ---------------------------------------------------------------------------
// State classification
// (GitNexus parallel: classifying a Symbol as Function/Class/Method.)
// ---------------------------------------------------------------------------

/**
 * Decide the StateKind of a snapshot.
 * Heuristics:
 *   - `dialog` role at root → 'modal'
 *   - `form` role with submit-button atom → 'form'
 *   - `feed` or `list` role with many similar children → 'list'
 *   - URL changed and main role present → 'page'
 *   - error indicators ("Page not found", 404) → 'error'
 * IMPLEMENTATION DEFERRED.
 */
export function classifyState(snapshot: SnapshotResult): StateKind {
  throw new Error('classifyState: not implemented');
}

/**
 * Build a State object from a snapshot. Hashes atoms, classifies kind,
 * derives a human label.
 * IMPLEMENTATION DEFERRED.
 */
export function snapshotToState(snapshot: SnapshotResult): State {
  throw new Error('snapshotToState: not implemented');
}
