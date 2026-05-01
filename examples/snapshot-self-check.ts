/**
 * Snapshot self-check — synthetic checks for classifyState/snapshotToState.
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

function snapshot(atoms: Atom[], url = 'https://www.instagram.com/someone/'): SnapshotResult {
  return {
    raw_tree: JSON.stringify(atoms),
    xpath_map: {},
    url_map: {},
    url,
    atoms,
  };
}

console.log('\n[snapshot] classifyState');
assert(
  classifyState(snapshot([{ role: 'dialog', accessible_name: 'Share', attrs: {} }])) === 'modal',
  'dialog role → modal',
);
assert(
  classifyState(
    snapshot([
      { role: 'textbox', accessible_name: 'Message', attrs: {} },
      { role: 'button', accessible_name: 'Send', attrs: {} },
    ]),
  ) === 'form',
  'input plus submit-like button → form',
);
assert(
  classifyState(snapshot([{ role: 'alert', accessible_name: 'Something went wrong', attrs: {} }])) ===
    'error',
  'alert role → error',
);
assert(
  classifyState(snapshot([{ role: 'feed', accessible_name: 'Posts', attrs: {} }])) === 'list',
  'feed role → list',
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
