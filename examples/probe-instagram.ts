/**
 * v0.0.2 live test harness.
 *
 * Goal: validate the foundational invariant —
 *   "two visits to the same logical page produce the same state hash"
 *
 * Usage:
 *   npm run probe -- https://www.instagram.com/<your-username>/
 *
 * Flow:
 *   1. Open headed Chrome, navigate to instagram.com/.
 *   2. Wait for you to log in. Press ENTER when ready.
 *   3. Navigate to the target URL (your profile or any stable page).
 *   4. CAPTURE #1 — snapshot, canonicalize, hash. Save to /tmp/siteforge-probe-1.json.
 *   5. Navigate elsewhere then back to the target URL.
 *   6. CAPTURE #2. Save to /tmp/siteforge-probe-2.json.
 *   7. Compare hashes. Print verdict + diff if they differ.
 */

import { chromium, type Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import { stdin, stdout, exit } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import { captureSnapshot } from '../src/snapshot/index.js';
import type { Atom } from '../src/core/types.js';

const TARGET_URL = process.argv[2] ?? 'https://www.instagram.com/';
const ELSEWHERE_URL = 'https://www.instagram.com/explore/';

async function pause(prompt: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(`\n[siteforge-probe] ${prompt} (press ENTER) `);
  rl.close();
}

interface CaptureRecord {
  url: string;
  atoms_raw_count: number;
  atoms_canonical_count: number;
  state_id: string;
  raw_tree_hash: string;
  canonical_atoms: Atom[];
}

async function captureAndHash(page: Page, label: string, savePath: string): Promise<CaptureRecord> {
  // Settle the page before snapshot — IG is heavily JS-rendered.
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  // Extra grace for late-loading content.
  await page.waitForTimeout(2000);

  const snap = await captureSnapshot(page);
  const canonical = canonicalizeAtoms(snap.atoms);
  const stateId = hashAtomSet(canonical);
  const rawTreeHash = hashValue(snap.raw_tree);

  const record: CaptureRecord = {
    url: snap.url,
    atoms_raw_count: snap.atoms.length,
    atoms_canonical_count: canonical.length,
    state_id: stateId,
    raw_tree_hash: rawTreeHash,
    canonical_atoms: canonical,
  };

  // Persist for inspection / diffing.
  writeFileSync(
    savePath,
    JSON.stringify(
      {
        ...record,
        raw_atoms: snap.atoms,
      },
      null,
      2,
    ),
  );

  console.log(`\n[siteforge-probe] ${label}`);
  console.log(`  URL: ${snap.url}`);
  console.log(`  raw atoms: ${snap.atoms.length}`);
  console.log(`  canonical atoms: ${canonical.length}`);
  console.log(`  state_id: ${stateId.slice(0, 16)}…`);
  console.log(`  raw_tree_hash: ${rawTreeHash.slice(0, 16)}…`);
  console.log(`  saved to ${savePath}`);

  return record;
}

function diffCanonical(a: Atom[], b: Atom[]): { only_in_a: Atom[]; only_in_b: Atom[] } {
  const key = (atom: Atom) => `${atom.role}|${atom.accessible_name}|${JSON.stringify(atom.attrs)}`;
  const aSet = new Map(a.map((x) => [key(x), x]));
  const bSet = new Map(b.map((x) => [key(x), x]));

  const only_in_a: Atom[] = [];
  const only_in_b: Atom[] = [];

  for (const [k, atom] of aSet) {
    if (!bSet.has(k)) only_in_a.push(atom);
  }
  for (const [k, atom] of bSet) {
    if (!aSet.has(k)) only_in_b.push(atom);
  }

  return { only_in_a, only_in_b };
}

async function main(): Promise<void> {
  console.log('[siteforge-probe] launching Chrome (headed)…');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://www.instagram.com/');
  await pause('Log in to Instagram in the browser window. Then come back here.');

  console.log(`[siteforge-probe] navigating to target: ${TARGET_URL}`);
  await page.goto(TARGET_URL);
  await pause('Wait for the page to fully render. Then come back here.');

  const cap1 = await captureAndHash(page, 'CAPTURE #1', '/tmp/siteforge-probe-1.json');

  console.log(`\n[siteforge-probe] navigating elsewhere: ${ELSEWHERE_URL}`);
  await page.goto(ELSEWHERE_URL);
  await page.waitForTimeout(3000);

  console.log(`[siteforge-probe] navigating back to target: ${TARGET_URL}`);
  await page.goto(TARGET_URL);
  await pause('Wait for the page to fully render. Then come back here.');

  const cap2 = await captureAndHash(page, 'CAPTURE #2', '/tmp/siteforge-probe-2.json');

  console.log('\n[siteforge-probe] === VERDICT ===');
  if (cap1.state_id === cap2.state_id) {
    console.log('  ✅ HASHES MATCH — invariant holds. Canonicalizer is good enough for this page.');
  } else {
    console.log('  ❌ HASHES DIFFER — canonicalizer needs work.');
    const diff = diffCanonical(cap1.canonical_atoms, cap2.canonical_atoms);
    console.log(`     ${diff.only_in_a.length} atoms only in capture #1`);
    console.log(`     ${diff.only_in_b.length} atoms only in capture #2`);
    writeFileSync('/tmp/siteforge-probe-diff.json', JSON.stringify(diff, null, 2));
    console.log('     full diff saved to /tmp/siteforge-probe-diff.json');
    if (diff.only_in_a.length <= 10 && diff.only_in_b.length <= 10) {
      console.log('\n     atoms only in #1:');
      for (const a of diff.only_in_a) console.log(`       - ${a.role}: ${a.accessible_name}`);
      console.log('\n     atoms only in #2:');
      for (const a of diff.only_in_b) console.log(`       - ${a.role}: ${a.accessible_name}`);
    }
  }

  console.log('\n[siteforge-probe] raw_tree hashes:');
  console.log(`  #1: ${cap1.raw_tree_hash.slice(0, 16)}…`);
  console.log(`  #2: ${cap2.raw_tree_hash.slice(0, 16)}…`);
  console.log(`  ${cap1.raw_tree_hash === cap2.raw_tree_hash ? 'identical' : 'differ'}`);
  console.log(
    '  (raw trees usually DIFFER even when canonical hashes match — that\'s the whole point.)',
  );

  await pause('Inspection time. Open the JSON files if you want. Then press ENTER to close.');
  await browser.close();
  exit(cap1.state_id === cap2.state_id ? 0 : 1);
}

main().catch((err) => {
  console.error('[siteforge-probe] error:', err);
  exit(2);
});
