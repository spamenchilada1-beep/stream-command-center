const TITLE_SELECTORS = [
  '.galleryLockups .rowContainer.rowContainer_title_card .slider-item .ptrack-content a[aria-label]',
  '.slider-item .slider-refocus[aria-label]',
  '.slider-item a[aria-label]',
  '.slider-refocus[aria-label]',
  '.title-card a[aria-label]',
  '.title-card[aria-label]',
  '.slider a[aria-label]',
  'a[href*="/watch/"][aria-label]',
  'a[href*="/title/"][aria-label]',
  '.boxart-container',
];

function cleanTitle(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTitle(value) {
  const title = cleanTitle(value);
  if (!title || title.length > 300) return '';
  if (/^(home|shows|movies|games|new & popular|my list|browse by languages|search)$/i.test(title)) return '';
  return title;
}

function getNetflixItems() {
  const items = [];
  const seen = new Set();
  const selectorCounts = Object.fromEntries(
    TITLE_SELECTORS.map(selector => [selector, document.querySelectorAll(selector).length]),
  );

  for (const selector of TITLE_SELECTORS) {
    document.querySelectorAll(selector).forEach(element => {
      const anchor = element.closest('a') || element.querySelector('a') || element;
      const href = anchor.getAttribute('href') || '';
      const title = normalizeTitle(
        element.getAttribute('aria-label') ||
        anchor.getAttribute('aria-label') ||
        anchor.getAttribute('title') ||
        element.textContent,
      );

      if (!title) return;

      const idMatch = href.match(/\/(?:title|watch)\/(\d+)/);
      const id = idMatch
        ? `netflix-${idMatch[1]}`
        : `netflix-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

      if (seen.has(id)) return;
      seen.add(id);

      items.push({
        id,
        title,
        type: 'Series',
        provider: 'Netflix',
      });
    });
  }

  return {
    items,
    selectorCounts,
    watchLinkCount: document.querySelectorAll('a[href*="/watch/"]').length,
    ariaLabelCount: document.querySelectorAll('[aria-label]').length,
  };
}

async function waitForNetflixItems(timeoutMs = 12000) {
  const started = Date.now();
  let lastCount = 0;
  let stableChecks = 0;
  let scan = getNetflixItems();

  while (Date.now() - started < timeoutMs) {
    scan = getNetflixItems();
    const items = scan.items;
    if (items.length > lastCount) {
      lastCount = items.length;
      stableChecks = 0;
    } else {
      stableChecks += 1;
    }

    if (items.length > 0 && stableChecks >= 3) return scan;

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return scan;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:provider-scan') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  waitForNetflixItems()
    .then(scan => {
      chrome.runtime.sendMessage({
        type: 'provider-watchlist-items',
        nonce: message.nonce,
        items: scan.items,
        diagnostics: {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          selectorCounts: scan.selectorCounts,
          watchLinkCount: scan.watchLinkCount,
          ariaLabelCount: scan.ariaLabelCount,
        },
      }).catch(() => {});
    })
    .catch(() => {});

  sendResponse({ ok: true, accepted: true });
});
