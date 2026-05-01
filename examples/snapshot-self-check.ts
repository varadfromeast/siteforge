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
import { classifyState, snapshotToState, surfaceAtoms } from '../src/snapshot/index.js';
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

// /reels/<id>/ used to fall through URL dispatch (regex only matched /(p|reel)/
// singular, not /reels/ plural-with-id) and atom fallback misclassified it as
// `form` because IG's comment composer has a form-role wrapper.
assert(
  classifyState(
    snapshot(
      [{ role: 'button', accessible_name: 'like', attrs: {} }],
      'https://www.instagram.com/reels/DXMx_2EDoun/',
    ),
  ) === 'page',
  '/reels/<id>/ → page (was misclassified as form)',
);
assert(
  classifyState(
    snapshot([{ role: 'button', accessible_name: 'like', attrs: {} }], 'https://www.instagram.com/reels/'),
  ) === 'list',
  '/reels/ (no id) → list',
);

console.log('\n[snapshot] surfaceAtoms');
{
  // Mixed bag: noise + nav atoms. Nav must survive, noise must not.
  const navAtoms: Atom[] = [
    { role: 'button', accessible_name: 'follow', attrs: {} },
    { role: 'button', accessible_name: 'like', attrs: {} },
    { role: 'button', accessible_name: 'comment', attrs: {} }, // canonical action — keep
    { role: 'button', accessible_name: 'save', attrs: {} },
    { role: 'textbox', accessible_name: 'message...', attrs: {} },
  ];
  const noiseAtoms: Atom[] = [
    // Per-comment counters from a reel side panel
    { role: 'button', accessible_name: 'comment 1,368', attrs: {} },
    { role: 'button', accessible_name: 'comment 10.3k', attrs: {} },
    { role: 'button', accessible_name: 'comment 14', attrs: {} },
    // Hashtag-as-link / hashtag-as-button from suggested reels
    { role: 'link', accessible_name: '#fyp', attrs: {} },
    { role: 'link', accessible_name: '#chess', attrs: {} },
    { role: 'button', accessible_name: '#fitness', attrs: {} },
    // DM sidebar phrases
    { role: 'button', accessible_name: 'react to message from animesh_', attrs: {} },
    { role: 'button', accessible_name: 'reply to message from varad.th', attrs: {} },
    { role: 'button', accessible_name: 'see more options for message from foo', attrs: {} },
    { role: 'link', accessible_name: 'open the profile page of bar', attrs: {} },
    // Geo-tagged location links. Note: the visual heuristic only reliably
    // matches "<word>, <words>" with ≥3 chars per side. US-state abbrevs
    // ("New York, NY") slip through until we capture href context — see
    // isGeoLocation in surface.ts.
    { role: 'link', accessible_name: 'bangalore, india', attrs: {} },
    { role: 'link', accessible_name: 'los angeles, california', attrs: {} },
    // Doubled icon+label that should normalize to a chrome name and drop
    { role: 'link', accessible_name: 'home home', attrs: {} },
    { role: 'link', accessible_name: 'explore explore', attrs: {} },
    // Story drawer button (existing filter)
    { role: 'button', accessible_name: 'story by alpeethakur, not seen', attrs: {} },
    // Username link from the suggested-users panel
    { role: 'link', accessible_name: 'creator_growth_labs', attrs: {} },
  ];
  const surface = surfaceAtoms([...navAtoms, ...noiseAtoms], 'https://www.instagram.com/');
  const names = new Set(surface.map((a) => a.accessible_name));

  // Survivors
  assert(names.has('follow'), 'nav button "follow" kept');
  assert(names.has('like'), 'nav button "like" kept');
  assert(names.has('comment'), 'canonical "comment" action kept');
  assert(names.has('save'), 'nav button "save" kept');
  assert(names.has('message...'), 'compose textbox kept');

  // Drops
  assert(!names.has('comment 1,368'), 'per-comment counter dropped (comma)');
  assert(!names.has('comment 10.3k'), 'per-comment counter dropped (k suffix)');
  assert(!names.has('comment 14'), 'per-comment counter dropped (small int)');
  assert(![...names].some((n) => n.startsWith('#')), 'hashtag links/buttons dropped');
  assert(![...names].some((n) => /message from/.test(n)), 'DM sidebar message phrases dropped');
  assert(![...names].some((n) => /open the profile page of/.test(n)), 'DM profile-jump links dropped');
  assert(!names.has('bangalore, india'), 'geo location "city, country" dropped');
  assert(!names.has('los angeles, california'), 'geo location "city, state" dropped');
  assert(!names.has('home') && !names.has('home home'), 'doubled chrome "home home" → "home" → dropped');
  assert(!names.has('explore') && !names.has('explore explore'), 'doubled chrome "explore explore" dropped');
  assert(![...names].some((n) => n.startsWith('story by')), 'story drawer button dropped');
  assert(!names.has('creator_growth_labs'), 'suggested-user link dropped on home feed');
}

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
