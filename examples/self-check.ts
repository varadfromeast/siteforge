/**
 * Self-check — runs assertions on core/ functions without needing a browser.
 *
 * Catches obvious bugs before you bother with the live probe.
 *
 *   npm run selfcheck
 */

import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import type { Atom } from '../src/core/types.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('\n[hashValue] determinism + order-independence');
{
  const h1 = hashValue({ a: 1, b: 2 });
  const h2 = hashValue({ b: 2, a: 1 });
  assert(h1 === h2, 'object key order does not affect hash');

  const h3 = hashValue([1, 2, 3]);
  const h4 = hashValue([1, 2, 3]);
  assert(h3 === h4, 'arrays hash deterministically');

  const h5 = hashValue([1, 2, 3]);
  const h6 = hashValue([3, 2, 1]);
  assert(h5 !== h6, 'array order matters (for actual sequences)');

  assert(/^[a-f0-9]{64}$/.test(h1), 'hash is 64-char hex');
}

console.log('\n[canonicalizeAtoms] basic behavior');
{
  const empty = canonicalizeAtoms([]);
  assert(empty.length === 0, 'empty in → empty out');

  const nonInteractable: Atom[] = [
    { role: 'paragraph', accessible_name: 'hello', attrs: {} },
    { role: 'heading', accessible_name: 'world', attrs: {} },
  ];
  assert(canonicalizeAtoms(nonInteractable).length === 0, 'drops non-interactable roles');

  const interactable: Atom[] = [
    { role: 'button', accessible_name: 'Click me', attrs: {} },
    { role: 'link', accessible_name: 'Home', attrs: {} },
  ];
  const out = canonicalizeAtoms(interactable);
  assert(out.length === 2, 'keeps interactable atoms');
  assert(out[0]!.accessible_name === 'click me', 'lowercases names');
}

console.log('\n[canonicalizeAtoms] idempotence');
{
  const raw: Atom[] = [
    { role: 'button', accessible_name: '  Submit  ', attrs: { id: '_a9zs', 'aria-label': 'Submit' } },
    { role: 'link', accessible_name: 'Posts: 42', attrs: { href: '/u/foo/' } },
    { role: 'textbox', accessible_name: 'Search', attrs: { placeholder: 'Search…' } },
  ];
  const once = canonicalizeAtoms(raw);
  const twice = canonicalizeAtoms(once);
  assert(deepEqual(once, twice), 'canonicalizeAtoms is idempotent');
}

console.log('\n[canonicalizeAtoms] permutation invariance');
{
  const a: Atom[] = [
    { role: 'button', accessible_name: 'Save', attrs: {} },
    { role: 'button', accessible_name: 'Cancel', attrs: {} },
    { role: 'link', accessible_name: 'Home', attrs: {} },
  ];
  const b: Atom[] = [
    { role: 'link', accessible_name: 'Home', attrs: {} },
    { role: 'button', accessible_name: 'Cancel', attrs: {} },
    { role: 'button', accessible_name: 'Save', attrs: {} },
  ];
  assert(hashAtomSet(canonicalizeAtoms(a)) === hashAtomSet(canonicalizeAtoms(b)), 'shuffled input → same hash');
}

console.log('\n[canonicalizeAtoms] noise filtering');
{
  // Generated id should be dropped from attrs.
  const withGenId: Atom[] = [{ role: 'button', accessible_name: 'X', attrs: { id: '_a9zsk2', 'aria-label': 'Close' } }];
  const cleaned = canonicalizeAtoms(withGenId);
  assert(cleaned.length === 1, 'atom kept');
  assert(cleaned[0]!.attrs['id'] === undefined, 'generated id dropped');
  assert(cleaned[0]!.attrs['aria-label'] === 'Close', 'stable aria-label kept');

  // Pure-numeric counter should drop the atom.
  const counter: Atom[] = [{ role: 'button', accessible_name: '42', attrs: {} }];
  assert(canonicalizeAtoms(counter).length === 0, 'pure-numeric name → atom dropped');

  // K/M suffixes count as numeric.
  const big: Atom[] = [{ role: 'button', accessible_name: '1.2K', attrs: {} }];
  assert(canonicalizeAtoms(big).length === 0, '1.2K-style counter dropped');
}

console.log('\n[canonicalizeAtoms] href normalization');
{
  const withQuery: Atom[] = [
    { role: 'link', accessible_name: 'Profile', attrs: { href: 'https://insta.com/u/foo?utm=tracking&t=123' } },
    { role: 'link', accessible_name: 'Profile', attrs: { href: 'https://insta.com/u/foo?ref=email' } },
  ];
  const cleaned = canonicalizeAtoms(withQuery);
  assert(cleaned.length === 2, 'both kept');
  assert(cleaned[0]!.attrs['href'] === '/u/foo' && cleaned[1]!.attrs['href'] === '/u/foo', 'href normalized to path');
  assert(hashAtomSet([cleaned[0]!]) === hashAtomSet([cleaned[1]!]), 'same path → same hash');
}

console.log('\n[hashAtomSet] sensitivity to real changes');
{
  const before: Atom[] = [{ role: 'button', accessible_name: 'Save', attrs: {} }];
  const after: Atom[] = [{ role: 'button', accessible_name: 'Submit', attrs: {} }];
  assert(
    hashAtomSet(canonicalizeAtoms(before)) !== hashAtomSet(canonicalizeAtoms(after)),
    'name change → different hash',
  );
}

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
