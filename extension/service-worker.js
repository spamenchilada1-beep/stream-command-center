const SCC_ORIGIN = 'https://stream-command-center-three.vercel.app';
const sessions = new Map();

const PROVIDER_URLS = [
  'https://www.netflix.com/*',
  'https://www.primevideo.com/*',
  'https://www.disneyplus.com/*',
  'https://www.hulu.com/*',
  'https://www.max.com/*',
  'https://www.paramountplus.com/*',
  'https://www.peacocktv.com/*',
  'https://tv.apple.com/*',
  'https://www.tubitv.com/*',
  'https://www.crunchyroll.com/*'
];

async function findSccTab(preferredTabId) {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab.url?.startsWith(SCC_ORIGIN)) return tab;
    } catch {}
  }

  const tabs = await chrome.tabs.query({ url: [`${SCC_ORIGIN}/*`] });
  return tabs.find(tab => tab.active) || tabs[0] || null;
}

async function sendImportToScc(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: data => {
      window.postMessage(data, window.location.origin);
    },
    args: [payload],
  });
}

async function scanNetflixTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async () => {
      const cleanText = value => (value || '').replace(/\s+/g, ' ').trim();
      const selectors = [
        '.title-card a[aria-label]',
        '.title-card[aria-label]',
        '.slider a[aria-label]',
        '.slider [aria-label]',
        'a[href*="/title/"]',
      ];

      const collect = () => {
        const items = [];
        const seen = new Set();

        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach(element => {
            const anchor = element.closest('a') || element;
            const href = anchor.getAttribute('href') || '';
            const ariaLabel =
              element.getAttribute('aria-label') ||
              anchor.getAttribute('aria-label') ||
              anchor.getAttribute('title') ||
              '';
            const title = cleanText(ariaLabel);

            if (!title || title.length > 300) return;

            const idMatch = href.match(/\/title\/(\d+)/);
            const id = idMatch
              ? `netflix-${idMatch[1]}`
              : `netflix-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

            if (seen.has(id)) return;
            seen.add(id);
            items.push({ id, title, type: 'Series', provider: 'Netflix' });
          });
        }

        return items;
      };

      const started = Date.now();
      let items = collect();

      while (items.length === 0 && Date.now() - started < 6000) {
        await new Promise(resolve => setTimeout(resolve, 500));
        items = collect();
      }

      return items;
    },
  });

  return Array.isArray(results?.[0]?.result) ? results[0].result : [];
}

async function sendToProviderTabs(nonce, sccTabId) {
  const providerTabs = await chrome.tabs.query({ url: PROVIDER_URLS });
  const allTabs = await chrome.tabs.query({});

  let scanCount = 0;
  let importedCount = 0;
  const scanErrors = [];
  const deliveryErrors = [];
  const visibleProviderTabs = providerTabs.map(tab => ({
    id: tab.id,
    url: tab.url,
    title: tab.title || '',
  }));

  for (const tab of providerTabs) {
    if (!tab.id || !tab.url) continue;

    if (tab.url.startsWith('https://www.netflix.com/')) {
      let items;
      try {
        items = await scanNetflixTab(tab.id);
        scanCount += 1;
      } catch (error) {
        scanErrors.push({
          tabId: tab.id,
          url: tab.url,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        continue;
      }

      try {
        await sendImportToScc(sccTabId, {
          source: 'stream-command-extension',
          type: 'scc:watchlist-import',
          nonce,
          items,
        });
        importedCount += items.length;
      } catch (error) {
        deliveryErrors.push({
          tabId: tab.id,
          url: tab.url,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      }
    }
  }

  return {
    allTabCount: allTabs.length,
    providerTabCount: providerTabs.length,
    scanCount,
    importedCount,
    scanErrors,
    deliveryErrors,
    visibleProviderTabs,
  };
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const senderOrigin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (senderOrigin !== SCC_ORIGIN) {
    sendResponse({ ok: false, reason: 'origin-not-allowed' });
    return;
  }

  if (message?.type !== 'scc:import-start' || typeof message.nonce !== 'string' || message.nonce.length < 16) {
    sendResponse({ ok: false, reason: 'unsupported-message' });
    return;
  }

  findSccTab(sender.tab?.id)
    .then(async sccTab => {
      if (!sccTab?.id) {
        sendResponse({ ok: false, reason: 'scc-tab-not-found' });
        return;
      }

      sessions.set(message.nonce, {
        sccTabId: sccTab.id,
        startedAt: Date.now(),
      });

      const result = await sendToProviderTabs(message.nonce, sccTab.id);
      sendResponse({ ok: true, accepted: true, ...result });
    })
    .catch(() => sendResponse({ ok: false, reason: 'import-start-failed' }));

  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const [nonce, session] of sessions.entries()) {
    if (session.sccTabId === tabId) sessions.delete(nonce);
  }
});
