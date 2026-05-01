/**
 * v0.0.2 live test harness.
 *
 * Goal: validate the foundational invariant —
 *   "two visits to the same logical page produce the same state hash"
 *
 * Usage:
 *   npm run probe -- https://www.instagram.com/<your-username>/
 *   npm run probe -- https://www.instagram.com/user1/ https://www.instagram.com/user2/ https://www.instagram.com/user3/
 *   npm run probe -- --discover-profiles 3
 *   SITEFORGE_CDP_URL=http://127.0.0.1:9222 npm run probe -- ...
 *
 * Flow:
 *   1. Reuse a CDP-enabled Chrome if available, otherwise open headed Chrome.
 *   2. Wait for you to log in. Press ENTER when ready.
 *   3. For each target URL, capture it twice with an elsewhere navigation between.
 *   4. Save captures, diffs, and summary under .siteforge/probes/<timestamp>/.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout, exit } from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import { captureSnapshot, surfaceAtoms } from '../src/snapshot/index.js';
import type { Atom } from '../src/core/types.js';

interface ProbeArgs {
  targetUrls: string[];
  discoverProfiles: number;
}

const ARGS = parseArgs(process.argv.slice(2));
let TARGET_URLS = ARGS.targetUrls.length > 0 ? ARGS.targetUrls : ['https://www.instagram.com/'];
const ELSEWHERE_URL = 'https://www.instagram.com/explore/';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const RESERVED_INSTAGRAM_PATHS = new Set([
  'about',
  'accounts',
  'api',
  'blog',
  'business',
  'challenge',
  'developer',
  'direct',
  'explore',
  'graphql',
  'legal',
  'oauth',
  'p',
  'privacy',
  'reel',
  'reels',
  'stories',
  'terms',
  'web',
]);
const RUN_DIR = resolve(
  '.siteforge',
  'probes',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  attached: boolean;
}

function parseArgs(argv: string[]): ProbeArgs {
  const targetUrls: string[] = [];
  let discoverProfiles = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--discover-profiles') {
      const raw = argv[++i];
      discoverProfiles = raw ? Number.parseInt(raw, 10) : 3;
      if (!Number.isFinite(discoverProfiles) || discoverProfiles < 1) discoverProfiles = 3;
    } else {
      targetUrls.push(arg);
    }
  }

  return { targetUrls, discoverProfiles };
}

async function pause(prompt: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(`\n[siteforge-probe] ${prompt} (press ENTER) `);
  rl.close();
}

async function detectCdpUrl(): Promise<string | null> {
  if (process.env['SITEFORGE_CDP_URL']) return process.env['SITEFORGE_CDP_URL'];

  try {
    const res = await fetch(`${DEFAULT_CDP_URL}/json/version`, { signal: AbortSignal.timeout(500) });
    if (res.ok) return DEFAULT_CDP_URL;
  } catch {
    // No reusable Chrome listening on the default debugging port.
  }

  return null;
}

async function openBrowserSession(): Promise<BrowserSession> {
  let cdpUrl = await detectCdpUrl();
  if (!cdpUrl) {
    cdpUrl = await launchReusableChrome();
  }

  if (cdpUrl) {
    console.log(`[siteforge-probe] attaching to existing Chrome via CDP: ${cdpUrl}`);
    try {
      const browser = await chromium.connectOverCDP(cdpUrl);
      const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 900 } }));
      const page =
        context.pages().find((candidate) => candidate.url().includes('instagram.com')) ??
        context.pages()[0] ??
        (await context.newPage());
      await page.setViewportSize({ width: 1280, height: 900 }).catch(() => undefined);
      return { browser, context, page, attached: true };
    } catch (err) {
      console.warn(
        `[siteforge-probe] could not attach to ${cdpUrl}; launching a new Chrome instead.`,
      );
      console.warn(`  ${(err as Error).message.split('\n')[0]}`);
    }
  }

  console.log('[siteforge-probe] launching Chrome (headed)…');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  return { browser, context, page, attached: false };
}

async function launchReusableChrome(): Promise<string | null> {
  const chromePath = systemChromePath();
  if (!chromePath) return null;

  mkdirSync(resolve('.siteforge', 'chrome-cdp'), { recursive: true });
  console.log(`[siteforge-probe] starting reusable Chrome with CDP: ${DEFAULT_CDP_URL}`);
  spawn(chromePath, [
    `--remote-debugging-port=${new URL(DEFAULT_CDP_URL).port}`,
    `--user-data-dir=${resolve('.siteforge', 'chrome-cdp')}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], {
    detached: true,
    stdio: 'ignore',
  }).unref();

  return waitForCdpUrl(DEFAULT_CDP_URL, 5000);
}

function systemChromePath(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          `${process.env['HOME']}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        ]
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

  for (const candidate of candidates) {
    if (candidate.includes('/') && existsSync(candidate)) return candidate;
  }

  return process.platform === 'darwin' ? null : candidates[0]!;
}

async function waitForCdpUrl(url: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return url;
    } catch {
      // Keep waiting for Chrome to bind the debugging port.
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }
  return null;
}

interface CaptureRecord {
  url: string;
  atoms_raw_count: number;
  atoms_canonical_count: number;
  state_id: string;
  atoms_surface_count: number;
  surface_id: string;
  raw_tree_hash: string;
  canonical_atoms: Atom[];
  surface_atoms: Atom[];
}

interface TargetSummary {
  target_url: string;
  capture_1_path: string;
  capture_2_path: string;
  diff_path?: string;
  state_id_1: string;
  state_id_2: string;
  surface_id_1: string;
  surface_id_2: string;
  hashes_match: boolean;
  surface_hashes_match: boolean;
  atoms_raw_count_1: number;
  atoms_raw_count_2: number;
  atoms_canonical_count_1: number;
  atoms_canonical_count_2: number;
  atoms_surface_count_1: number;
  atoms_surface_count_2: number;
  only_in_1_count: number;
  only_in_2_count: number;
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
  const surface = surfaceAtoms(canonical, snap.url);
  const surfaceId = hashAtomSet(surface);
  const rawTreeHash = hashValue(snap.raw_tree);

  const record: CaptureRecord = {
    url: snap.url,
    atoms_raw_count: snap.atoms.length,
    atoms_canonical_count: canonical.length,
    state_id: stateId,
    atoms_surface_count: surface.length,
    surface_id: surfaceId,
    raw_tree_hash: rawTreeHash,
    canonical_atoms: canonical,
    surface_atoms: surface,
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
  console.log(`  surface atoms: ${surface.length}`);
  console.log(`  state_id: ${stateId.slice(0, 16)}…`);
  console.log(`  surface_id: ${surfaceId.slice(0, 16)}…`);
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

function safeSlug(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9_.-]+/gi, '-');
    return `${String(index + 1).padStart(2, '0')}-${path || parsed.hostname}`;
  } catch {
    return `${String(index + 1).padStart(2, '0')}-target`;
  }
}

async function discoverProfileUrls(page: Page, count: number): Promise<string[]> {
  console.log(`\n[siteforge-probe] discovering ${count} random profile URL(s)…`);
  const found = new Set<string>();

  await page.goto(ELSEWHERE_URL);
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(3000);
  addProfileCandidates(found, await collectProfileLinks(page));

  for (let attempt = 0; found.size < count && attempt < count * 4; attempt++) {
    const postLinks = shuffle(await collectPostLinks(page)).slice(0, 6);
    const postHref = postLinks[attempt % Math.max(postLinks.length, 1)];

    if (!postHref) {
      await page.mouse.wheel(0, 1200).catch(() => undefined);
      await page.waitForTimeout(1500);
      addProfileCandidates(found, await collectProfileLinks(page));
      continue;
    }

    console.log(`[siteforge-probe] opening discovery post: ${postHref}`);
    const before = page.url();
    await clickHref(page, postHref);
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(2500);
    addProfileCandidates(found, await collectProfileLinks(page));

    if (page.url() !== before) {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
    } else {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await page.waitForTimeout(1000);
  }

  const urls = shuffle([...found]).slice(0, count);
  console.log(`[siteforge-probe] discovered ${urls.length} profile URL(s):`);
  for (const url of urls) console.log(`  - ${url}`);
  return urls;
}

async function collectProfileLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => a.href));
}

async function collectPostLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .map((a) => a.href)
      .filter((href) => /instagram\.com\/(p|reel)\//.test(href)),
  );
}

function addProfileCandidates(out: Set<string>, hrefs: string[]): void {
  for (const href of hrefs) {
    const profileUrl = normalizeProfileUrl(href);
    if (profileUrl) out.add(profileUrl);
  }
}

function normalizeProfileUrl(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.instagram.com/');
    if (!url.hostname.endsWith('instagram.com')) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null;

    const handle = parts[0]!.toLowerCase();
    if (RESERVED_INSTAGRAM_PATHS.has(handle)) return null;
    if (!/^[a-z0-9._]{2,30}$/.test(handle)) return null;

    return `https://www.instagram.com/${handle}/`;
  } catch {
    return null;
  }
}

async function clickHref(page: Page, href: string): Promise<void> {
  const clicked = await page
    .locator(`a[href="${new URL(href).pathname}"], a[href="${href}"]`)
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!clicked) await page.goto(href);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function probeTarget(page: Page, targetUrl: string, index: number): Promise<TargetSummary> {
  const slug = safeSlug(targetUrl, index);
  const cap1Path = resolve(RUN_DIR, `${slug}-capture-1.json`);
  const cap2Path = resolve(RUN_DIR, `${slug}-capture-2.json`);
  const diffPath = resolve(RUN_DIR, `${slug}-diff.json`);

  console.log(`\n[siteforge-probe] target ${index + 1}/${TARGET_URLS.length}: ${targetUrl}`);
  await page.goto(targetUrl);
  await pause('Wait for this profile to fully render. Then come back here.');

  const cap1 = await captureAndHash(page, `${slug} CAPTURE #1`, cap1Path);

  console.log(`\n[siteforge-probe] navigating elsewhere: ${ELSEWHERE_URL}`);
  await page.goto(ELSEWHERE_URL);
  await page.waitForTimeout(3000);

  console.log(`[siteforge-probe] navigating back to target: ${targetUrl}`);
  await page.goto(targetUrl);
  await pause('Wait for this profile to fully render again. Then come back here.');

  const cap2 = await captureAndHash(page, `${slug} CAPTURE #2`, cap2Path);
  const diff = diffCanonical(cap1.canonical_atoms, cap2.canonical_atoms);
  const hashesMatch = cap1.state_id === cap2.state_id;

  console.log(`\n[siteforge-probe] ${slug} VERDICT`);
  if (hashesMatch) {
    console.log('  ✅ HASHES MATCH — invariant holds for this profile.');
  } else {
    console.log('  ❌ HASHES DIFFER — canonicalizer needs work for this profile.');
    console.log(`     ${diff.only_in_a.length} atoms only in capture #1`);
    console.log(`     ${diff.only_in_b.length} atoms only in capture #2`);
    writeFileSync(diffPath, JSON.stringify(diff, null, 2));
    console.log(`     full diff saved to ${diffPath}`);
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

  return {
    target_url: targetUrl,
    capture_1_path: cap1Path,
    capture_2_path: cap2Path,
    diff_path: hashesMatch ? undefined : diffPath,
    state_id_1: cap1.state_id,
    state_id_2: cap2.state_id,
    surface_id_1: cap1.surface_id,
    surface_id_2: cap2.surface_id,
    hashes_match: hashesMatch,
    surface_hashes_match: cap1.surface_id === cap2.surface_id,
    atoms_raw_count_1: cap1.atoms_raw_count,
    atoms_raw_count_2: cap2.atoms_raw_count,
    atoms_canonical_count_1: cap1.atoms_canonical_count,
    atoms_canonical_count_2: cap2.atoms_canonical_count,
    atoms_surface_count_1: cap1.atoms_surface_count,
    atoms_surface_count_2: cap2.atoms_surface_count,
    only_in_1_count: diff.only_in_a.length,
    only_in_2_count: diff.only_in_b.length,
  };
}

async function main(): Promise<void> {
  mkdirSync(RUN_DIR, { recursive: true });

  console.log(`[siteforge-probe] output dir: ${RUN_DIR}`);
  const session = await openBrowserSession();
  const { browser, page } = session;

  await page.goto('https://www.instagram.com/');
  await pause('Log in to Instagram in the browser window. Then come back here.');

  if (ARGS.discoverProfiles > 0) {
    TARGET_URLS = await discoverProfileUrls(page, ARGS.discoverProfiles);
    if (TARGET_URLS.length === 0) {
      throw new Error('No profile URLs discovered. Try opening Explore or a post in the browser, then rerun.');
    }
  }

  const summaries: TargetSummary[] = [];
  for (const [index, targetUrl] of TARGET_URLS.entries()) {
    summaries.push(await probeTarget(page, targetUrl, index));
  }

  const summaryPath = resolve(RUN_DIR, 'summary.json');
  writeFileSync(summaryPath, JSON.stringify({ run_dir: RUN_DIR, targets: summaries }, null, 2));

  const failed = summaries.filter((summary) => !summary.hashes_match);
  console.log('\n[siteforge-probe] === RUN SUMMARY ===');
  console.log(`  output dir: ${RUN_DIR}`);
  console.log(`  summary: ${summaryPath}`);
  console.log(`  targets checked: ${summaries.length}`);
  console.log(`  matching targets: ${summaries.length - failed.length}`);
  console.log(`  differing targets: ${failed.length}`);
  console.log('  raw trees usually differ even when canonical hashes match — that is the point.');

  await pause('Inspection time. Open the JSON files if you want. Then press ENTER to close.');
  if (!session.attached) await browser.close();
  exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[siteforge-probe] error:', err);
  exit(2);
});
