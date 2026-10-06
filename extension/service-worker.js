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
  'https://tubitv.com/*',
  'https://www.crunchyroll.com/*',
  'https://www.mgmplus.com/*',
  'https://www.starz.com/*',
  'https://www.amcplus.com/*',
  'https://www.discoveryplus.com/*',
  'https://www.espn.com/*',
  'https://www.fubo.tv/*',
  'https://www.sling.com/*',
  'https://tv.youtube.com/*',
  'https://www.philo.com/*',
  'https://www.britbox.com/*',
  'https://acorn.tv/*',
  'https://www.shudder.com/*',
  'https://mubi.com/*',
  'https://www.hallmarkplus.com/*',
  'https://www.criterionchannel.com/*',
  'https://www.dropout.tv/*',
  'https://www.hidive.com/*',
  'https://pluto.tv/*',
  'https://www.roku.com/*',
  'https://www.plex.tv/*'
];

const PROVIDER_ADAPTERS = {
  netflix: {
    matches: url => url.startsWith('https://www.netflix.com/'),
    scan: requestNetflixScan,
  },
  hulu: {
    matches: url => url.startsWith('https://www.hulu.com/'),
    scan: requestHuluScan,
  },
  peacock: {
    matches: url => url.startsWith('https://www.peacocktv.com/'),
    scan: requestPeacockScan,
  },
  'prime-video': {
    matches: url => url.startsWith('https://www.primevideo.com/'),
    scan: nonceProviderScan('Prime Video'),
  },
  'disney-plus': {
    matches: url => url.startsWith('https://www.disneyplus.com/'),
    scan: nonceProviderScan('Disney+'),
  },
  max: {
    matches: url => url.startsWith('https://www.max.com/'),
    scan: nonceProviderScan('Max'),
  },
  'paramount-plus': {
    matches: url => url.startsWith('https://www.paramountplus.com/'),
    scan: nonceProviderScan('Paramount+'),
  },
  'apple-tv-plus': {
    matches: url => url.startsWith('https://tv.apple.com/'),
    scan: nonceProviderScan('Apple TV+'),
  },
  tubi: {
    matches: url => url.startsWith('https://www.tubitv.com/') || url.startsWith('https://tubitv.com/'),
    scan: nonceProviderScan('Tubi'),
  },
  crunchyroll: {
    matches: url => url.startsWith('https://www.crunchyroll.com/'),
    scan: nonceProviderScan('Crunchyroll'),
  },
  'mgm-plus': {
    matches: url => url.startsWith('https://www.mgmplus.com/'),
    scan: nonceProviderScan('MGM+'),
  },
  starz: {
    matches: url => url.startsWith('https://www.starz.com/'),
    scan: nonceProviderScan('STARZ'),
  },
  'amc-plus': {
    matches: url => url.startsWith('https://www.amcplus.com/'),
    scan: nonceProviderScan('AMC+'),
  },
  'discovery-plus': {
    matches: url => url.startsWith('https://www.discoveryplus.com/'),
    scan: nonceProviderScan('discovery+'),
  },
  espn: {
    matches: url => url.startsWith('https://www.espn.com/'),
    scan: nonceProviderScan('ESPN'),
  },
  fubo: {
    matches: url => url.startsWith('https://www.fubo.tv/'),
    scan: nonceProviderScan('Fubo'),
  },
  sling: {
    matches: url => url.startsWith('https://www.sling.com/'),
    scan: nonceProviderScan('Sling'),
  },
  'youtube-tv': {
    matches: url => url.startsWith('https://tv.youtube.com/'),
    scan: nonceProviderScan('YouTube TV'),
  },
  philo: {
    matches: url => url.startsWith('https://www.philo.com/'),
    scan: nonceProviderScan('Philo'),
  },
  britbox: {
    matches: url => url.startsWith('https://www.britbox.com/'),
    scan: nonceProviderScan('BritBox'),
  },
  'acorn-tv': {
    matches: url => url.startsWith('https://acorn.tv/'),
    scan: nonceProviderScan('Acorn TV'),
  },
  shudder: {
    matches: url => url.startsWith('https://www.shudder.com/'),
    scan: nonceProviderScan('Shudder'),
  },
  mubi: {
    matches: url => url.startsWith('https://mubi.com/'),
    scan: nonceProviderScan('MUBI'),
  },
  hallmark: {
    matches: url => url.startsWith('https://www.hallmarkplus.com/'),
    scan: nonceProviderScan('Hallmark+'),
  },
  criterion: {
    matches: url => url.startsWith('https://www.criterionchannel.com/'),
    scan: nonceProviderScan('Criterion Channel'),
  },
  dropout: {
    matches: url => url.startsWith('https://www.dropout.tv/'),
    scan: nonceProviderScan('Dropout'),
  },
  hidive: {
    matches: url => url.startsWith('https://www.hidive.com/'),
    scan: nonceProviderScan('HIDIVE'),
  },
  'pluto-tv': {
    matches: url => url.startsWith('https://pluto.tv/'),
    scan: nonceProviderScan('Pluto TV'),
  },
  'roku-channel': {
    matches: url => url.startsWith('https://www.roku.com/'),
    scan: nonceProviderScan('The Roku Channel'),
  },
  plex: {
    matches: url => url.startsWith('https://www.plex.tv/'),
    scan: nonceProviderScan('Plex'),
  },
};

