import type { Atom } from '../core/types.js';

/**
 * Reduce canonical atoms to the affordances that define a reusable navigation
 * surface. Full canonical atoms stay useful for debugging; surface atoms are
 * what we want to compare across repeated visits and related screens.
 */
export function surfaceAtoms(atoms: Atom[], pageUrl: string): Atom[] {
  const handle = handleFromProfileUrl(pageUrl);
  const path = pathFromUrl(pageUrl);

  // Step 1: normalize accessible names to collapse icon+label-doubled forms
  // ("home home" -> "home", "professional dashboard dashboard" -> ..., etc.)
  const normalized = atoms.map((atom) => ({
    ...atom,
    accessible_name: normalizeSurfaceName(dedupeRepeatedPhrase(atom.accessible_name)),
  }));
  const hasSearchPanel = normalized.some(
    (atom) => atom.role === 'textbox' && atom.accessible_name === 'search input',
  );
  const hasCommentComposer = normalized.some(
    (atom) => atom.role === 'textbox' && atom.accessible_name === 'add a comment…',
  );

  // Step 2: drop atoms that are noise / content / chrome.
  const filtered = normalized.filter((atom) => {
    if (!['button', 'link', 'tab', 'textbox', 'searchbox', 'combobox'].includes(atom.role)) {
      return false;
    }

    const name = atom.accessible_name;
    if (hasSearchPanel && !isSearchPanelAtom(atom)) return false;
    if (hasCommentComposer && !isCommentComposerAtom(atom)) return false;
    if (isDirectThreadSidebarChrome(atom, path)) return false;
    if (isDirectThreadComposerControl(atom, path)) return true;
    if (isDirectThreadContent(atom, path)) return false;
    if (isProfileContent(atom, path)) return false;
    if (isReelContent(atom, path)) return false;
    if (isStoryDrawerButton(name)) return false;
    if (isFeedTimestamp(atom)) return false;
    if (isSocialAggregate(name)) return false;
    if (isMediaPlaceholder(atom)) return false;
    if (isFooterChrome(atom)) return false;
    if (isCaptionLink(atom)) return false;
    if (isCommentCounter(name)) return false;
    if (isHashtagAtom(atom)) return false;
    if (isDmSidebarItem(name)) return false;
    if (isDmConversationRow(atom)) return false;
    if (isContextualGlobalChrome(atom, path)) return false;
    if (isHomeFeedContent(atom, path)) return false;
    if (isGeoLocation(atom)) return false;
    if (isRepeatedSuggestionAction(name)) return false;
    if (isGlobalChrome(name)) return false;
    if (isContentItem(atom, handle)) return false;
    if (isSocialCounter(name)) return false;
    if (isTransientAccountUi(name)) return false;
    if (isOtherUserHandle(atom, handle)) return false;

    return true;
  });

  return uniqueAtoms(filtered);
}

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

function normalizeSurfaceName(name: string): string {
  if (/^[a-z0-9._]{2,30} verified down chevron icon$/.test(name)) {
    return 'account menu';
  }
  return name;
}

function isSearchPanelAtom(atom: Atom): boolean {
  if (atom.role === 'textbox' && atom.accessible_name === 'search input') return true;
  if (atom.role === 'button' && ['close', 'clear'].includes(atom.accessible_name)) return true;
  return false;
}

function isCommentComposerAtom(atom: Atom): boolean {
  if (atom.role === 'textbox' && atom.accessible_name === 'add a comment…') return true;
  if (atom.role !== 'button') return false;
  return ['close', 'emoji', 'like', 'repost', 'save', 'share'].includes(atom.accessible_name);
}

/**
 * Collapse two patterns IG produces because of icon + text-label rendering
 * in its accessibility tree:
 *
 *   "home home"                              -> "home"
 *   "explore explore"                        -> "explore"
 *   "professional dashboard dashboard"       -> "professional dashboard"
 *   "also from meta also from meta"          -> "also from meta"
 *
 * These previously caused profile pages with a collapsed-vs-expanded side nav
 * to produce different surface hashes for the same logical state.
 */
function dedupeRepeatedPhrase(name: string): string {
  const words = name.split(' ');
  if (words.length < 2) return name;

  // "X X" or "A B A B" — name is two equal halves.
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const front = words.slice(0, half).join(' ');
    const back = words.slice(half).join(' ');
    if (front === back) return front;
  }

  // "ABC C" — last word duplicated. ("...dashboard dashboard" tail.)
  if (words[words.length - 1] === words[words.length - 2]) {
    return words.slice(0, -1).join(' ');
  }

  return name;
}

