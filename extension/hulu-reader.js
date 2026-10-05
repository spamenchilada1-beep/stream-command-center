const HULU_MY_STUFF_PATTERNS = [/\\bmy stuff\\b/i, /\\bfavorites?\\b/i, /\\bwatchlist\\b/i];
const HULU_CARD_SELECTORS = [
  'a[href][aria-label]',
  'a[href][title]',
  '[data-testid] a[href]',
  '[data-testid][aria-label]',
  '[role="link"][aria-label]',
  '[role="link"][title]',
];

function cleanTitle(value) {
  return (value || '').replace(/\\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanTitle(value);
  if (!title || title.length > 300) return '';
  if (/^(home|search|my stuff|favorites?|watchlist|movies|tv|live|sports|settings|account)$/i.test(title)) return '';
  return title;
}

function isLikelyTitleCard(element) {
  const href = element.getAttribute('href') || '';
  const text = normalizeTitle(
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.querySelector('img')?.getAttribute('alt') ||
    element.textContent ||
    '',
  );

  if (!text) return false;
  if (href && /\/(account|search|login|signup|support|terms|privacy)\b/i.test(href)) return false;
  if (/^(play|add|remove|more|details|info)$/i.test(text)) return false;

  return true;
}

function findMyStuffRoot() {
  const candidates = [
    ...document.querySelectorAll('main section, main [role="region"], section, [role="region"]'),
  ];

  for (const candidate of candidates) {
    const heading = cleanTitle(
      candidate.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '',
    );
    if (HULU_MY_STUFF_PATTERNS.some(pattern => pattern.test(heading))) {
      return candidate;
    }
  }

  const textMatches = [...document.querySelectorAll('h1, h2, h3, [role="heading"], nav a, nav button')]
    .filter(node => HULU_MY_STUFF_PATTERNS.some(pattern => pattern.test(cleanTitle(node.textContent || ''))));

  for (const node of textMatches) {
    const root = node.closest('section, [role="region"], main') || node.parentElement;
    if (root) return root;
  }

  return null;
}

function extractHuluItems(root) {
  const scope = root || document;
  const elements = scope.querySelectorAll(HULU_CARD_SELECTORS.join(','));
  const items = [];
  const seen = new Set();

  elements.forEach(element => {
    if (!isLikelyTitleCard(element)) return;

    const href = element.getAttribute('href') || '';
    const url = href ? new URL(href, location.href) : null;
    const title = normalizeTitle(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.querySelector('img')?.getAttribute('alt') ||
      element.textContent ||
      '',
    );

    if (!title) return;

    const idFromHref =
      url?.searchParams.get('entity') ||
      url?.searchParams.get('contentId') ||
      href.match(/\/(?:watch|movie|show|series|content)\/([^/?#]+)/i)?.[1] ||
      '';

    const id = idFromHref ? `hulu-${idFromHref}` : `hulu-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    if (seen.has(id)) return;
    seen.add(id);

    items.push({
      id,
      title,
      type: /\b(season|episode)\b/i.test(title) ? 'Series' : 'Series',
      provider: 'Hulu',
    });
  });

  return items;
}

async function waitForHuluItems(timeoutMs = 12000) {
  const started = Date.now();
  const seen = new Map();
  let root = findMyStuffRoot();

  while (Date.now() - started < timeoutMs) {
    root = root?.isConnected ? root : findMyStuffRoot();

    for (const item of extractHuluItems(root)) {
      if (!seen.has(item.id)) seen.set(item.id, item);
    }

    const scroller = root?.querySelector('[data-testid*="carousel" i], [class*="carousel" i], [class*="slider" i]');
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
    }

    const before = seen.size;
    await new Promise(resolve => setTimeout(resolve, 500));

    if (seen.size === before && (seen.size > 0 || Date.now() - started > 7000)) break;
  }

  return {
    items: [...seen.values()],
    selectorCounts: {
      myStuffRoot: root ? 1 : 0,
      cardCandidates: root
        ? root.querySelectorAll(HULU_CARD_SELECTORS.join(',')).length
        : document.querySelectorAll(HULU_CARD_SELECTORS.join(',')).length,
    },
    watchLinkCount: document.querySelectorAll('a[href*="/watch/"]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:provider-scan') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  waitForHuluItems()
    .then(scan => {
      sendProviderItems(message.nonce, scan.items, {
        providerId: 'hulu',
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        selectorCounts: scan.selectorCounts,
        watchLinkCount: scan.watchLinkCount,
        ariaLabelCount: scan.ariaLabelCount,
      }).catch(() => {});
    })
    .catch(() => {});

  sendResponse({ ok: true, accepted: true });
});
