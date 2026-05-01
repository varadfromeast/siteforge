/**
 * Snapshot self-check — synthetic checks for classifyState/snapshotToState.
 *
 * Two URL flavours are used deliberately:
 *
 *  - `https://example.com/`   exercises the **atom-based fallback** path.
 *                             classifyByUrl ignores non-IG hostnames.
 *  - `https://www.instagram.com/...`  exercises the **URL-pattern** path.
 *
 * Overlay tests (dialog/alert) use the IG URL on purpose because overlay
 * detection runs *before* URL dispatch — a dialog on a profile is a modal,
 * not a profile.
 */

import { canonicalizeAtoms, hashAtomSet } from '../src/core/index.js';
import { classifyState, snapshotToState } from '../src/snapshot/index.js';
import type { Atom } from '../src/core/types.js';
import type { SnapshotResult } from '../src/snapshot/index.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

function snapshot(atoms: Atom[], url = 'https://example.com/'): SnapshotResult {
  return {
    raw_tree: JSON.stringify(atoms),
    xpath_map: {},
    url_map: {},
    url,
    atoms,
  };
}

console.log('\n[snapshot] classifyState');
// Overlay path: dialog/alert beat URL even on a profile URL.
assert(
  classifyState(
    snapshot(
      [{ role: 'dialog', accessible_name: 'Share', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'modal',
  'dialog role → modal (even on a profile URL)',
);
assert(
  classifyState(
    snapshot(
      [{ role: 'alert', accessible_name: 'Something went wrong', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'error',
  'alert role → error (even on a profile URL)',
);

// Atom fallback path: neutral URL so URL dispatch returns null.
assert(
  classifyState(
    snapshot([
      { role: 'textbox', accessible_name: 'Message', attrs: {} },
      { role: 'button', accessible_name: 'Send', attrs: {} },
    ]),
  ) === 'form',
  'input plus submit-like button → form (atom fallback)',
);
assert(
  classifyState(snapshot([{ role: 'feed', accessible_name: 'Posts', attrs: {} }])) === 'list',
  'feed role → list (atom fallback)',
);

// URL-pattern path: IG profile URL, ordinary atoms.
assert(
  classifyState(
    snapshot(
      [{ role: 'button', accessible_name: 'Follow', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'page',
  'IG profile URL → page',
);

console.log('\n[snapshot] snapshotToState');
{
  const atoms: Atom[] = [
    { role: 'heading', accessible_name: 'Varad', attrs: {} },
    { role: 'button', accessible_name: 'Follow', attrs: {} },
    { role: 'paragraph', accessible_name: 'noise', attrs: {} },
  ];
  const state = snapshotToState(snapshot(atoms, 'https://www.instagram.com/someone/?utm=x#top'));
  const canonical = canonicalizeAtoms(atoms);

  assert(state.id === hashAtomSet(canonical), 'state id hashes canonical atoms');
  assert(state.atoms.length === canonical.length, 'state stores canonical atoms only');
  assert(state.kind === 'page', 'ordinary profile snapshot → page');
  assert(state.label === 'Varad', 'heading becomes state label');
  assert(state.url_template === 'www.instagram.com/someone/', 'url_template drops query/hash');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(state.last_seen), 'last_seen is ISO-like');
}

console.log(`\n${failures === 0 ? '✅ snapshot checks passed' : `❌ ${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
