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
 * Order of dispatch:
 *   1. Strong **overlay** signals (alert/dialog/error). A dialog opened on a
 *      profile is a modal, not a profile — overlays trump URL.
 *   2. **URL pattern**. Stable, repeatable, fast for Instagram families.
 *   3. **Atom-based fallback**. Only runs when URL doesn't match any known
 *      pattern (other domains, deep-links we don't recognise).
 *
 * Earlier versions classified ~58% of IG states as `form` because the
 * "input + submit-like button" heuristic ran on every page (the nav search
 * box plus per-post save buttons). URL dispatch eliminates that.
 */
export function classifyState(snapshot: SnapshotResult): StateKind {
  const overlay = classifyOverlay(snapshot);
  if (overlay) return overlay;

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
 * Detect overlay/error states that must override URL-based classification.
 *
 * If a dialog or alert is mounted on top of the page, the *current* state is
 * the overlay, not the underlying page. URL still says `/<handle>/` but the
 * user is now interacting with a modal.
 */
function classifyOverlay(snapshot: SnapshotResult): StateKind | null {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));
  const names = snapshot.atoms.map((atom) => atom.accessible_name.toLowerCase());

  if (
    snapshot.atoms.some((atom) => atom.role === 'alert' && isErrorOverlayName(atom.accessible_name.toLowerCase())) ||
    names.some(isErrorOverlayName)
  ) {
    return 'error';
  }
  if (roles.has('dialog') || roles.has('alertdialog')) return 'modal';

  return null;
}

function isErrorOverlayName(name: string): boolean {
  if (name.length > 80) return false;
  return (
    name === 'error' ||
    name === 'failed' ||
    name === 'try again' ||
    /\b(something went wrong|couldn't load|failed to load|try again later)\b/.test(name)
  );
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

  // Only Instagram URLs go through the URL-pattern dispatch. Other hostnames
  // fall through to atom-based classification so callers/tests can drive the
  // generic path with neutral URLs.
  if (!/(^|\.)instagram\.com$/.test(parsed.hostname)) return null;

  const path = parsed.pathname;

  // Auth/credentials flows are unambiguously forms.
  if (/^\/accounts\/(login|signup|password|emailsignup)\b/.test(path)) return 'form';

  // Stories are always overlaid on top of feed/profile — modal.
  if (/^\/stories\//.test(path)) return 'modal';

  // Direct messages live in a side panel surface.
  if (/^\/direct\//.test(path)) return 'panel';

  // Post / reel detail (singular path: /p/<id>/, /reel/<id>/) can be either
  // a true page or a modal overlay; let atom-based fallback decide (it
  // checks for `dialog` role).
  if (/^\/(p|reel)\//.test(path)) return null;

  // Reels family.
  // /reels/                 → list (the public reels feed surface)
  // /reels/<id>/            → page (the standalone reel viewer; before this
  //                           was misclassified as `form` because the
  //                           comment composer has a form-role wrapper and
  //                           IG's nav has a searchbox, which together
  //                           tripped the atom-based looksLikeForm heuristic)
  if (/^\/reels\/?$/.test(path)) return 'list';
  if (/^\/reels\/[^/]+\/?$/.test(path)) return 'page';

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
 *
 * The form heuristic here is intentionally looser than the IG-side path:
 * once we're on an unknown domain, an `input + submit-like button` pair is
 * a strong "this is a form" signal. We don't run the loose check on IG
 * because IG's nav search + per-post save buttons trigger false positives.
 */
function classifyByAtoms(snapshot: SnapshotResult): StateKind {
  const roles = new Set(snapshot.atoms.map((atom) => atom.role));

  if (looksLikeForm(snapshot)) return 'form';
  if (roles.has('feed') || roles.has('list') || roles.has('grid') || roles.has('table')) {
    return 'list';
  }

  return 'page';
}

/**
 * Loose form heuristic for the atom-based fallback path. An input role plus a
 * button whose name reads like a submit/send action is a reliable signal on
 * unknown domains. (Not used for IG — IG uses URL dispatch.)
 */
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
      /\b(submit|send|save|next|continue|log in|sign in|sign up|create account)\b/i.test(
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
