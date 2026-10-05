const SAVED_LIBRARY_PROVIDERS = {
  'www.primevideo.com': { provider: 'Prime Video', patterns: [/\bmy stuff\b/i, /\bwatchlist\b/i, /\bmy watchlist\b/i] },
  'www.disneyplus.com': { provider: 'Disney+', patterns: [/\bwatchlist\b/i, /\bmy list\b/i, /\bsaved\b/i] },
  'www.max.com': { provider: 'Max', patterns: [/\bmy stuff\b/i, /\bmy list\b/i, /\bwatchlist\b/i] },
  'www.paramountplus.com': { provider: 'Paramount+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i] },
  'tv.apple.com': { provider: 'Apple TV+', patterns: [/\bup next\b/i, /\bwatchlist\b/i, /\bmy list\b/i, /\bsaved\b/i] },
  'www.tubitv.com': { provider: 'Tubi', patterns: [/\bmy stuff\b/i, /\bmy list\b/i, /\bwatchlist\b/i] },
  'www.crunchyroll.com': { provider: 'Crunchyroll', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i] },
};

const CARD_SELECTORS = [
  'a[href][aria-label]',
  'a[href][title]',
  '[data-testid] a[href]',
  '[data-testid][aria-label]',
  '[role="link"][aria-label]',
  '[role="link"][title]',
];

const NAV_OR_ACTION = /^(home|search|my stuff|watchlist|my watchlist|my list|saved|favorites?|movies|shows|series|tv|live|sports|settings|account|play|add|remove|more|details|info|watch now|continue watching|sign in|log in)$/i;

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanText(value);
  if (!title || title.length > 300 || NAV_OR_ACTION.test(title)) return '';
  return title;
}

function findSavedRoot(config) {
  const candidates = [...document.querySelectorAll('main section, main [role="region"], section, [role="region"]')];

  for (const candidate of candidates) {
    const heading = cleanText(
      candidate.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '',
    );

    if (config.patterns.some(pattern => pattern.test(heading))) return candidate;
  }

  const matchedNodes = [...document.querySelectorAll('h1, h2, h3, [role="heading"], nav a, nav button')]
    .filter(node => config.patterns.some(pattern => pattern.test(cleanText(node.textContent || ''))));

  for (const node of matchedNodes) {
    const root = node.closest('section, [role="region"], main') || node.parentElement;
    if (root) return root;
  }

  return document.querySelector('main') || document.body;
}

function extractItems(root, provider) {
  const elements = root.querySelectorAll(CARD_SELECTORS.join(','));
  const items = [];
  const seen = new Set();

  elements.forEach(element => {
    const href = element.getAttribute('href') || '';
    if (href && /\/(account|search|login|signup|support|terms|privacy)\b/i.test(href)) return;

    const title = normalizeTitle(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.querySelector('img')?.getAttribute('alt') ||
      element.textContent ||
      '',
    );

    if (!title) return;

    let url = null;
    try { url = href ? new URL(href, location.href) : null; } catch {}

    const idFromHref =
      url?.searchParams.get('id') ||
      url?.searchParams.get('contentId') ||
      url?.searchParams.get('titleId') ||
      url?.searchParams.get('entity') ||
      href.match(/\/(?:watch|title|movie|show|series|video|content)\/([^/?#]+)/i)?.[1] ||
      '';

    const id = idFromHref
      ? `saved-${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idFromHref}`
      : `saved-${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

    if (seen.has(id)) return;
    seen.add(id);

    items.push({
      id,
      title,
      type: 'Series',
      provider,
    });
  });

  return items;
}

function advanceLoadedContent(root) {
  try {
    root.querySelectorAll(
      '[data-testid*="carousel" i], [class*="carousel" i], [class*="slider" i], [class*="scroller" i]'
    ).forEach(node => {
      node.scrollLeft = node.scrollWidth;
      node.scrollTop = node.scrollHeight;
    });
  } catch {}

  try {
    window.scrollTo(0, document.body.scrollHeight);
  } catch {}
}

async function scanSavedLibrary(config) {
  const started = Date.now();
  const seen = new Map();
  let root = findSavedRoot(config);

  while (Date.now() - started < 12000) {
    root = root?.isConnected ? root : findSavedRoot(config);

    for (const item of extractItems(root, config.provider)) {
      if (!seen.has(item.id)) seen.set(item.id, item);
    }

    advanceLoadedContent(root);

    const before = seen.size;
    await new Promise(resolve => setTimeout(resolve, 500));

    if (seen.size === before && (seen.size > 0 || Date.now() - started > 7000)) break;
  }

  return {
    items: [...seen.values()],
    selectorCounts: {
      savedRoot: root ? 1 : 0,
      cardCandidates: root.querySelectorAll(CARD_SELECTORS.join(',')).length,
    },
    watchLinkCount: document.querySelectorAll('a[href*="/watch/"], a[href*="/title/"], a[href*="/video/"]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
  };
}

const CONFIG = SAVED_LIBRARY_PROVIDERS[location.hostname];

if (CONFIG) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'scc:provider-scan') return;
    if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

    scanSavedLibrary(CONFIG)
      .then(scan => sendProviderItems(message.nonce, scan.items, {
        providerId: location.hostname,
        provider: CONFIG.provider,
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
}
