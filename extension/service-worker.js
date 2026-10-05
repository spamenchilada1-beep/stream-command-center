const SCC_ORIGIN = 'https://stream-command-center-three.vercel.app';
const SESSION_PREFIX = 'import-session:';

async function setSession(nonce, session) {
  await chrome.storage.session.set({ [SESSION_PREFIX + nonce]: session });
}

async function getSession(nonce) {
  const result = await chrome.storage.session.get(SESSION_PREFIX + nonce);
  return result[SESSION_PREFIX + nonce] || null;
}

async function updateSession(nonce, patch) {
  const session = await getSession(nonce);
  if (!session) return null;
  const next = { ...session, ...patch };
  await setSession(nonce, next);
  return next;
}

async function deleteSession(nonce) {
  await chrome.storage.session.remove(SESSION_PREFIX + nonce);
}

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


async function requestNetflixScan(tabId, nonce) {
  const started = Date.now();
  let lastError = null;
  let reloaded = false;

  while (Date.now() - started < 8000) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'scc:provider-scan',
        nonce,
      });
      if (!response?.ok || response.accepted !== true) {
        throw new Error(response?.error || 'Netflix reader did not acknowledge the scan.');
      }
      return response;
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

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'provider-watchlist-items') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;
  if (!Array.isArray(message.items)) return;

  getSession(message.nonce).then(session => {
    if (!session || !sender.tab?.id || sender.tab.id !== session.providerTabId) return;

    const restoreTabId = session.restoreTabId;
    chrome.tabs.sendMessage(session.sccTabId, {
      source: 'stream-command-extension',
      type: 'scc:watchlist-import',
      nonce: message.nonce,
      items: message.items,
      diagnostics: message.diagnostics || null,
    }).catch(() => {}).finally(async () => {
      await deleteSession(message.nonce).catch(() => {});
      if (restoreTabId) {
        try {
          await chrome.tabs.update(restoreTabId, { active: true });
        } catch {}
      }
    });
  }).catch(() => {});
});

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
      try {
        const session = await getSession(nonce);
        const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const restoreTabId = session?.restoreTabId || activeTabs[0]?.id || sccTabId;
        await updateSession(nonce, { providerTabId: tab.id, restoreTabId });
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise(resolve => setTimeout(resolve, 1000));
        await requestNetflixScan(tab.id, nonce);
        scanCount += 1;
      } catch (error) {
        scanErrors.push({
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

      const providerTab = await chrome.tabs.query({ url: PROVIDER_URLS });
      await setSession(message.nonce, {
        sccTabId: sccTab.id,
        providerTabId: providerTab.find(tab => typeof tab.url === 'string' && tab.url.startsWith('https://www.netflix.com/'))?.id || null,
        startedAt: Date.now(),
      });

      sendResponse({ ok: true, accepted: true, allTabCount: 0, providerTabCount: 0, scanCount: 0, importedCount: 0, scanErrors: [], deliveryErrors: [] });
      sendToProviderTabs(message.nonce, sccTab.id).catch(() => {});
    })
    .catch(() => sendResponse({ ok: false, reason: 'import-start-failed' }));

  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const stored = await chrome.storage.session.get(null);
  const removals = Object.entries(stored)
    .filter(([key, session]) => key.startsWith(SESSION_PREFIX) && session?.sccTabId === tabId)
    .map(([key]) => key);
  if (removals.length) await chrome.storage.session.remove(removals);
});
