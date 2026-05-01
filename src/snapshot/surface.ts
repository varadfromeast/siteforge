import type { Atom } from '../core/types.js';

/**
 * Reduce canonical atoms to the affordances that define a reusable navigation
 * surface. Full canonical atoms stay useful for debugging; surface atoms are
 * what we want to compare across repeated visits and related screens.
 */
export function surfaceAtoms(atoms: Atom[], pageUrl: string): Atom[] {
  const handle = handleFromProfileUrl(pageUrl);
  const filtered = atoms.filter((atom) => {
    if (!['button', 'link', 'tab', 'textbox', 'searchbox', 'combobox'].includes(atom.role)) {
      return false;
    }

    const name = atom.accessible_name;
    if (isRepeatedSuggestionAction(name)) return false;
    if (isGlobalChrome(name)) return false;
    if (isContentItem(atom, handle)) return false;
    if (isSocialCounter(name)) return false;
    if (isTransientAccountUi(name)) return false;

    return true;
  });

  return uniqueAtoms(filtered);
}

function isGlobalChrome(name: string): boolean {
  return [
    'about',
    'api',
    'blog',
    'contact uploading and non-users',
    'explore',
    'home',
    'instagram',
    'jobs',
    'help',
    'meta',
    'meta ai',
    'new post',
    'notifications',
    'popular',
    'professional dashboard',
    'privacy',
    'search',
    'settings',
    'terms',
    'locations',
    'instagram lite',
    'threads',
    'contact uploading & non-users',
    'meta verified',
    'also from meta',
    'switch display language',
  ].includes(name);
}

function isContentItem(atom: Atom, currentHandle: string | null): boolean {
  const name = atom.accessible_name;
  return (
    /(?: carousel| reel| photo| video)$/.test(name) ||
    /\bclip$/.test(name) ||
    /^https?:\/\//.test(name) ||
    /^photo (?:by|shared by)\b/.test(name) ||
    /\bhighlight story picture\b/.test(name) ||
    /\bview highlights highlight\b/.test(name) ||
    /^user avatar\b/.test(name) ||
    /\bprofile picture\b/.test(name) ||
    isOtherProfileHandle(atom, currentHandle) ||
    isEmojiOnly(name) ||
    name.length > 70
  );
}

function isSocialCounter(name: string): boolean {
  return /^\d[\d,.]*\s+(?:posts?|followers?|following)$/.test(name);
}

function isTransientAccountUi(name: string): boolean {
  return (
    /\bnew notifications?\b/.test(name) ||
    name === 'note...' ||
    name === 'dismiss' ||
    name === 'see all' ||
    name === 'next' ||
    name === 'similar accounts'
  );
}

function isRepeatedSuggestionAction(name: string): boolean {
  return name === 'dismiss' || name === 'see all' || name === 'next';
}

function isOtherProfileHandle(atom: Atom, currentHandle: string | null): boolean {
  if (atom.role !== 'link') return false;

  const name = atom.accessible_name;
  if (['posts', 'reels', 'reposts', 'tagged', 'follow', 'message', 'options'].includes(name)) {
    return false;
  }

  if (!/^[a-z0-9._]{2,30}$/.test(name) && !/^@[a-z0-9._]{2,30}$/.test(name)) return false;
  const normalized = name.replace(/^@/, '');
  return currentHandle !== null && normalized !== currentHandle;
}

function isEmojiOnly(name: string): boolean {
  return !/[a-z0-9]/i.test(name);
}

function handleFromProfileUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null;
    return parts[0]!.toLowerCase();
  } catch {
    return null;
  }
}

function uniqueAtoms(atoms: Atom[]): Atom[] {
  const byKey = new Map<string, Atom>();
  for (const atom of atoms) {
    byKey.set(`${atom.role}|${atom.accessible_name}|${JSON.stringify(atom.attrs)}`, atom);
  }
  return [...byKey.values()];
}
