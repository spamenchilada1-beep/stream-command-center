const activeSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id) return;

  if (message?.type === 'scc-session-start' && typeof message.nonce === 'string') {
    activeSessions.set(sender.tab.id, {
      nonce: message.nonce,
      startedAt: Date.now(),
    });
    sendResponse({ ok: true });
    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'scc:watchlist-import',
      nonce: message.nonce,
      items: [
        {
          title: 'SCC Extension Test',
          type: 'Series',
          provider: 'Peacock',
        },
      ],
    });
    return;
  }

  if (message?.type === 'provider-watchlist-items' && Array.isArray(message.items)) {
    const session = activeSessions.get(sender.tab.id);
    if (!session) {
      sendResponse({ ok: false, reason: 'no-active-session' });
      return;
    }
    sendResponse({
      ok: true,
      type: 'scc:watchlist-import',
      nonce: session.nonce,
      items: message.items,
    });
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
