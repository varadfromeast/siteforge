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
 *
 * URL pattern is checked first because it produces stable, repeatable
 * classifications across visits. Atom-based fallback runs only for URLs we
 * don't recognise.
 *
 * Earlier versions classified ~58% of states as `form` because Instagram's
 * shared nav search box and per-post comment composers tripped a generic
 * "input + action button" heuristic. URL-pattern dispatch eliminates that.
 */
export function classifyState(snapshot: SnapshotResult): StateKind {
  const fromUrl = classifyByUrl(snapshot.url);
  if (fromUrl) return fromUrl;

  return classifyByAtoms(snapshot);
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

/**
 * Map well-known Instagram URL families to StateKind. Returns null when the
 * URL doesn't match any pattern, so the atom-based fallback can run.
 *
 * Generic enough to extend with other domains later (the regexes are simple
 * paths, not IG-specific text).
 */
function classifyByUrl(url: string): StateKind | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;

  // Auth/credentials flows are unambiguously forms.
  if (/^\/accounts\/(login|signup|password|emailsignup)\b/.test(path)) return 'form';

  // Stories are always overlaid on top of feed/profile — modal.
  if (/^\/stories\//.test(path)) return 'modal';

  // Direct messages live in a side panel surface.
  if (/^\/direct\//.test(path)) return 'panel';

  // Post / reel detail can be either a true page or a modal overlay; let
  // atom-based fallback decide (it checks for `dialog` role).
  if (/^\/(p|reel)\//.test(path)) return null;

  // Feeds and lists.
  if (path === '/' || path === '') return 'list';
  if (/^\/explore\b/.test(path)) return 'list';
  if (/^\/[^/]+\/(reels|tagged|saved|reposts)\/?$/.test(path)) return 'list';

  // Profile root: /<handle> or /<handle>/.
  if (/^\/[^/]+\/?$/.test(path) && !/^\/(accounts|explore|direct|stories|reels|p)\b/.test(path)) {
    return 'page';
  }

  return null;
}

/**
 * Atom-based fallback. Used only when URL pattern doesn't match (unknown
 * domain, deep-linked detail page without the family hint, etc.).
 */
function classifyByAtoms(snapshot: SnapshotResult): StateKind {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));
  const names = snapshot.atoms.map((atom) => atom.accessible_name.toLowerCase());

  if (roles.has('alert') || names.some((name) => /\b(error|failed|try again)\b/.test(name))) {
    return 'error';
  }
  if (roles.has('dialog') || roles.has('alertdialog')) return 'modal';
  if (looksLikeForm(snapshot)) return 'form';
  if (roles.has('feed') || roles.has('list') || roles.has('grid') || roles.has('table')) {
    return 'list';
  }

  return 'page';
}

/**
 * A page is `form` when it is *primarily* a form: a `form` role wrapper plus
 * a primary submit button. The earlier looser heuristic over-fired on any
 * page that happened to contain a textbox (e.g. nav search) and a save-style
 * button (e.g. post save), which described every IG page.
 */
function looksLikeForm(snapshot: SnapshotResult): boolean {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));
  if (!roles.has('form')) return false;

  return snapshot.atoms.some(
    (atom) =>
      atom.role === 'button' &&
      /\b(submit|send|save|next|continue|log in|sign in|sign up|create account|reset password)\b/i.test(
        atom.accessible_name,
      ),
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
