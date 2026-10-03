const sessions = new Map();
let sccTabId = null;

async function sendToProviderTabs(nonce) {
  const tabs = await chrome.tabs.query({
    url: [
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
    ]
  });

  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, {
      type: 'scc:provider-scan',
      nonce,
    }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id) return;

  if (message?.type === 'scc-session-start' && typeof message.nonce === 'string') {
    sccTabId = sender.tab.id;
    sessions.set(message.nonce, {
      sccTabId,
      startedAt: Date.now(),
    });

    sendResponse({ ok: true });



    sendToProviderTabs(message.nonce);
    return;
  }

  if (message?.type === 'provider-watchlist-items' && Array.isArray(message.items)) {
    const session = sessions.get(message.nonce);

    if (!session || Date.now() - session.startedAt > 5 * 60 * 1000) {
      sendResponse({ ok: false, reason: 'no-active-session' });
      return;
    }

    if (sender.tab?.id === session.sccTabId) {
      sendResponse({ ok: false, reason: 'invalid-provider-tab' });
      return;
    }

    chrome.tabs.sendMessage(session.sccTabId, {
      type: 'scc:watchlist-import',
      nonce: session.nonce,
      items: message.items,
    }).catch(() => {});

    sendResponse({ ok: true });
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== 'https://stream-command-center-three.vercel.app') {
    sendResponse({ ok: false, reason: 'origin-not-allowed' });
    return;
  }

  if (message?.type === 'scc:import-start' && typeof message.nonce === 'string') {
    sendResponse({ ok: true, accepted: true });
    return;
  }

  sendResponse({ ok: false, reason: 'unsupported-message' });
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === sccTabId) sccTabId = null;
});
