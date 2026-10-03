const TITLE_SELECTORS = [
  '.title-card a[aria-label]',
  '.title-card[aria-label]',
  '.slider a[aria-label]',
  '.slider [aria-label]',
  'a[href*="/title/"]',
];

function cleanTitle(value) {
  return (value || '').replace(/\\s+/g, ' ').trim();
}

function getNetflixItems() {
  const items = [];
  const seen = new Set();

  for (const selector of TITLE_SELECTORS) {
    document.querySelectorAll(selector).forEach(element => {
      const anchor = element.closest('a') || element;
      const href = anchor.getAttribute('href') || '';
      const ariaLabel =
        element.getAttribute('aria-label') ||
        anchor.getAttribute('aria-label') ||
        anchor.getAttribute('title') ||
        '';

      const title = cleanTitle(ariaLabel);
      if (!title || title.length > 300) return;

      const idMatch = href.match(/\/title\/(\d+)/);
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

  return items;
}

function waitForNetflixItems(timeoutMs = 6000) {
  return new Promise(resolve => {
    const started = Date.now();

    const check = () => {
      const items = getNetflixItems();
      if (items.length > 0 || Date.now() - started >= timeoutMs) {
        resolve(items);
        return;
      }
      setTimeout(check, 500);
    };

    check();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:provider-scan') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  waitForNetflixItems().then(items => {
    chrome.runtime.sendMessage({
      type: 'provider-watchlist-items',
      nonce: message.nonce,
      items,
    }).catch(() => {});

    sendResponse({ ok: true, count: items.length });
  });

  return true;
});
