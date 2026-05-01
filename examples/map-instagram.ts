/**
 * Interactive Instagram mapper.
 *
 * Usage:
 *   npm run map
 *   npm run map -- --start https://www.instagram.com/reels/ --duration 300
 *
 * Flow:
 *   1. Reuse/start a CDP-enabled Chrome and keep it open.
 *   2. You click anywhere: profiles, reels, comments, tabs, search, modals.
 *   3. The mapper polls the current page, captures atoms, and records new
 *      surface states + observed transitions.
 *   4. Output: .siteforge/maps/<timestamp>/{site-map.json,captures/*.json}
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { canonicalizeAtoms, hashAtomSet, hashValue } from '../src/core/index.js';
import { captureSnapshot, classifyState, surfaceAtoms } from '../src/snapshot/index.js';
import type { Atom, OpType, StateKind } from '../src/core/types.js';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

/**
 * Maximum age of a recorded click (ms) before we consider it stale and refuse
 * to attach it to a state transition. Catches the case where a user clicks
 * something, then sits idle, then IG auto-refreshes the feed: without this
 * window the old click would falsely attach to the auto-refresh edge.
 */
const CLICK_STALENESS_MS = 5_000;

interface Args {
  startUrl: string;
  durationSeconds: number;
  intervalMs: number;
}

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  attached: boolean;
}

interface LastClick {
  text: string;
  href: string | null;
  role: string | null;
  at: number;
}

interface MapNode {
  id: string;
  kind: StateKind;
  label: string;
  first_seen: string;
  last_seen: string;
  visits: number;
  url_samples: string[];
  state_ids: string[];
  raw_atoms_count: number;
  canonical_atoms_count: number;
  surface_atoms_count: number;
  surface_atoms: Atom[];
  capture_paths: string[];
}

interface MapEdge {
  id: string;
  from: string;
  to: string;
  count: number;
  first_seen: string;
  last_seen: string;
  from_url: string;
  to_url: string;
  /**
   * What kind of action drove this transition.
   *
   * - `click`: a recorded click on a button/link/role-bearing element.
   * - `navigate`: URL changed without a recorded click (back button, manual
   *   URL bar, programmatic navigation, or a click that escaped the recorder).
   * - `fill`: a textbox/searchbox interaction.
   *
   * Maps directly to `OpType` in core/types.ts so this field is ready to be
   * used as `Operation.op_type` when we export to a real SiteGraph later.
   */
  op_type: OpType;
  last_click?: LastClick;
}

interface SiteMap {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  start_url: string;
  nodes: Record<string, MapNode>;
  edges: MapEdge[];
}

interface CaptureRecord {
  url: string;
  kind: StateKind;
  state_id: string;
  surface_id: string;
  raw_tree_hash: string;
  atoms_raw_count: number;
  atoms_canonical_count: number;
  atoms_surface_count: number;
  raw_atoms: Atom[];
  canonical_atoms: Atom[];
  surface_atoms: Atom[];
  last_click?: LastClick;
}

const ARGS = parseArgs(process.argv.slice(2));
const RUN_DIR = resolve('.siteforge', 'maps', new Date().toISOString().replace(/[:.]/g, '-'));
const CAPTURE_DIR = resolve(RUN_DIR, 'captures');
const MAP_PATH = resolve(RUN_DIR, 'site-map.json');

function parseArgs(argv: string[]): Args {
  let startUrl = 'https://www.instagram.com/';
  let durationSeconds = 300;
  let intervalMs = 2000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--start') {
      startUrl = argv[++i] ?? startUrl;
    } else if (arg === '--duration') {
      durationSeconds = Number.parseInt(argv[++i] ?? '', 10);
    } else if (arg === '--interval-ms') {
      intervalMs = Number.parseInt(argv[++i] ?? '', 10);
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 10) durationSeconds = 300;
  if (!Number.isFinite(intervalMs) || intervalMs < 500) intervalMs = 2000;

  return { startUrl, durationSeconds, intervalMs };
}

async function pause(prompt: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(`\n[siteforge-map] ${prompt} (press ENTER) `);
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
  if (!cdpUrl) cdpUrl = await launchReusableChrome();

  if (cdpUrl) {
    console.log(`[siteforge-map] attaching to Chrome via CDP: ${cdpUrl}`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    // We're attaching to a Chrome window the user owns. Do NOT force a
    // fixed viewport — Page.setViewportSize() resizes the actual rendered
    // viewport, which on the user's own window cropped the page so the
    // footer / lower buttons disappeared off-screen. Use `viewport: null`
    // on any new context so it inherits the real window size.
    const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: null }));
    const page =
      context.pages().find((candidate) => candidate.url().includes('instagram.com')) ??
      context.pages()[0] ??
      (await context.newPage());
    return { browser, context, page, attached: true };
  }

  console.log('[siteforge-map] launching fallback Chrome (headed)…');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  return { browser, context, page, attached: false };
}

