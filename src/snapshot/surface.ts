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
    if (isStoryDrawerButton(name)) return false;
    if (isFeedTimestamp(atom)) return false;
    if (isSocialAggregate(name)) return false;
    if (isMediaPlaceholder(atom)) return false;
    if (isFooterChrome(name)) return false;
    if (isCaptionLink(atom)) return false;
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

/**
 * "story by alpeethakur, not seen" / "story by deonddddd, seen"
 * Rotates with whoever posted a story. Drop.
 */
function isStoryDrawerButton(name: string): boolean {
  return /^story by\s.+/.test(name);
}

/**
 * Feed post timestamp links: "10 h", "4 d", "6 d", "2 w", "1 mo".
 * They tick over and re-shuffle, so they wreck surface stability.
 */
function isFeedTimestamp(atom: Atom): boolean {
  if (atom.role !== 'link') return false;
  return /^\d+\s*(?:s|sec|m|min|h|hr|hrs|d|day|days|w|wk|wks|mo|months?|y|yr|yrs)$/.test(
    atom.accessible_name,
  );
}

/**
 * "1,605 others", "27 others" — counters from feed activity strips.
 */
function isSocialAggregate(name: string): boolean {
  return /^\d[\d,.]*\s+others$/.test(name);
}

/**
 * Generic media placeholders that appear once per visible post.
 */
function isMediaPlaceholder(atom: Atom): boolean {
  if (atom.role !== 'link') return false;
  const name = atom.accessible_name;
  return name === 'media thumbnail' || name === 'video player' || name === 'thumbnail';
}

/**
 * Footer + signup affordances that appear on logged-out / shell views and
 * sometimes leak into logged-in surfaces.
 */
function isFooterChrome(name: string): boolean {
  if (name === 'language' || name === 'press' || name === 'careers') return true;
  if (/^sign up\b/.test(name)) return true;
  if (/^log in\b/.test(name)) return true;
  return false;
}

/**
 * Long captions that IG renders as link role rather than text. They carry
 * post content (emoji, hashtags, copy), not navigation identity.
 */
function isCaptionLink(atom: Atom): boolean {
  if (atom.role !== 'link') return false;
  const name = atom.accessible_name;
  if (name.length < 20) return false;
  // Heuristic: contains a sentence-end, multi-word hashtag run, or bullet.
  return /[.!?]\s|\s•\s|#\w+\s+#\w+/.test(name);
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
