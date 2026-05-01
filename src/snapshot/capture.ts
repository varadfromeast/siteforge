/**
 * captureSnapshot — Playwright Page → SnapshotResult.
 *
 * v0.0.2 limitations:
 *   - xpath_map and url_map are empty. We get those from Stagehand later.
 *   - raw_tree is a JSON dump of Chromium's a11y tree (good enough for debugging).
 *   - We don't recurse into iframes yet.
 */

import type { Page } from 'playwright';
import { extractAtoms } from './atom-extract.js';
import type { AxNode } from './atom-extract.js';
import type { SnapshotResult } from './types.js';

export async function captureSnapshot(page: Page): Promise<SnapshotResult> {
  const url = page.url();

  // Wait briefly for the DOM to settle.
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  const ax = await captureAccessibilityTree(page);

  const atoms = ax ? extractAtoms(ax) : [];

  return {
    raw_tree: ax ? JSON.stringify(ax, null, 2) : '',
    xpath_map: {},
    url_map: {},
    url,
    atoms,
  };
}

interface CdpAxValue {
  value?: unknown;
}

interface CdpAxProperty {
  name: string;
  value?: CdpAxValue;
}

interface CdpAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: CdpAxValue;
  name?: CdpAxValue;
  description?: CdpAxValue;
  value?: CdpAxValue;
  properties?: CdpAxProperty[];
  childIds?: string[];
}

interface FullAxTreeResult {
  nodes: CdpAxNode[];
}

async function captureAccessibilityTree(page: Page): Promise<AxNode | null> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as FullAxTreeResult;
    return buildTree(nodes);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

function buildTree(nodes: CdpAxNode[]): AxNode | null {
  if (nodes.length === 0) return null;

  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const referenced = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const root =
    nodes.find((node) => String(node.role?.value ?? '') === 'RootWebArea') ??
    nodes.find((node) => !referenced.has(node.nodeId)) ??
    nodes[0]!;

  return toAxNode(root, byId);
}

function toAxNode(node: CdpAxNode, byId: Map<string, CdpAxNode>): AxNode {
  const properties = new Map((node.properties ?? []).map((prop) => [prop.name, prop.value?.value]));
  const children = (node.childIds ?? [])
    .map((id) => byId.get(id))
    .filter((child): child is CdpAxNode => child !== undefined)
    .map((child) => toAxNode(child, byId));

  const out: AxNode = {
    role: stringValue(node.role?.value) || 'unknown',
    name: stringValue(node.name?.value),
    description: stringValue(node.description?.value),
    value: stringValue(node.value?.value),
    disabled: booleanValue(properties.get('disabled')),
    expanded: booleanValue(properties.get('expanded')),
    focused: booleanValue(properties.get('focused')),
    modal: booleanValue(properties.get('modal')),
    multiline: booleanValue(properties.get('multiline')),
    multiselectable: booleanValue(properties.get('multiselectable')),
    readonly: booleanValue(properties.get('readonly')),
    required: booleanValue(properties.get('required')),
    selected: booleanValue(properties.get('selected')),
    checked: checkedValue(properties.get('checked')),
    pressed: checkedValue(properties.get('pressed')),
    level: numberValue(properties.get('level')),
    valuemin: numberValue(properties.get('valuemin')),
    valuemax: numberValue(properties.get('valuemax')),
    autocomplete: stringValue(properties.get('autocomplete')),
    haspopup: stringValue(properties.get('haspopup')),
    invalid: stringValue(properties.get('invalid')),
    orientation: stringValue(properties.get('orientation')),
  };

  if (children.length > 0) out.children = children;
  return out;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function checkedValue(value: unknown): boolean | 'mixed' | undefined {
  if (value === 'mixed') return 'mixed';
  return booleanValue(value);
}
