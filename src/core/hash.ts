/**
 * SHA-256 helpers. The content-addressing layer.
 *
 * Why canonical JSON: object key order isn't guaranteed by JS, but our hashes
 * MUST be stable across runs and machines. We sort keys recursively before
 * stringifying.
 */

import { createHash } from 'node:crypto';
import type { Atom, Hash, StateId } from './types.js';

/** Recursively sort object keys for stable serialization. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/** SHA-256 hex of any JSON-serializable value. Order-independent for objects. */
export function hashValue(value: unknown): Hash {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** SHA-256 hex of a (canonical) atom set. */
export function hashAtomSet(atoms: Atom[]): StateId {
  return hashValue(atoms);
}
