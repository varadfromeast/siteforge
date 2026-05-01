/**
 * Live visual inspector for the CDP Chrome used by `npm run map`.
 *
 * Run `npm run map` in one terminal, click around, then run this in another:
 *
 *   npm run inspect:live
 *   npm run inspect:live -- --duration 120 --interval-ms 3000
 *
 * It attaches to the same Chrome, does not resize the viewport, and writes
 * screenshot+atom snapshots to `.siteforge/inspections/<timestamp>/`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import { captureSnapshot, classifyState, surfaceAtoms } from '../src/snapshot/index.js';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

interface Args {
  durationSeconds: number;
  intervalMs: number;
}

const ARGS = parseArgs(process.argv.slice(2));
const RUN_DIR = resolve('.siteforge', 'inspections', new Date().toISOString().replace(/[:.]/g, '-'));
const SHOT_DIR = resolve(RUN_DIR, 'screenshots');
const SNAP_DIR = resolve(RUN_DIR, 'snapshots');
const SUMMARY_PATH = resolve(RUN_DIR, 'summary.json');

function parseArgs(argv: string[]): Args {
  let durationSeconds = 60;
  let intervalMs = 2500;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--duration') {
      durationSeconds = Number.parseInt(argv[++i] ?? '', 10);
    } else if (arg === '--interval-ms') {
      intervalMs = Number.parseInt(argv[++i] ?? '', 10);
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 5) durationSeconds = 60;
  if (!Number.isFinite(intervalMs) || intervalMs < 500) intervalMs = 2500;
  return { durationSeconds, intervalMs };
}

async function connectToInstagramPage(): Promise<Page> {
  const cdpUrl = process.env['SITEFORGE_CDP_URL'] ?? DEFAULT_CDP_URL;
  const isListening = await cdpListening(cdpUrl);
  if (!isListening) {
    throw new Error(
      `No CDP Chrome listening at ${cdpUrl}. Start npm run map first, or launch Chrome with --remote-debugging-port=9222.`,
    );
  }

  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: null }));
  return pickInstagramPage(context);
}

async function cdpListening(cdpUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(750) });
    return res.ok;
  } catch {
    return false;
  }
}

async function pickInstagramPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const instagram = pages.find((page) => page.url().includes('instagram.com'));
  if (instagram) return instagram;
  return pages[0] ?? (await context.newPage());
}

async function inspect(page: Page, index: number): Promise<Record<string, unknown>> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(300);

  const snap = await captureSnapshot(page);
  const canonical = canonicalizeAtoms(snap.atoms);
  const surface = surfaceAtoms(canonical, snap.url);
  const stateId = hashAtomSet(canonical);
  const surfaceId = hashAtomSet(surface);
  const screenshotPath = resolve(SHOT_DIR, `${String(index).padStart(4, '0')}-${surfaceId.slice(0, 12)}.png`);
  const snapshotPath = resolve(SNAP_DIR, `${String(index).padStart(4, '0')}-${surfaceId.slice(0, 12)}.json`);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  const record = {
    index,
    captured_at: new Date().toISOString(),
    url: snap.url,
    title: await page.title().catch(() => ''),
    viewport: page.viewportSize(),
    kind: classifyState(snap),
    state_id: stateId,
    surface_id: surfaceId,
    raw_tree_hash: hashValue(snap.raw_tree),
    atoms_raw_count: snap.atoms.length,
    atoms_canonical_count: canonical.length,
    atoms_surface_count: surface.length,
    surface_atoms: surface,
    canonical_atoms: canonical,
    screenshot_path: screenshotPath,
    snapshot_path: snapshotPath,
  };

  writeFileSync(snapshotPath, JSON.stringify({ ...record, raw_atoms: snap.atoms }, null, 2));
  return record;
}

function writeSummary(records: Array<Record<string, unknown>>): void {
  writeFileSync(
    SUMMARY_PATH,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(SNAP_DIR, { recursive: true });
  console.log(`[siteforge-inspect] output dir: ${RUN_DIR}`);

  const page = await connectToInstagramPage();
  const records: Array<Record<string, unknown>> = [];
  const endAt = Date.now() + ARGS.durationSeconds * 1000;
  let lastSignature = '';
  let index = 0;

  while (Date.now() < endAt) {
    const record = await inspect(page, ++index);
    const signature = `${record['surface_id']}|${record['url']}`;
    records.push(record);
    writeSummary(records);

    const changed = signature !== lastSignature ? '*' : ' ';
    lastSignature = signature;
    console.log(
      `[siteforge-inspect]${changed} ${String(index).padStart(4, '0')} ${String(record['kind'])} surface=${String(record['atoms_surface_count'])} url=${String(record['url'])}`,
    );

    await sleep(ARGS.intervalMs);
  }

  writeSummary(records);
  console.log(`[siteforge-inspect] summary: ${SUMMARY_PATH}`);
  exit(0);
}

main().catch((err) => {
  console.error('[siteforge-inspect] error:', err);
  exit(2);
});
