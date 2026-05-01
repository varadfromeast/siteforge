/**
 * Focused Instagram coverage harness.
 *
 * This is the bridge between today's manual mapper and `src/explorer`:
 * Playwright drives a small, safe flow suite while we capture snapshots,
 * screenshots, and surface atoms at every step.
 *
 * Usage:
 *   npm run cover:instagram
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';
import { chromium, type Page } from 'playwright';
import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import { captureSnapshot, classifyState, surfaceAtoms } from '../src/snapshot/index.js';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const RUN_DIR = resolve('.siteforge', 'coverage', new Date().toISOString().replace(/[:.]/g, '-'));
const SHOT_DIR = resolve(RUN_DIR, 'screenshots');
const SNAP_DIR = resolve(RUN_DIR, 'snapshots');
const REPORT_PATH = resolve(RUN_DIR, 'report.json');

interface CoverageRecord {
  name: string;
  status: 'ok' | 'failed';
  error?: string;
  url?: string;
  kind?: string;
  state_id?: string;
  surface_id?: string;
  raw_tree_hash?: string;
  atoms_raw_count?: number;
  atoms_canonical_count?: number;
  atoms_surface_count?: number;
  surface_atoms?: Array<{ role: string; accessible_name: string; attrs: Record<string, string> }>;
  screenshot_path?: string;
  snapshot_path?: string;
}

async function connectPage(): Promise<Page> {
  const cdpUrl = process.env['SITEFORGE_CDP_URL'] ?? DEFAULT_CDP_URL;
  const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(1000) });
  if (!res.ok) throw new Error(`CDP Chrome is not listening at ${cdpUrl}`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: null }));
  const page =
    context.pages().find((candidate) => candidate.url().includes('instagram.com')) ??
    context.pages()[0] ??
    (await context.newPage());
  return page;
}

async function capture(page: Page, name: string, records: CoverageRecord[]): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(900);

  let snap = await captureSnapshot(page);
  let canonical = canonicalizeAtoms(snap.atoms);
  let surface = surfaceAtoms(canonical, snap.url);
  for (let attempt = 0; attempt < 6 && (canonical.length === 0 || surface.length === 0); attempt++) {
    await page.waitForTimeout(750);
    snap = await captureSnapshot(page);
    canonical = canonicalizeAtoms(snap.atoms);
    surface = surfaceAtoms(canonical, snap.url);
  }
  const stateId = hashAtomSet(canonical);
  const surfaceId = hashAtomSet(surface);
  const index = String(records.length + 1).padStart(2, '0');
  const safeName = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const screenshotPath = resolve(SHOT_DIR, `${index}-${safeName}-${surfaceId.slice(0, 12)}.png`);
  const snapshotPath = resolve(SNAP_DIR, `${index}-${safeName}-${surfaceId.slice(0, 12)}.json`);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  const record: CoverageRecord = {
    name,
    status: 'ok',
    url: snap.url,
    kind: classifyState(snap),
    state_id: stateId,
    surface_id: surfaceId,
    raw_tree_hash: hashValue(snap.raw_tree),
    atoms_raw_count: snap.atoms.length,
    atoms_canonical_count: canonical.length,
    atoms_surface_count: surface.length,
    surface_atoms: surface,
    screenshot_path: screenshotPath,
    snapshot_path: snapshotPath,
  };

  writeFileSync(snapshotPath, JSON.stringify({ ...record, canonical_atoms: canonical, raw_atoms: snap.atoms }, null, 2));
  records.push(record);
  writeReport(records);

  console.log(
    `[siteforge-cover] ${name}: ${record.kind} surface=${record.atoms_surface_count} ${surfaceId.slice(0, 12)} ${snap.url}`,
  );
}

async function step(name: string, records: CoverageRecord[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    const record: CoverageRecord = {
      name,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    records.push(record);
    writeReport(records);
    console.log(`[siteforge-cover] ${name}: failed: ${record.error}`);
  }
}

async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

async function clickFirst(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    await locator.click({ timeout: 5000 });
    return;
  }
  throw new Error(`No clickable selector matched: ${selectors.join(', ')}`);
}

async function clickRole(page: Page, role: 'button' | 'link' | 'tab', name: RegExp): Promise<void> {
  await page.getByRole(role, { name }).first().click({ timeout: 7000 });
}

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(SNAP_DIR, { recursive: true });
  console.log(`[siteforge-cover] output dir: ${RUN_DIR}`);

  const page = await connectPage();
  await page.bringToFront();
  const records: CoverageRecord[] = [];

  await step('home', records, async () => {
    await goto(page, 'https://www.instagram.com/');
    await capture(page, 'home', records);
  });

  await step('direct inbox', records, async () => {
    await goto(page, 'https://www.instagram.com/direct/inbox/');
    await capture(page, 'direct inbox', records);
  });

  await step('direct thread', records, async () => {
    await clickFirst(page, ['[role="button"]:has-text("Animesh")', '[role="button"]:has-text("You:")', '[role="button"]:has-text("sent")']);
    await capture(page, 'direct thread', records);
  });

  await step('profile', records, async () => {
    await goto(page, 'https://www.instagram.com/varad.th/');
    await capture(page, 'profile', records);
  });

  await step('profile reels tab', records, async () => {
    await goto(page, 'https://www.instagram.com/varad.th/');
    const profileReelsTab = page
      .locator('a[href="/varad.th/reels/"], a[href="https://www.instagram.com/varad.th/reels/"]')
      .first();
    if ((await profileReelsTab.count()) > 0) {
      await profileReelsTab.click({ timeout: 7000 });
    } else {
      await goto(page, 'https://www.instagram.com/varad.th/reels/');
    }
    await capture(page, 'profile reels tab', records);
  });

  await step('reels feed', records, async () => {
    await goto(page, 'https://www.instagram.com/reels/');
    await capture(page, 'reels feed', records);
  });

  await step('reel comments surface', records, async () => {
    await clickFirst(page, ['[aria-label="Comment"]', '[aria-label="comment"]', 'svg[aria-label="Comment"]']);
    await capture(page, 'reel comments surface', records);
  });

  await step('search panel', records, async () => {
    await goto(page, 'https://www.instagram.com/');
    await clickRole(page, 'link', /^search$/i);
    await page.getByRole('textbox').first().fill('instagram');
    await capture(page, 'search panel', records);
  });

  writeReport(records);
  const failed = records.filter((record) => record.status === 'failed').length;
  console.log(`[siteforge-cover] report: ${REPORT_PATH}`);
  console.log(`[siteforge-cover] completed ${records.length - failed}/${records.length} steps`);
  exit(failed === 0 ? 0 : 1);
}

function writeReport(records: CoverageRecord[]): void {
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        run_dir: RUN_DIR,
        screenshots_dir: SHOT_DIR,
        snapshots_dir: SNAP_DIR,
        records,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('[siteforge-cover] error:', err);
  exit(2);
});
