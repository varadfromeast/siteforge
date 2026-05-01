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
export { surfaceAtoms } from './surface.js';

import { canonicalizeAtoms, hashAtomSet } from '../core/index.js';
import type { State, StateKind } from '../core/types.js';
import type { SnapshotResult } from './types.js';

/**
 * Decide the StateKind of a snapshot.
 */
export function classifyState(snapshot: SnapshotResult): StateKind {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));
  const names = snapshot.atoms.map((atom) => atom.accessible_name.toLowerCase());

  if (roles.has('alert') || names.some((name) => /\b(error|failed|try again)\b/.test(name))) {
    return 'error';
  }
  if (roles.has('dialog') || roles.has('alertdialog')) return 'modal';
  if (roles.has('form') || looksLikeForm(snapshot)) return 'form';
  if (roles.has('feed') || roles.has('list') || roles.has('grid') || roles.has('table')) {
    return 'list';
  }

  return 'page';
}

/**
 * Build a State object from a snapshot.
 */
export function snapshotToState(snapshot: SnapshotResult): State {
  const atoms = canonicalizeAtoms(snapshot.atoms);
  const id = hashAtomSet(atoms);

  return {
    id,
    kind: classifyState(snapshot),
    label: labelForSnapshot(snapshot),
    atoms,
    url_template: urlTemplate(snapshot.url),
    confidence: atoms.length > 0 ? 0.8 : 0.4,
    last_seen: new Date().toISOString(),
  };
}

function looksLikeForm(snapshot: SnapshotResult): boolean {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));
  const hasInput =
    roles.has('textbox') ||
    roles.has('searchbox') ||
    roles.has('combobox') ||
    roles.has('spinbutton');

  if (!hasInput) return false;

  return snapshot.atoms.some(
    (atom) =>
      atom.role === 'button' &&
      /\b(submit|send|save|next|continue|log in|sign in)\b/i.test(atom.accessible_name),
  );
}

function labelForSnapshot(snapshot: SnapshotResult): string {
  const heading = snapshot.atoms.find((atom) => atom.role === 'heading' && atom.accessible_name.trim());
  if (heading) return heading.accessible_name.trim().slice(0, 80);

  const templatedUrl = urlTemplate(snapshot.url);
  if (templatedUrl) return templatedUrl;

  return classifyState(snapshot);
}

function urlTemplate(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
    return `${parsed.hostname}${path}`;
  } catch {
    return undefined;
  }
}
