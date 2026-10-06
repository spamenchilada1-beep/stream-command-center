const SAVED_LIBRARY_PROVIDERS = {
  'www.primevideo.com': { provider: 'Prime Video', patterns: [/\bmy stuff\b/i, /\bwatchlist\b/i, /\bmy watchlist\b/i, /\bsaved\b/i] },
  'www.disneyplus.com': { provider: 'Disney+', patterns: [/\bwatchlist\b/i, /\bmy list\b/i, /\bsaved\b/i] },
  'www.max.com': { provider: 'Max', patterns: [/\bmy stuff\b/i, /\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i] },
  'www.paramountplus.com': { provider: 'Paramount+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i, /\bsaved\b/i] },
  'tv.apple.com': { provider: 'Apple TV+', patterns: [/\bup next\b/i, /\bwatchlist\b/i, /\bmy list\b/i, /\bsaved\b/i] },
  'www.tubitv.com': { provider: 'Tubi', patterns: [/\bhistory\b/i, /\bhistory\s*&\s*my list\b/i, /\bmy stuff\b/i, /\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i] },
  'tubitv.com': { provider: 'Tubi', patterns: [/\bhistory\b/i, /\bhistory\s*&\s*my list\b/i, /\bmy stuff\b/i, /\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i] },
  'www.crunchyroll.com': { provider: 'Crunchyroll', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.mgmplus.com': { provider: 'MGM+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i] },
  'www.starz.com': { provider: 'STARZ', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.amcplus.com': { provider: 'AMC+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.discoveryplus.com': { provider: 'discovery+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.espn.com': { provider: 'ESPN', patterns: [/\bmy list\b/i, /\bsaved\b/i, /\bfavorites?\b/i, /\bwatchlist\b/i] },
  'www.fubo.tv': { provider: 'Fubo', patterns: [/\bmy stuff\b/i, /\bfavorites?\b/i, /\bsaved\b/i, /\bwatchlist\b/i] },
  'www.sling.com': { provider: 'Sling', patterns: [/\bfavorites?\b/i, /\bsaved\b/i, /\bwatchlist\b/i, /\bmy list\b/i] },
  'tv.youtube.com': { provider: 'YouTube TV', patterns: [/\blibrary\b/i, /\bsaved\b/i, /\bfavorites?\b/i, /\bwatchlist\b/i] },
  'www.philo.com': { provider: 'Philo', patterns: [/\bsaved\b/i, /\bfavorites?\b/i, /\bmy stuff\b/i, /\bwatchlist\b/i] },
  'www.britbox.com': { provider: 'BritBox', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i, /\bsaved\b/i] },
  'acorn.tv': { provider: 'Acorn TV', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i, /\bsaved\b/i] },
  'www.shudder.com': { provider: 'Shudder', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i, /\bsaved\b/i] },
  'mubi.com': { provider: 'MUBI', patterns: [/\bwatchlist\b/i, /\bmy list\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.hallmarkplus.com': { provider: 'Hallmark+', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i, /\bsaved\b/i] },
  'www.criterionchannel.com': { provider: 'Criterion Channel', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.dropout.tv': { provider: 'Dropout', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'www.hidive.com': { provider: 'HIDIVE', patterns: [/\bmy list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i] },
  'pluto.tv': { provider: 'Pluto TV', patterns: [/\bwatch\s+list\b/i, /\bwatchlist\b/i, /\bsaved\b/i, /\bfavorites?\b/i, /\bmy list\b/i] },
  'www.roku.com': { provider: 'The Roku Channel', patterns: [/\bmy list\b/i, /\bsaved\b/i, /\bwatchlist\b/i, /\bfavorites?\b/i] },
  'www.plex.tv': { provider: 'Plex', patterns: [/\bwatchlist\b/i, /\bsaved\b/i, /\bmy list\b/i, /\bfavorites?\b/i] },
};

const CARD_SELECTORS = [
  'a[href][aria-label]',
  'a[href][title]',
  '[data-testid] a[href]',
  '[data-testid][aria-label]',
  '[role="link"][aria-label]',
  '[role="link"][title]',
  'a[href] img[alt]',
  'article img[alt]',
  '[data-testid] img[alt]',
];

const NAV_OR_ACTION = /^(home|search|my stuff|watchlist|watch list|my watchlist|my list|saved|favorites?|movies|shows|series|tv|live|sports|settings|account|play|add|remove|more|details|info|watch now|continue watching|sign in|log in)$/i;

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanText(value);
  if (!title || title.length > 300 || NAV_OR_ACTION.test(title)) return '';
  return title;
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
}

async function clickSavedControl(config) {
  const controls = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].filter(isVisible);
  const providerPatterns = config.provider === 'Pluto TV'
    ? [/^watch\s*list$/i, /^watchlist$/i, /^my\s*list$/i, /^saved$/i]
    : config.provider === 'Tubi'
      ? [/^history\s*&\s*my\s*list$/i, /^my\s*list$/i, /^watchlist$/i, /^saved$/i]
      : [];

  for (const pattern of providerPatterns) {
    const control = controls.find(node => pattern.test(cleanText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '')));
    if (control) {
      control.click();
      await new Promise(resolve => setTimeout(resolve, 900));
      return true;
    }
  }

  if (config.provider === 'Pluto TV' || config.provider === 'Tubi') {
    const profileControl = controls.find(node => /profile|account/i.test(cleanText(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '')));
    if (profileControl) {
      profileControl.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      for (const pattern of providerPatterns) {
        const savedControl = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')]
          .filter(isVisible)
          .find(node => pattern.test(cleanText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '')));
        if (savedControl) {
          savedControl.click();
          await new Promise(resolve => setTimeout(resolve, 900));
          return true;
        }
      }
    }
  }

  return false;
}