function nonceProviderScan(providerName) {
  return (tabId, nonce) => requestProviderReaderScan(tabId, nonce, providerName);
}

function getProviderAdapterEntry(url) {
  return Object.entries(PROVIDER_ADAPTERS).find(([, adapter]) => adapter.matches(url)) || null;
}

function getProviderAdapter(url) {
  return getProviderAdapterEntry(url)?.[1] || null;
}

const AUTH_PATH_PATTERN = /(?:^|\/)(?:login|signin|sign-in|signup|sign-up|register)(?:\/|$)/i;
const SAVED_PATH_PATTERN = /(?:^|\/)(?:my-stuff|my-list|watchlist|watch-list|favorites?|saved|library|up-next|watch-later)(?:\/|$)/i;
const HISTORY_PATH_PATTERN = /(?:^|\/)account\/history(?:\/|$)/i;
const PROVIDER_SCAN_TARGETS = {
  netflix: 'https://www.netflix.com/browse/my-list',
  tubi: 'https://tubitv.com/account/history',
};

function getProviderTabPriority(url, providerId) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (AUTH_PATH_PATTERN.test(path)) return -1000;

    if (providerId === 'netflix') {
      if (/^\/browse\/my-list(?:\/|$)/i.test(path)) return 1000;
      if (/^\/browse(?:\/|$)/i.test(path)) return 900;
    }

    if (providerId === 'tubi' && HISTORY_PATH_PATTERN.test(path)) return 1000;
    if (SAVED_PATH_PATTERN.test(path) || HISTORY_PATH_PATTERN.test(path)) return 500;
    if (/^\/(?:browse|home|watch|movies|shows)(?:\/|$)/i.test(path)) return 100;

    return 10;
  } catch {
    return -1000;
  }
}

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


async function requestProviderReaderScan(tabId, nonce, providerName) {
  const started = Date.now();
  let lastError = null;
  let reloaded = false;

  while (Date.now() - started < 8000) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'scc:provider-scan', nonce });
      if (!response?.ok || response.accepted !== true) {
        throw new Error(response?.error || (providerName + ' reader did not acknowledge the scan.'));
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!reloaded && String(error?.message || error).includes('Receiving end does not exist')) {
        reloaded = true;
        try { await chrome.tabs.reload(tabId); } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }

  throw lastError || new Error(providerName + ' reader did not become available.');
}

async function requestHuluScan(tabId, nonce) {
  return requestProviderReaderScan(tabId, nonce, 'Hulu');
}

async function requestPeacockScan(tabId, nonce) {
  return requestProviderReaderScan(tabId, nonce, 'Peacock');
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

  getSession(message.nonce).then(async session => {
    const senderTabId = sender.tab?.id;
    const providerTabIds = Array.isArray(session?.providerTabIds) ? session.providerTabIds : [];
    if (!session || !senderTabId || !providerTabIds.includes(senderTabId)) return;

    try {
      await chrome.tabs.sendMessage(session.sccTabId, {
        source: 'stream-command-extension',
        type: 'scc:watchlist-import',
        nonce: message.nonce,
        items: message.items,
        diagnostics: message.diagnostics || null,
      });

      const temporaryProviderTabIds = Array.isArray(session.temporaryProviderTabIds)
        ? session.temporaryProviderTabIds
        : [];
      const completedProviderTabIds = Array.from(
        new Set([...(session.completedProviderTabIds || []), senderTabId]),
      );
      if (temporaryProviderTabIds.includes(senderTabId)) {
        await chrome.tabs.remove(senderTabId).catch(() => {});
      }
      const allProvidersComplete =
        providerTabIds.length > 0 && completedProviderTabIds.length >= providerTabIds.length;

      if (allProvidersComplete) {
        await deleteSession(message.nonce).catch(() => {});
        if (session.restoreTabId) {
          try {
            await chrome.tabs.update(session.restoreTabId, { active: true });
          } catch {}
        }
      } else {
        await updateSession(message.nonce, { completedProviderTabIds });
      }
    } catch {}
  }).catch(() => {});
});

