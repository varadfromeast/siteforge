/**
 * Atom canonicalization — the function that decides "are two pages
 * the same logical state?"
 *
 * v1 spec (open to revision based on probe results):
 *   1. Filter: keep only atoms with interactable role.
 *   2. Normalize accessible_name: trim, lowercase, collapse whitespace,
 *      drop pure-numeric (likely counters), truncate 80 chars.
 *   3. Filter attrs: keep only safelist keys, drop generated-id patterns.
 *   4. Sort: by (role, accessible_name, JSON.stringify(attrs)).
 */

import type { Atom } from './types.js';

/** ARIA roles we treat as interactable affordances. */
const INTERACTABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Attribute names we keep (everything else dropped as noise). */
const STABLE_ATTR_KEYS = new Set([
  'id',
  'aria-label',
  'aria-labelledby',
  'data-testid',
  'data-test',
  'name',
  'type',
  'placeholder',
  'role', // sometimes an attr separate from element role
  'href', // for links — but we only keep the path, not query
]);

/** Generated-id patterns — drop attrs that match these. */
const GENERATED_ID_PATTERNS: RegExp[] = [
  /^_[a-z0-9]{4,}$/i, // Instagram/Facebook style: _a9zs
  /^[a-z]\d{4,}$/i, // tailwind-jit-ish
  /^css-[a-z0-9]{6,}$/i, // emotion
  /^sc-[a-z0-9]{6,}$/i, // styled-components
  /^MuiBox-root-\d+$/i, // material UI
];

/** True if the value looks like a generated id we should drop. */
function isGeneratedId(value: string): boolean {
  return GENERATED_ID_PATTERNS.some((re) => re.test(value));
}

/** Normalize accessible_name: trim, lowercase, collapse whitespace, truncate. */
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
}

/** True if a string is essentially just a number/symbols (likely a counter). */
function isPureNumeric(s: string): boolean {
  return /^[\d\s,.\-+kKmM%]*$/.test(s) && /\d/.test(s);
}

/** Strip query strings from URL-like values; keep only path. */
function normalizeHref(value: string): string {
  try {
    const u = new URL(value, 'https://placeholder.invalid');
    return u.pathname;
  } catch {
    return value;
  }
}

/** Filter attrs to safelist + drop generated ids. */
function canonicalizeAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(attrs)) {
    if (!STABLE_ATTR_KEYS.has(key)) continue;
    let value = raw.trim();
    if (key === 'href') value = normalizeHref(value);
    if (!value) continue;
    if (isGeneratedId(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Take a raw atom list and produce a deterministic, canonical sequence.
 *
 * Idempotent: canonicalizeAtoms(canonicalizeAtoms(x)) === canonicalizeAtoms(x).
 */
export function canonicalizeAtoms(atoms: Atom[]): Atom[] {
  const filtered: Atom[] = [];

  for (const atom of atoms) {
    if (!INTERACTABLE_ROLES.has(atom.role)) continue;

    const accessible_name = normalizeName(atom.accessible_name ?? '');
    if (!accessible_name) continue;
    if (isPureNumeric(accessible_name)) continue;

    const attrs = canonicalizeAttrs(atom.attrs ?? {});

    filtered.push({ role: atom.role, accessible_name, attrs });
  }

  // Deterministic sort by (role, name, attrs-json).
  filtered.sort((a, b) => {
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    if (a.accessible_name !== b.accessible_name) {
      return a.accessible_name < b.accessible_name ? -1 : 1;
    }
    const aa = JSON.stringify(a.attrs);
    const bb = JSON.stringify(b.attrs);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });

  return filtered;
}