async function launchReusableChrome(): Promise<string | null> {
  const chromePath = systemChromePath();
  if (!chromePath) return null;

  mkdirSync(resolve('.siteforge', 'chrome-cdp'), { recursive: true });
  console.log(`[siteforge-map] starting reusable Chrome with CDP: ${DEFAULT_CDP_URL}`);
  spawn(
    chromePath,
    [
      `--remote-debugging-port=${new URL(DEFAULT_CDP_URL).port}`,
      `--user-data-dir=${resolve('.siteforge', 'chrome-cdp')}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();

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
    await sleep(250);
  }
  return null;
}

async function installClickRecorder(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const win = window as typeof window & {
        __siteforgeClickRecorderInstalled?: boolean;
        __siteforgeLastClick?: LastClick;
      };

      if (win.__siteforgeClickRecorderInstalled) return;
      win.__siteforgeClickRecorderInstalled = true;
      window.addEventListener(
        'click',
        (event) => {
          const target = event.target instanceof Element ? event.target.closest('a,button,[role]') : null;
          if (!target) return;
          win.__siteforgeLastClick = {
            text: (target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
            href: target instanceof HTMLAnchorElement ? target.href : target.getAttribute('href'),
            role: target.getAttribute('role') ?? target.tagName.toLowerCase(),
            at: Date.now(),
          };
        },
        true,
      );
    })
    .catch(() => undefined);
}

/**
 * Read the most recent click from the page and clear it. Clearing prevents an
 * old click from being attached to a later state change that wasn't actually
 * caused by it (e.g. the user clicks, idles, IG auto-refreshes the feed).
 *
 * Also enforces a staleness window: a click older than `CLICK_STALENESS_MS`
 * is treated as if no click had been recorded.
 */
async function readLastClick(page: Page): Promise<LastClick | undefined> {
  const click = await page
    .evaluate(() => {
      const win = window as typeof window & { __siteforgeLastClick?: LastClick };
      const value = win.__siteforgeLastClick;
      win.__siteforgeLastClick = undefined;
      return value;
    })
    .catch(() => undefined);

  if (!click) return undefined;
  if (Date.now() - click.at > CLICK_STALENESS_MS) return undefined;
  return click;
}

async function captureCurrent(page: Page): Promise<CaptureRecord> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(600);

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
  const kind = classifyState(snap);
  const lastClick = await readLastClick(page);

  const record: CaptureRecord = {
    url: snap.url,
    kind,
    state_id: stateId,
    surface_id: surfaceId,
    raw_tree_hash: hashValue(snap.raw_tree),
    atoms_raw_count: snap.atoms.length,
    atoms_canonical_count: canonical.length,
    atoms_surface_count: surface.length,
    raw_atoms: snap.atoms,
    canonical_atoms: canonical,
    surface_atoms: surface,
    last_click: lastClick,
  };

  return record;
}

function writeCapture(index: number, record: CaptureRecord): string {
  const capturePath = resolve(CAPTURE_DIR, `${String(index).padStart(4, '0')}-${record.surface_id.slice(0, 12)}.json`);
  writeFileSync(capturePath, JSON.stringify(record, null, 2));
  return capturePath;
}

function mergeNode(map: SiteMap, record: CaptureRecord, capturePath: string): void {
  const now = new Date().toISOString();
  const existing = map.nodes[record.surface_id];
  if (!existing) {
    map.nodes[record.surface_id] = {
      id: record.surface_id,
      kind: record.kind,
      label: labelForRecord(record),
      first_seen: now,
      last_seen: now,
      visits: 1,
      url_samples: [record.url],
      state_ids: [record.state_id],
      raw_atoms_count: record.atoms_raw_count,
      canonical_atoms_count: record.atoms_canonical_count,
      surface_atoms_count: record.atoms_surface_count,
      surface_atoms: record.surface_atoms,
      capture_paths: [capturePath],
    };
    return;
  }

  existing.last_seen = now;
  existing.visits++;
  if (!existing.url_samples.includes(record.url)) existing.url_samples.push(record.url);
  if (!existing.state_ids.includes(record.state_id)) existing.state_ids.push(record.state_id);
  existing.raw_atoms_count = record.atoms_raw_count;
  existing.canonical_atoms_count = record.atoms_canonical_count;
  existing.surface_atoms_count = record.atoms_surface_count;
  existing.surface_atoms = record.surface_atoms;
  existing.capture_paths.push(capturePath);
}

function mergeEdge(map: SiteMap, from: CaptureRecord, to: CaptureRecord): void {
  if (from.surface_id === to.surface_id && from.url === to.url) return;

  const now = new Date().toISOString();
  const id = `${from.surface_id.slice(0, 12)}->${to.surface_id.slice(0, 12)}`;
  const opType = inferOpType(to);
  const existing = map.edges.find((edge) => edge.id === id);
  if (existing) {
    existing.count++;
    existing.last_seen = now;
    existing.to_url = to.url;
    existing.last_click = to.last_click;
    // Promote op_type only if we got a stronger signal this time.
    if (existing.op_type === 'navigate' && opType !== 'navigate') {
      existing.op_type = opType;
    }
    return;
  }

  map.edges.push({
    id,
    from: from.surface_id,
    to: to.surface_id,
    count: 1,
    first_seen: now,
    last_seen: now,
    from_url: from.url,
    to_url: to.url,
    op_type: opType,
    last_click: to.last_click,
  });
}

/**
 * Derive an `OpType` from the recorded click on the destination capture.
 *
 * - No click recorded → `navigate` (back button, URL bar, auto-refresh).
 * - Click on input-shaped element → `fill`.
 * - Click on submit-flavoured button text → `submit`.
 * - Anything else with a click → `click`.
 */
function inferOpType(to: CaptureRecord): OpType {
  const click = to.last_click;
  if (!click) return 'navigate';

  const role = (click.role ?? '').toLowerCase();
  const text = click.text.toLowerCase();

  if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'input') {
    return 'fill';
  }
  if (/\b(submit|send|post|publish|share|save changes|sign in|log in|sign up)\b/.test(text)) {
    return 'submit';
  }
  return 'click';
}

function labelForRecord(record: CaptureRecord): string {
  const urlLabel = labelFromUrl(record.url);
  if (urlLabel) return urlLabel;
  const first = record.surface_atoms[0]?.accessible_name;
  return first ? `${record.kind}: ${first}` : record.kind;
}

function labelFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'reel') return `reel/${parts[1] ?? ''}`;
    if (parts[0] === 'p') return `post/${parts[1] ?? ''}`;
    if (parts[0] === 'explore') return parts[1] ? `explore/${parts[1]}` : 'explore';
    if (parts.length === 1) return `profile/${parts[0]}`;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function writeMap(map: SiteMap): void {
  map.updated_at = new Date().toISOString();
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main(): Promise<void> {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  console.log(`[siteforge-map] output dir: ${RUN_DIR}`);

  const session = await openBrowserSession();
  const { page } = session;
  await page.goto(ARGS.startUrl).catch(() => undefined);
  await pause('Log in if needed, then start clicking around. I will record new surfaces.');

  const now = new Date().toISOString();
  const map: SiteMap = {
    schema_version: 1,
    created_at: now,
    updated_at: now,
    start_url: ARGS.startUrl,
    nodes: {},
    edges: [],
  };

  let previous: CaptureRecord | null = null;
  let captureIndex = 0;
  let lastSignature = '';
  const endAt = Date.now() + ARGS.durationSeconds * 1000;

  const flushAndExit = (): void => {
    writeMap(map);
    console.log(`\n[siteforge-map] saved ${Object.keys(map.nodes).length} states and ${map.edges.length} edges`);
    console.log(`[siteforge-map] map: ${MAP_PATH}`);
    exit(0);
  };
  process.once('SIGINT', flushAndExit);

  while (Date.now() < endAt) {
    await installClickRecorder(page);
    const record = await captureCurrent(page);
    const signature = `${record.surface_id}|${record.url}`;

    if (signature !== lastSignature) {
      const capturePath = writeCapture(++captureIndex, record);
      mergeNode(map, record, capturePath);
      if (previous) mergeEdge(map, previous, record);
      previous = record;
      lastSignature = signature;
      writeMap(map);

      const lastEdge = map.edges[map.edges.length - 1];
      const opTag = lastEdge ? ` [${lastEdge.op_type}]` : '';
      console.log(
        `[siteforge-map] state ${Object.keys(map.nodes).length}, edge ${map.edges.length}${opTag}: ${record.kind} ${record.surface_id.slice(0, 12)} ${record.url}`,
      );
      console.log(
        `  atoms raw/canonical/surface: ${record.atoms_raw_count}/${record.atoms_canonical_count}/${record.atoms_surface_count}`,
      );
    }

    await sleep(ARGS.intervalMs);
  }

  flushAndExit();
}

main().catch((err) => {
  console.error('[siteforge-map] error:', err);
  exit(2);
});
