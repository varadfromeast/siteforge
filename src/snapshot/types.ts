/**
 * Public types for the snapshot module.
 */

import type { Atom } from '../core/types.js';

export interface SnapshotResult {
  /** Raw a11y tree text (for debugging / LLM fallback). */
  raw_tree: string;
  /** elementId → absolute XPath. From Stagehand's xpathMap. v1: empty. */
  xpath_map: Record<string, string>;
  /** elementId → URL (for link atoms). v1: empty. */
  url_map: Record<string, string>;
  /** The current page URL. */
  url: string;
  /** Parsed atoms (raw, before canonicalization). */
  atoms: Atom[];
}