async function sendToProviderTabs(nonce, sccTabId) {
  const providerTabs = await chrome.tabs.query({ url: PROVIDER_URLS });
  const allTabs = await chrome.tabs.query({});

  let scanCount = 0;
  let importedCount = 0;
  const scanErrors = [];
  const deliveryErrors = [];
  const providerCandidates = providerTabs
    .map(tab => {
      if (!tab.id || !tab.url) return null;
      const entry = getProviderAdapterEntry(tab.url);
      if (!entry) return null;
      const [providerId, adapter] = entry;
      return {
        tab,
        adapter,
        providerId,
        priority: getProviderTabPriority(tab.url, providerId),
      };
    })
    .filter(candidate => candidate && candidate.priority >= 0);

  const bestByProvider = new Map();
  for (const candidate of providerCandidates) {
    const existing = bestByProvider.get(candidate.providerId);
    if (
      !existing ||
      candidate.priority > existing.priority ||
      (candidate.priority === existing.priority && candidate.tab.active && !existing.tab.active)
    ) {
      bestByProvider.set(candidate.providerId, candidate);
    }
  }

  const preparedCandidates = [];
  const temporaryProviderTabIds = [];
  for (const candidate of bestByProvider.values()) {
    const targetUrl = PROVIDER_SCAN_TARGETS[candidate.providerId];
    if (!targetUrl) {
      preparedCandidates.push({ ...candidate, temporary: false });
      continue;
    }

    try {
      const scanTab = await chrome.tabs.create({ url: targetUrl, active: false });
      if (!scanTab.id) throw new Error(candidate.providerId + ' scan tab could not be created.');
      temporaryProviderTabIds.push(scanTab.id);
      preparedCandidates.push({
        ...candidate,
        tab: scanTab,
        temporary: true,
      });
    } catch (error) {
      scanErrors.push({
        tabId: candidate.tab.id,
        url: candidate.tab.url,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  }

  const eligibleProviderTabs = preparedCandidates.map(candidate => candidate.tab);
  const providerTabIds = eligibleProviderTabs.map(tab => tab.id);
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const session = await getSession(nonce);
  const restoreTabId = session?.restoreTabId || activeTabs[0]?.id || sccTabId;
  await updateSession(nonce, {
    providerTabIds,
    completedProviderTabIds: [],
    temporaryProviderTabIds,
    restoreTabId,
  });

  const visibleProviderTabs = preparedCandidates.map(candidate => ({
    id: candidate.tab.id,
    providerId: candidate.providerId,
    priority: candidate.priority,
    temporary: candidate.temporary,
    url: candidate.tab.url,
    title: candidate.tab.title || '',
  }));

  for (const candidate of preparedCandidates) {
    const tab = candidate.tab;
    const adapter = getProviderAdapter(tab.url);

    try {
      await updateSession(nonce, { providerTabId: tab.id });
      if (!candidate.temporary) {
        await chrome.tabs.update(tab.id, { active: true });
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      await adapter.scan(tab.id, nonce);
      scanCount += 1;
    } catch (error) {
      scanErrors.push({
        tabId: tab.id,
        url: tab.url,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      if (candidate.temporary) {
        await chrome.tabs.remove(tab.id).catch(() => {});
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

async function handleImportStart(message, sender, sendResponse) {
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
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'scc:import-start') return;
  return handleImportStart(message, sender, sendResponse);
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const senderOrigin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (senderOrigin !== SCC_ORIGIN) {
    sendResponse({ ok: false, reason: 'origin-not-allowed' });
    return;
  }

  return handleImportStart(message, sender, sendResponse);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const stored = await chrome.storage.session.get(null);
  const removals = Object.entries(stored)
    .filter(([key, session]) => key.startsWith(SESSION_PREFIX) && session?.sccTabId === tabId)
    .map(([key]) => key);
  if (removals.length) await chrome.storage.session.remove(removals);
});