function isGlobalChrome(name: string): boolean {
  return [
    'about',
    'api',
    'blog',
    'contact uploading and non-users',
    'contact uploading & non-users',
    'consumer health privacy',
    'explore',
    'home',
    'instagram',
    'instagram lite',
    'jobs',
    'help',
    'meta',
    'meta ai',
    'meta verified',
    'new post',
    'new post create',
    'notifications',
    'popular',
    'privacy',
    'professional dashboard',
    'search',
    'settings',
    'settings more',
    'terms',
    'locations',
    'threads',
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
  return /^\d[\d,.]*[kKmM]?\s+others$/.test(name);
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
 *
 * Role-restricted to `link` so we never accidentally drop the **primary
 * action button** on a real form (e.g. the actual "Log in" button on the
 * login page, or "Log in with Facebook" — both `button` role).
 */
function isFooterChrome(atom: Atom): boolean {
  if (atom.role !== 'link') return false;
  const name = atom.accessible_name;
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
  if (atom.role !== 'link' && atom.role !== 'button') return false;
  const name = atom.accessible_name;
  if (name.length < 20) return false;
  // Heuristic: contains a sentence-end, multi-word hashtag run, or bullet.
  return /[.!?]\s|\s•\s|#\w+\s+#\w+/.test(name);
}

/**
 * Per-comment counter buttons IG renders for each comment in the side panel
 * of a reel or post: "comment 1,368", "comment 10.3k", "comment 14".
 * Numbers tick up as engagement happens, so the surface drifts on every
 * visit. The single canonical "comment" action button on the post chrome is
 * still kept — that one has no number suffix.
 */
function isCommentCounter(name: string): boolean {
  return /^comment\s+\d[\d,.]*[kKmM]?$/.test(name);
}

/**
 * Hashtags rendered as link or button role. IG injects them everywhere a
 * caption is shown — most of the 60+ atom bloat in reel views comes from
 * suggested-reel hashtags ("#fyp", "#chess", "#fitness", ...).
 */
function isHashtagAtom(atom: Atom): boolean {
  if (atom.role !== 'link' && atom.role !== 'button') return false;
  return /^#\w/.test(atom.accessible_name);
}

/**
 * DM sidebar items — when the messages tray is visible alongside another
 * page, each visible conversation produces a cluster of action atoms with
 * the contact's username embedded:
 *   "open the profile page of <handle>"
 *   "react to message from <handle>"
 *   "reply to message from <handle>"
 *   "see (more) options for message from <handle>"
 * The list rotates as new messages arrive; every rotation invalidates the
 * surface hash even though the user is on the same logical page.
 */
function isDmSidebarItem(name: string): boolean {
  return /^(open the profile page of|react to message from|reply to message from|see (?:more )?options for message from)\b/.test(
    name,
  );
}

/**
 * Full Direct inbox conversation rows are rendered as giant buttons whose
 * labels include a contact, preview text, timestamp, mute/unread status, etc.
 * They are valuable private content in the raw snapshot, but poison reusable
 * surface identity: every new message creates a new hash for the same inbox.
 */
function isDmConversationRow(atom: Atom): boolean {
  if (atom.role !== 'button') return false;
  return /^user-profile-picture\b/.test(atom.accessible_name);
}

/**
 * On an open Direct thread, the left inbox column remains mounted. Keep the
 * thread surface focused on the active conversation, not the surrounding
 * inbox tabs/account switcher.
 */
function isDirectThreadSidebarChrome(atom: Atom, path: string): boolean {
  if (!path.startsWith('/direct/t/')) return false;
  const name = atom.accessible_name;
  return (
    (atom.role === 'button' && (name === 'new message' || name === 'account menu')) ||
    (atom.role === 'tab' && ['primary', 'general', 'requests'].includes(name))
  );
}

/**
 * Direct composer controls are legitimate state affordances. A generic
 * content filter would otherwise drop "add photo or video" because it ends
 * in "video", which is correct for feed media links but wrong for chat.
 */
function isDirectThreadComposerControl(atom: Atom, path: string): boolean {
  if (!path.startsWith('/direct/t/')) return false;
  if (atom.role === 'textbox' && atom.accessible_name === 'message...') return true;
  if (atom.role !== 'button') return false;

  return [
    'add photo or video',
    'choose a gif or sticker',
    'choose an emoji',
    'voice clip',
  ].includes(atom.accessible_name);
}

function isDirectThreadContent(atom: Atom, path: string): boolean {
  if (!path.startsWith('/direct/t/')) return false;
  if (atom.role === 'link') return true;
  if (atom.role !== 'button') return false;
  return (
    /\bverified clip$/.test(atom.accessible_name) ||
    atom.accessible_name === 'clip' ||
    atom.accessible_name === 'more options'
  );
}

function isProfileContent(atom: Atom, path: string): boolean {
  if (!isProfilePath(path)) return false;

  const name = atom.accessible_name;
  if (/^\d+\s+unread chats?$/.test(name)) return true;
  if (atom.role === 'button' && /@\w/.test(name)) return true;
  if (atom.role !== 'link') return false;

  if (name === handleFromPath(path)) return true;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|\b)/.test(name)) return true;
  if (/^view .+ highlight$/.test(name)) return true;

  return false;
}

