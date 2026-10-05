const PEACOCK_SAVED_PATTERNS = [/\bmy stuff\b/i, /\bfavorites?\b/i, /\bwatchlist\b/i, /\bmy list\b/i];
const PEACOCK_CARD_SELECTORS = [
  'a[href][aria-label]',
  'a[href][title]',
  '[data-testid] a[href]',
  '[data-testid][aria-label]',
  '[role="link"][aria-label]',
  '[role="link"][title]',
];

function cleanTitle(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanTitle(value);
  if (!title || title.length > 300) return '';
  if (/^(home|search|my stuff|favorites?|watchlist|my list|movies|shows|tv|live|sports|settings|account)$/i.test(title)) return '';
  if (/^(play|add|remove|more|details|info|watch now|continue watching)$/i.test(title)) return '';
  return title;
}

function findSavedRoot() {
  const candidates = [...document.querySelectorAll('main section, main [role="region"], section, [role="region"]')];
  for (const candidate of candidates) {
    const heading = cleanTitle(candidate.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '');
    if (PEACOCK_SAVED_PATTERNS.some(pattern => pattern.test(heading))) return candidate;
  }

  const matches = [...document.querySelectorAll('h1, h2, h3, [role="heading"], nav a, nav button')]
    .filter(node => PEACOCK_SAVED_PATTERNS.some(pattern => pattern.test(cleanTitle(node.textContent || ''))));

  for (const node of matches) {
    const root = node.closest('section, [role="region"], main') || node.parentElement;
    if (root) return root;
  }

  return null;
}

function extractPeacockItems(root) {
  const scope = root || document;
  const elements = scope.querySelectorAll(PEACOCK_CARD_SELECTORS.join(','));
  const items = [];
  const seen = new Set();

  elements.forEach(element => {
    const title = normalizeTitle(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.querySelector('img')?.getAttribute('alt') ||
      element.textContent ||
      '',
    );
    if (!title) return;

    const href = element.getAttribute('href') || '';
    if (href && /\/(account|search|login|signup|support|terms|privacy)\b/i.test(href)) return;

    let url = null;
    try { url = href ? new URL(href, location.href) : null; } catch {}

    const idFromHref =
      url?.searchParams.get('id') ||
      url?.searchParams.get('contentId') ||
      url?.searchParams.get('titleId') ||
      href.match(/\/(?:watch|video|movies|shows|series)\/([^/?#]+)/i)?.[1] ||
      '';

    const id = idFromHref
      ? `peacock-${idFromHref}`
      : `peacock-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

    if (seen.has(id)) return;
    seen.add(id);
    items.push({ id, title, type: 'Series', provider: 'Peacock' });
  });

  return items;
}

async function waitForPeacockItems(timeoutMs = 12000) {
  const started = Date.now();
  const seen = new Map();
  let root = findSavedRoot();

  while (Date.now() - started < timeoutMs) {
    root = root?.isConnected ? root : findSavedRoot();
    for (const item of extractPeacockItems(root)) if (!seen.has(item.id)) seen.set(item.id, item);

    const scrollers = root
      ? root.querySelectorAll('[data-testid*="carousel" i], [class*="carousel" i], [class*="slider" i]')
      : [];
    scrollers.forEach(scroller => { try { scroller.scrollLeft = scroller.scrollWidth; } catch {} });

    const before = seen.size;
    await new Promise(resolve => setTimeout(resolve, 500));
    if (seen.size === before && (seen.size > 0 || Date.now() - started > 7000)) break;
  }

  return {
    items: [...seen.values()],
    selectorCounts: {
      savedRoot: root ? 1 : 0,
      cardCandidates: root ? root.querySelectorAll(PEACOCK_CARD_SELECTORS.join(',')).length : document.querySelectorAll(PEACOCK_CARD_SELECTORS.join(',')).length,
    },
    watchLinkCount: document.querySelectorAll('a[href*="/watch/"], a[href*="/video/"]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:provider-scan') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  waitForPeacockItems()
    .then(scan => sendProviderItems(message.nonce, scan.items, {
      providerId: 'peacock',
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      selectorCounts: scan.selectorCounts,
      watchLinkCount: scan.watchLinkCount,
      ariaLabelCount: scan.ariaLabelCount,
    }).catch(() => {}))
    .catch(() => {});

  sendResponse({ ok: true, accepted: true });
});
