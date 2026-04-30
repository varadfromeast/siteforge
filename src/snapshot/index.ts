/**
 * @module snapshot
 *
 * Wraps the browser. Page → Atoms → State.
 *
 * v0.0.2: implements `captureSnapshot` using Playwright's built-in a11y
 * snapshot. `classifyState` and `snapshotToState` deferred to v0.0.4.
 */

export type { SnapshotResult } from './types.js';
export { captureSnapshot } from './capture.js';
export { extractAtoms } from './atom-extract.js';

import type { State, StateKind } from '../core/types.js';
import type { SnapshotResult } from './types.js';

/**
 * Decide the StateKind of a snapshot. (Deferred to v0.0.4.)
 */
export function classifyState(_snapshot: SnapshotResult): StateKind {
  throw new Error('classifyState: not implemented (v0.0.4)');
}

/**
 * Build a State object from a snapshot. (Deferred to v0.0.4.)
 */
export function snapshotToState(_snapshot: SnapshotResult): State {
  throw new Error('snapshotToState: not implemented (v0.0.4)');
}
