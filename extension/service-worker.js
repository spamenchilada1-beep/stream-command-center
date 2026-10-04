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


async function scanNetflixTab(tabId, nonce) {
  const started = Date.now();
  let lastError = null;
  let reloaded = false;

  while (Date.now() - started < 8000) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'scc:provider-scan',
        nonce,
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Netflix reader returned no results.');
      }
      return Array.isArray(response.items) ? response : { ...response, items: [] };
    } catch (error) {
      lastError = error;
      if (!reloaded && String(error?.message || error).includes('Receiving end does not exist')) {
        reloaded = true;
        try {
          await chrome.tabs.reload(tabId);
        } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }

  throw lastError || new Error('Netflix reader did not become available.');
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
      let scan;
      try {
        scan = await scanNetflixTab(tab.id, nonce);
        scanCount += 1;
      } catch (error) {
        scanErrors.push({
          tabId: tab.id,
          url: tab.url,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
        continue;
      }

      const items = Array.isArray(scan?.items) ? scan.items : [];

      try {
        await chrome.tabs.sendMessage(sccTabId, {
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
