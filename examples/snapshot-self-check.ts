/**
 * Snapshot self-check — synthetic checks for classifyState/snapshotToState.
 *
 * Two URL flavours are used deliberately:
 *
 *  - `https://example.com/`   exercises the **atom-based fallback** path.
 *                             classifyByUrl ignores non-IG hostnames.
 *  - `https://www.instagram.com/...`  exercises the **URL-pattern** path.
 *
 * Overlay tests (dialog/alert) use the IG URL on purpose because overlay
 * detection runs *before* URL dispatch — a dialog on a profile is a modal,
 * not a profile.
 */

import { canonicalizeAtoms, hashAtomSet } from '../src/core/index.js';
import { classifyState, snapshotToState, surfaceAtoms } from '../src/snapshot/index.js';
import type { Atom } from '../src/core/types.js';
import type { SnapshotResult } from '../src/snapshot/index.js';

let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

function snapshot(atoms: Atom[], url = 'https://example.com/'): SnapshotResult {
  return {
    raw_tree: JSON.stringify(atoms),
    xpath_map: {},
    url_map: {},
    url,
    atoms,
  };
}

console.log('\n[snapshot] classifyState');
// Overlay path: dialog/alert beat URL even on a profile URL.
assert(
  classifyState(
    snapshot(
      [{ role: 'dialog', accessible_name: 'Share', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'modal',
  'dialog role → modal (even on a profile URL)',
);
assert(
  classifyState(
    snapshot(
      [{ role: 'alert', accessible_name: 'Something went wrong', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'error',
  'alert role → error (even on a profile URL)',
);
assert(
  classifyState(
    snapshot(
      [
        { role: 'alert', accessible_name: '', attrs: {} },
        { role: 'button', accessible_name: 'conversation information', attrs: {} },
        { role: 'textbox', accessible_name: 'message...', attrs: {} },
      ],
      'https://www.instagram.com/direct/t/110847966976118/',
    ),
  ) === 'panel',
  'empty alert role does not override Direct URL → panel',
);
assert(
  classifyState(
    snapshot(
      [
        { role: 'button', accessible_name: 'conversation information', attrs: {} },
        {
          role: 'button',
          accessible_name:
            'jacquesgreeff_ verified clip it took me 12 years to build a $180m business and show you how in 6 seconds',
          attrs: {},
        },
        { role: 'textbox', accessible_name: 'message...', attrs: {} },
      ],
      'https://www.instagram.com/direct/t/110847966976118/',
    ),
  ) === 'panel',
  'long DM content containing error-ish text does not override Direct URL → panel',
);

// Atom fallback path: neutral URL so URL dispatch returns null.
assert(
  classifyState(
    snapshot([
      { role: 'textbox', accessible_name: 'Message', attrs: {} },
      { role: 'button', accessible_name: 'Send', attrs: {} },
    ]),
  ) === 'form',
  'input plus submit-like button → form (atom fallback)',
);
assert(
  classifyState(snapshot([{ role: 'feed', accessible_name: 'Posts', attrs: {} }])) === 'list',
  'feed role → list (atom fallback)',
);

// URL-pattern path: IG profile URL, ordinary atoms.
assert(
  classifyState(
    snapshot(
      [{ role: 'button', accessible_name: 'Follow', attrs: {} }],
      'https://www.instagram.com/someone/',
    ),
  ) === 'page',
  'IG profile URL → page',
);

// /reels/<id>/ used to fall through URL dispatch (regex only matched /(p|reel)/
// singular, not /reels/ plural-with-id) and atom fallback misclassified it as
// `form` because IG's comment composer has a form-role wrapper.
assert(
  classifyState(
    snapshot(
      [{ role: 'button', accessible_name: 'like', attrs: {} }],
      'https://www.instagram.com/reels/DXMx_2EDoun/',
    ),
  ) === 'page',
  '/reels/<id>/ → page (was misclassified as form)',
);
assert(
  classifyState(
    snapshot([{ role: 'button', accessible_name: 'like', attrs: {} }], 'https://www.instagram.com/reels/'),
  ) === 'list',
  '/reels/ (no id) → list',
);

console.log('\n[snapshot] surfaceAtoms');
{
  // Mixed bag: noise + nav atoms. Nav must survive, noise must not.
  const navAtoms: Atom[] = [
    { role: 'button', accessible_name: 'follow', attrs: {} },
    { role: 'button', accessible_name: 'like', attrs: {} },
    { role: 'button', accessible_name: 'comment', attrs: {} }, // canonical action — keep
    { role: 'button', accessible_name: 'save', attrs: {} },
    { role: 'textbox', accessible_name: 'message...', attrs: {} },
  ];
  const noiseAtoms: Atom[] = [
    // Per-comment counters from a reel side panel
    { role: 'button', accessible_name: 'comment 1,368', attrs: {} },
    { role: 'button', accessible_name: 'comment 10.3k', attrs: {} },
    { role: 'button', accessible_name: 'comment 14', attrs: {} },
    // Hashtag-as-link / hashtag-as-button from suggested reels
    { role: 'link', accessible_name: '#fyp', attrs: {} },
    { role: 'link', accessible_name: '#chess', attrs: {} },
    { role: 'button', accessible_name: '#fitness', attrs: {} },
    // DM sidebar phrases
    { role: 'button', accessible_name: 'react to message from animesh_', attrs: {} },
    { role: 'button', accessible_name: 'reply to message from varad.th', attrs: {} },
    { role: 'button', accessible_name: 'see more options for message from foo', attrs: {} },
    { role: 'link', accessible_name: 'open the profile page of bar', attrs: {} },
    // Geo-tagged location links. Note: the visual heuristic only reliably
    // matches "<word>, <words>" with ≥3 chars per side. US-state abbrevs
    // ("New York, NY") slip through until we capture href context — see
    // isGeoLocation in surface.ts.
    { role: 'link', accessible_name: 'bangalore, india', attrs: {} },
    { role: 'link', accessible_name: 'los angeles, california', attrs: {} },
    // Doubled icon+label that should normalize to a chrome name and drop
    { role: 'link', accessible_name: 'home home', attrs: {} },
    { role: 'link', accessible_name: 'explore explore', attrs: {} },
    { role: 'link', accessible_name: 'reels', attrs: {} },
    // Story drawer button (existing filter)
    { role: 'button', accessible_name: 'story by alpeethakur, not seen', attrs: {} },
    // Username link from the suggested-users panel
    { role: 'link', accessible_name: 'creator_growth_labs', attrs: {} },
    // Home-feed content that should not split the feed into many surfaces
    { role: 'button', accessible_name: '4 unread chats', attrs: {} },
    { role: 'button', accessible_name: 'audio is muted', attrs: {} },
    { role: 'button', accessible_name: 'creator @jeffnippard', attrs: {} },
    { role: 'button', accessible_name: 'follow', attrs: {} },
    { role: 'button', accessible_name: 'more', attrs: {} },
    { role: 'button', accessible_name: 'see translation', attrs: {} },
    { role: 'button', accessible_name: 'switch', attrs: {} },
    { role: 'button', accessible_name: 'tags', attrs: {} },
    { role: 'button', accessible_name: 'video has no audio', attrs: {} },
    { role: 'link', accessible_name: '19.5k others', attrs: {} },
    { role: 'link', accessible_name: 'original audio', attrs: {} },
    { role: 'link', accessible_name: 'get offer right chevron', attrs: {} },
    { role: 'link', accessible_name: 'mosseri verified', attrs: {} },
    { role: 'link', accessible_name: 'antara andulkar', attrs: {} },
  ];
  const surface = surfaceAtoms([...navAtoms, ...noiseAtoms], 'https://www.instagram.com/');
  const names = new Set(surface.map((a) => a.accessible_name));

  // Survivors
  assert(!names.has('follow'), 'home content "follow" button dropped');
  assert(names.has('like'), 'nav button "like" kept');
  assert(names.has('comment'), 'canonical "comment" action kept');
  assert(names.has('save'), 'nav button "save" kept');
  assert(names.has('message...'), 'compose textbox kept');

  // Drops
  assert(!names.has('comment 1,368'), 'per-comment counter dropped (comma)');
  assert(!names.has('comment 10.3k'), 'per-comment counter dropped (k suffix)');
  assert(!names.has('comment 14'), 'per-comment counter dropped (small int)');
  assert(![...names].some((n) => n.startsWith('#')), 'hashtag links/buttons dropped');
  assert(![...names].some((n) => /message from/.test(n)), 'DM sidebar message phrases dropped');
  assert(![...names].some((n) => /open the profile page of/.test(n)), 'DM profile-jump links dropped');
  assert(!names.has('bangalore, india'), 'geo location "city, country" dropped');
  assert(!names.has('los angeles, california'), 'geo location "city, state" dropped');
  assert(!names.has('home') && !names.has('home home'), 'doubled chrome "home home" → "home" → dropped');
  assert(!names.has('explore') && !names.has('explore explore'), 'doubled chrome "explore explore" dropped');
  assert(!names.has('reels'), 'home left-nav "reels" chrome dropped');
  assert(![...names].some((n) => n.startsWith('story by')), 'story drawer button dropped');
  assert(!names.has('creator_growth_labs'), 'suggested-user link dropped on home feed');
  assert(!names.has('4 unread chats'), 'home unread-chat badge dropped');
  assert(!names.has('audio is muted'), 'home media mute state dropped');
  assert(!names.has('more'), 'home caption expansion dropped');
  assert(!names.has('see translation'), 'home translation affordance dropped');
  assert(!names.has('switch'), 'home right-rail account switcher dropped');
  assert(!names.has('tags'), 'home tag overlay button dropped');
  assert(!names.has('video has no audio'), 'home video audio state dropped');
  assert(!names.has('19.5k others'), 'home like aggregate with k suffix dropped');
  assert(!names.has('original audio'), 'home audio attribution dropped');
  assert(!names.has('get offer right chevron'), 'home ad CTA dropped');
  assert(!names.has('mosseri verified'), 'home verified content link dropped');
  assert(!names.has('antara andulkar'), 'home display-name content link dropped');
}

{
  const directAtoms: Atom[] = [
    { role: 'button', accessible_name: 'new message', attrs: {} },
    { role: 'button', accessible_name: 'send message', attrs: {} },
    { role: 'button', accessible_name: 'varad.th verified down chevron icon', attrs: {} },
    { role: 'tab', accessible_name: 'primary', attrs: {} },
    { role: 'tab', accessible_name: 'general', attrs: {} },
    { role: 'tab', accessible_name: 'requests', attrs: {} },
    { role: 'link', accessible_name: 'reels', attrs: {} },
    {
      role: 'button',
      accessible_name: 'user-profile-picture unmesh jadhav yes yr 2 hours ago unread',
      attrs: {},
    },
  ];
  const names = new Set(
    surfaceAtoms(directAtoms, 'https://www.instagram.com/direct/inbox/').map((a) => a.accessible_name),
  );

  assert(names.has('new message'), 'direct "new message" kept');
  assert(names.has('send message'), 'direct "send message" kept');
  assert(names.has('account menu'), 'direct account switcher normalized');
  assert(names.has('primary') && names.has('general') && names.has('requests'), 'direct inbox tabs kept');
  assert(!names.has('reels'), 'direct left-nav "reels" chrome dropped');
  assert(![...names].some((n) => n.startsWith('user-profile-picture')), 'direct conversation rows dropped');
}

{
  const threadAtoms: Atom[] = [
    { role: 'button', accessible_name: 'audio call', attrs: {} },
    { role: 'button', accessible_name: 'video call', attrs: {} },
    { role: 'button', accessible_name: 'conversation information', attrs: {} },
    { role: 'button', accessible_name: 'new message', attrs: {} },
    { role: 'button', accessible_name: 'account menu', attrs: {} },
    { role: 'tab', accessible_name: 'primary', attrs: {} },
    { role: 'tab', accessible_name: 'general', attrs: {} },
    { role: 'tab', accessible_name: 'requests', attrs: {} },
    { role: 'button', accessible_name: 'add photo or video', attrs: {} },
    { role: 'button', accessible_name: 'choose a gif or sticker', attrs: {} },
    { role: 'button', accessible_name: 'choose an emoji', attrs: {} },
    { role: 'button', accessible_name: 'voice clip', attrs: {} },
    { role: 'button', accessible_name: 'more options', attrs: {} },
    { role: 'textbox', accessible_name: 'message...', attrs: {} },
    { role: 'button', accessible_name: 'jacquesgreeff_ verified clip', attrs: {} },
    { role: 'link', accessible_name: 'apurv_sngh and hq.digital', attrs: {} },
  ];
  const names = new Set(
    surfaceAtoms(threadAtoms, 'https://www.instagram.com/direct/t/110847966976118/').map(
      (a) => a.accessible_name,
    ),
  );

  assert(names.has('audio call') && names.has('video call'), 'direct thread call buttons kept');
  assert(names.has('conversation information'), 'direct thread info button kept');
  assert(names.has('add photo or video'), 'direct thread add-media composer button kept');
  assert(names.has('choose a gif or sticker'), 'direct thread gif/sticker composer button kept');
  assert(names.has('choose an emoji'), 'direct thread emoji composer button kept');
  assert(names.has('voice clip'), 'direct thread voice composer button kept');
  assert(names.has('message...'), 'direct thread message textbox kept');
  assert(!names.has('new message') && !names.has('account menu'), 'direct thread inbox sidebar buttons dropped');
  assert(!names.has('primary') && !names.has('general') && !names.has('requests'), 'direct thread inbox tabs dropped');
  assert(!names.has('jacquesgreeff_ verified clip'), 'direct thread shared-reel content dropped');
  assert(!names.has('apurv_sngh and hq.digital'), 'direct thread shared-content link dropped');
  assert(!names.has('more options'), 'direct thread per-message options dropped');
}

{
  const names = new Set(
    surfaceAtoms(
      [
        { role: 'link', accessible_name: 'reels', attrs: {} },
        { role: 'button', accessible_name: 'follow', attrs: {} },
      ],
      'https://www.instagram.com/varad.th/',
    ).map((a) => a.accessible_name),
  );
  assert(names.has('reels'), 'profile tab "reels" kept');
  assert(names.has('follow'), 'profile "follow" button kept');
}

{
  const profileAtoms: Atom[] = [
    { role: 'button', accessible_name: '4 unread chats', attrs: {} },
    { role: 'button', accessible_name: 'nerd @va_rad_', attrs: {} },
    { role: 'button', accessible_name: 'options', attrs: {} },
    { role: 'button', accessible_name: 'plus icon new', attrs: {} },
    { role: 'link', accessible_name: 'creator-growth-lab.com', attrs: {} },
    { role: 'link', accessible_name: 'edit profile', attrs: {} },
    { role: 'link', accessible_name: 'posts', attrs: {} },
    { role: 'link', accessible_name: 'reels', attrs: {} },
    { role: 'link', accessible_name: 'reposts', attrs: {} },
    { role: 'link', accessible_name: 'tagged', attrs: {} },
    { role: 'link', accessible_name: 'varad.th', attrs: {} },
    { role: 'link', accessible_name: 'view outside highlight', attrs: {} },
  ];
  const names = new Set(surfaceAtoms(profileAtoms, 'https://www.instagram.com/varad.th/').map((a) => a.accessible_name));

  assert(names.has('options'), 'profile options kept');
  assert(names.has('plus icon new'), 'profile add/new affordance kept');
  assert(names.has('edit profile'), 'profile edit action kept');
  assert(names.has('posts') && names.has('reels') && names.has('reposts') && names.has('tagged'), 'profile tabs kept');
  assert(!names.has('4 unread chats'), 'profile unread badge dropped');
  assert(!names.has('nerd @va_rad_'), 'profile bio button dropped');
  assert(!names.has('creator-growth-lab.com'), 'profile external link dropped');
  assert(!names.has('varad.th'), 'profile self-handle link dropped');
  assert(!names.has('view outside highlight'), 'profile highlight content dropped');
}

{
  const reelAtoms: Atom[] = [
    { role: 'button', accessible_name: '4 unread chats', attrs: {} },
    { role: 'button', accessible_name: 'audio is muted', attrs: {} },
    { role: 'button', accessible_name: 'follow', attrs: {} },
    { role: 'button', accessible_name: 'like', attrs: {} },
    { role: 'button', accessible_name: 'press to play', attrs: {} },
    { role: 'button', accessible_name: 'repost', attrs: {} },
    { role: 'button', accessible_name: 'save', attrs: {} },
    { role: 'button', accessible_name: 'share', attrs: {} },
    { role: 'button', accessible_name: 'this is how you’re gonna change your life in 2026.', attrs: {} },
    { role: 'link', accessible_name: 'audio image', attrs: {} },
    { role: 'link', accessible_name: 'npcfaizan reels', attrs: {} },
    { role: 'link', accessible_name: 'reels', attrs: {} },
  ];
  const names = new Set(surfaceAtoms(reelAtoms, 'https://www.instagram.com/reels/DS7rcRnDNE9/').map((a) => a.accessible_name));

  assert(names.has('like') && names.has('repost') && names.has('save') && names.has('share'), 'reel core actions kept');
  assert(!names.has('4 unread chats'), 'reel unread badge dropped');
  assert(!names.has('audio is muted'), 'reel audio state dropped');
  assert(!names.has('creator @jeffnippard'), 'reel creator content button dropped');
  assert(!names.has('follow'), 'reel creator follow dropped');
  assert(!names.has('press to play'), 'reel playback state dropped');
  assert(!names.has('this is how you’re gonna change your life in 2026.'), 'reel caption-content button dropped');
  assert(!names.has('audio image') && !names.has('npcfaizan reels') && !names.has('reels'), 'reel content/chrome links dropped');
}

{
  const searchAtoms: Atom[] = [
    { role: 'button', accessible_name: 'close', attrs: {} },
    { role: 'textbox', accessible_name: 'search input', attrs: {} },
    { role: 'button', accessible_name: 'comment', attrs: {} },
    { role: 'button', accessible_name: 'like', attrs: {} },
    { role: 'button', accessible_name: 'tags', attrs: {} },
  ];
  const names = new Set(surfaceAtoms(searchAtoms, 'https://www.instagram.com/').map((a) => a.accessible_name));

  assert(names.has('close') && names.has('search input'), 'search panel controls kept');
  assert(!names.has('comment') && !names.has('like') && !names.has('tags'), 'search panel feed underlay dropped');
}

{
  const commentAtoms: Atom[] = [
    { role: 'button', accessible_name: 'close', attrs: {} },
    { role: 'button', accessible_name: 'emoji', attrs: {} },
    { role: 'button', accessible_name: 'like', attrs: {} },
    { role: 'button', accessible_name: 'reply', attrs: {} },
    { role: 'button', accessible_name: 'repost', attrs: {} },
    { role: 'button', accessible_name: 'save', attrs: {} },
    { role: 'button', accessible_name: 'share', attrs: {} },
    { role: 'button', accessible_name: '1,439 likes', attrs: {} },
    { role: 'button', accessible_name: 'view all 12 replies', attrs: {} },
    { role: 'link', accessible_name: 'coachwwayland verified', attrs: {} },
    { role: 'textbox', accessible_name: 'add a comment…', attrs: {} },
  ];
  const names = new Set(
    surfaceAtoms(commentAtoms, 'https://www.instagram.com/reels/DUV0ii1gs9G/').map((a) => a.accessible_name),
  );

  assert(names.has('close') && names.has('emoji'), 'comment modal close/emoji kept');
  assert(names.has('like') && names.has('repost') && names.has('save') && names.has('share'), 'comment modal post actions kept');
  assert(names.has('add a comment…'), 'comment modal textbox kept');
  assert(!names.has('reply'), 'comment modal per-comment reply dropped');
  assert(!names.has('1,439 likes'), 'comment modal per-comment like count dropped');
  assert(!names.has('view all 12 replies'), 'comment modal reply expander dropped');
  assert(!names.has('coachwwayland verified'), 'comment modal commenter link dropped');
}

console.log('\n[snapshot] snapshotToState');
{
  const atoms: Atom[] = [
    { role: 'heading', accessible_name: 'Varad', attrs: {} },
    { role: 'button', accessible_name: 'Follow', attrs: {} },
    { role: 'paragraph', accessible_name: 'noise', attrs: {} },
  ];
  const state = snapshotToState(snapshot(atoms, 'https://www.instagram.com/someone/?utm=x#top'));
  const canonical = canonicalizeAtoms(atoms);

  assert(state.id === hashAtomSet(canonical), 'state id hashes canonical atoms');
  assert(state.atoms.length === canonical.length, 'state stores canonical atoms only');
  assert(state.kind === 'page', 'ordinary profile snapshot → page');
  assert(state.label === 'Varad', 'heading becomes state label');
  assert(state.url_template === 'www.instagram.com/someone/', 'url_template drops query/hash');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(state.last_seen), 'last_seen is ISO-like');
}

console.log(`\n${failures === 0 ? '✅ snapshot checks passed' : `❌ ${failures} failures`}`);
process.exit(failures === 0 ? 0 : 1);