function findSavedRoot(config) {
  const candidates = [...document.querySelectorAll('main section, main [role="region"], section, [role="region"]')];
  const priorityPatterns = config.provider === 'Pluto TV'
    ? [/\bwatch\s+list\b/i, /\bwatchlist\b/i, /\bsaved\b/i]
    : config.provider === 'Tubi'
      ? [/\bhistory\s*&\s*my list\b/i, /\bmy list\b/i]
      : [];

  for (const candidate of candidates) {
    const heading = cleanText(
      candidate.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '',
    );

    if (priorityPatterns.some(pattern => pattern.test(heading))) {
      const cardCount = candidate.querySelectorAll(CARD_SELECTORS.join(',')).length;
      if (cardCount > 0) return candidate;
    }
  }

  if (config.provider !== 'Tubi' && config.provider !== 'Pluto TV') {
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
  }

  const savedPathSegments = new Set([
    'my-stuff', 'my-list', 'watchlist', 'watch-list', 'favorites', 'favorite', 'saved',
    'library', 'up-next', 'watch-later', 'history', 'account',
  ]);
  const pathSegments = location.pathname.split('/').filter(Boolean).map(segment => segment.toLowerCase());
  if (pathSegments.some(segment => savedPathSegments.has(segment)) || location.pathname.toLowerCase().includes('/account/history')) {
    return document.querySelector('main') || document.body;
  }

  return null;
}

function extractItems(root, provider) {
  const elements = root.querySelectorAll(CARD_SELECTORS.join(','));
  const items = [];
  const seen = new Set();

  elements.forEach(element => {
    const link = element.closest('a[href]') || element;
    const href = link.getAttribute('href') || '';
    if (href && /\/(account|search|login|signup|support|terms|privacy)\b/i.test(href)) return;

    const title = normalizeTitle(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      link.getAttribute('aria-label') ||
      link.getAttribute('title') ||
      link.querySelector('img')?.getAttribute('alt') ||
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
  let navigationAttempted = false;

  if (!root && (config.provider === 'Tubi' || config.provider === 'Pluto TV')) {
    navigationAttempted = await clickSavedControl(config);
  }

  while (Date.now() - started < 12000) {
    root = root?.isConnected ? root : findSavedRoot(config);

    if (!root) {
      await new Promise(resolve => setTimeout(resolve, 350));
      continue;
    }

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
      cardCandidates: root ? root.querySelectorAll(CARD_SELECTORS.join(',')).length : 0,
      navigationAttempted,
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
