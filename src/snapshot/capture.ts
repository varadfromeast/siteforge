/**
 * captureSnapshot — Playwright Page → SnapshotResult.
 *
 * v0.0.2 limitations:
 *   - xpath_map and url_map are empty. We get those from Stagehand later.
 *   - raw_tree is a JSON dump of the a11y tree (good enough for debugging).
 *   - We don't recurse into iframes yet.
 */

import type { Page } from 'playwright';
import { extractAtoms } from './atom-extract.js';
import type { SnapshotResult } from './types.js';

export async function captureSnapshot(page: Page): Promise<SnapshotResult> {
  const url = page.url();

  // Wait briefly for the DOM to settle.
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  const ax = await page.accessibility.snapshot({ interestingOnly: false });

  const atoms = ax ? extractAtoms(ax) : [];

  return {
    raw_tree: ax ? JSON.stringify(ax, null, 2) : '',
    xpath_map: {},
    url_map: {},
    url,
    atoms,
  };
}
