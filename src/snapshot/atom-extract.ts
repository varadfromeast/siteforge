/**
 * Walk Playwright's accessibility-tree snapshot, extract Atom[].
 *
 * We use Playwright's built-in `page.accessibility.snapshot()` rather than
 * Stagehand's `captureHybridSnapshot` for v0.0.2 — it's a stable public API,
 * has no LLM dependency, and is good enough for state hashing.
 *
 * The Stagehand a11y pipeline gives us richer xpath_map and frame-hopping;
 * we'll switch when we need those features (likely v0.0.4 when explorer
 * needs to execute candidate operations).
 */

import type { Atom } from '../core/types.js';

/** A node in Playwright's accessibility tree. */
export interface AxNode {
  role: string;
  name?: string;
  description?: string;
  value?: string | number;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: AxNode[];
}

/**
 * Walk the accessibility tree, yield an Atom for each interactable node.
 *
 * Note: Playwright's a11y snapshot doesn't expose DOM attributes (id, data-*).
 * We extract what we can from the AX node itself. For richer attrs we'd need
 * a follow-up DOM query — deferred to a later phase if needed.
 */
export function extractAtoms(root: AxNode): Atom[] {
  const out: Atom[] = [];
  walk(root, out);
  return out;
}

function walk(node: AxNode, out: Atom[]): void {
  // Build attrs from whatever the AX node tells us (limited but stable).
  const attrs: Record<string, string> = {};
  if (node.value !== undefined) attrs['value'] = String(node.value);
  if (node.valuetext) attrs['valuetext'] = node.valuetext;
  if (node.checked !== undefined) attrs['checked'] = String(node.checked);
  if (node.pressed !== undefined) attrs['pressed'] = String(node.pressed);
  if (node.expanded !== undefined) attrs['expanded'] = String(node.expanded);
  if (node.disabled) attrs['disabled'] = 'true';
  if (node.required) attrs['required'] = 'true';
  if (node.haspopup) attrs['haspopup'] = node.haspopup;
  if (node.level !== undefined) attrs['level'] = String(node.level);

  // Use description as a stable attr if name is empty (helps disambiguate).
  if (node.description) attrs['description'] = node.description;

  out.push({
    role: node.role,
    accessible_name: node.name ?? '',
    attrs,
  });

  for (const child of node.children ?? []) {
    walk(child, out);
  }
}