function isReelContent(atom: Atom, path: string): boolean {
  if (!path.startsWith('/reels/') && !path.startsWith('/reel/')) return false;

  const name = atom.accessible_name;
  if (/^\d+\s+unread chats?$/.test(name)) return true;
  if (
    atom.role === 'button' &&
    (['audio is muted', 'audio is unmuted', 'follow', 'more', 'press to play', 'video has no audio'].includes(name) ||
      /^creator @/.test(name) ||
      name.length > 30)
  ) {
    return true;
  }
  if (atom.role !== 'link') return false;

  return name === 'audio image' || name === 'reels' || /\breels$/.test(name);
}

/**
 * Some left-nav entries are also real in-page tabs on profile pages. Drop
 * them only when the URL context tells us they are global chrome.
 */
function isContextualGlobalChrome(atom: Atom, path: string): boolean {
  if (atom.role !== 'link') return false;
  if (atom.accessible_name !== 'reels') return false;

  return path === '/' || path.startsWith('/direct/');
}

/**
 * Home/feed pages are intentionally volatile: suggested people, ads, like
 * aggregates, audio links, and unread counters should stay in debug captures
 * but not in the surface hash. The reusable post affordances — like,
 * comment, share, save — are kept by falling through this predicate.
 */
function isHomeFeedContent(atom: Atom, path: string): boolean {
  if (path !== '/') return false;

  const name = atom.accessible_name;
  if (/^\d+\s+unread chats?$/.test(name)) return true;
  if (
    atom.role === 'button' &&
    ['audio is muted', 'follow', 'more', 'see translation', 'switch', 'tags', 'video has no audio'].includes(name)
  ) {
    return true;
  }
  if (atom.role !== 'link') return false;
  return true;
}

/**
 * Geo-tagged location links from feed posts: "bangalore, india",
 * "los angeles, california". The link points to /explore/locations/<id>/.
 * They rotate with whichever posts are currently in the feed window.
 *
 * Restricted to `link` role and a "<word>, <words>" shape so we don't
 * accidentally match unrelated comma-separated copy.
 */
function isGeoLocation(atom: Atom): boolean {
  if (atom.role !== 'link') return false;
  return /^[a-z][a-z\s.\-']{2,40},\s+[a-z][a-z\s.\-']{2,40}$/i.test(atom.accessible_name);
}

/**
 * Username-shaped link atoms. Drops them unconditionally **unless** they
 * equal the currently-viewed handle (the "I am on /<handle>/" hint that IG
 * renders inside the profile chrome).
 *
 * Earlier this only fired through `isContentItem`, which guarded the same
 * test with `currentHandle !== null`. On the home feed (`/`), currentHandle
 * is null, so suggested-user, feed-author, and commenter usernames *all*
 * leaked into the surface — which is exactly why the home feed produced 6+
 * separate nodes per map run.
 */
function isOtherUserHandle(atom: Atom, currentHandle: string | null): boolean {
  if (atom.role !== 'link') return false;

  const name = atom.accessible_name;
  if (['posts', 'reels', 'reposts', 'tagged', 'follow', 'message', 'options'].includes(name)) {
    return false;
  }

  if (!/^[a-z0-9._]{2,30}$/.test(name) && !/^@[a-z0-9._]{2,30}$/.test(name)) return false;
  const normalized = name.replace(/^@/, '');
  return normalized !== currentHandle;
}

/**
 * Kept for backwards compat: still called from `isContentItem`. Same logic
 * as `isOtherUserHandle` above. The unconditional check is the new primary
 * defender against username-link bloat.
 */
function isOtherProfileHandle(atom: Atom, currentHandle: string | null): boolean {
  if (atom.role !== 'link') return false;

  const name = atom.accessible_name;
  if (['posts', 'reels', 'reposts', 'tagged', 'follow', 'message', 'options'].includes(name)) {
    return false;
  }

  if (!/^[a-z0-9._]{2,30}$/.test(name) && !/^@[a-z0-9._]{2,30}$/.test(name)) return false;
  const normalized = name.replace(/^@/, '');
  return normalized !== currentHandle;
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

function isProfilePath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return false;
  if (['accounts', 'explore', 'direct', 'stories', 'reels', 'reel', 'p'].includes(parts[0]!)) return false;
  if (parts.length === 2 && !['reels', 'tagged', 'saved', 'reposts'].includes(parts[1]!)) return false;
  return true;
}

function handleFromPath(path: string): string | null {
  const part = path.split('/').filter(Boolean)[0];
  return part ? part.toLowerCase() : null;
}

function uniqueAtoms(atoms: Atom[]): Atom[] {
  const byKey = new Map<string, Atom>();
  for (const atom of atoms) {
    byKey.set(`${atom.role}|${atom.accessible_name}|${JSON.stringify(atom.attrs)}`, atom);
  }
  return [...byKey.values()];
}
