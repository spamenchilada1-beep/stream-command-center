const SCC_ORIGIN = 'https://stream-command-center-three.vercel.app';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== SCC_ORIGIN) return;

  const message = event.data;
  if (message?.source !== 'stream-command-center' || message?.type !== 'scc:import-start') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;

  try {
    chrome.runtime.sendMessage({
      type: 'scc:import-start',
      nonce: message.nonce,
    }).catch(() => {});
  } catch {
    // Ignore stale content-script contexts after an extension reload.
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type !== 'scc:watchlist-import') return;
  if (typeof message.nonce !== 'string' || !Array.isArray(message.items)) return;

  window.postMessage(
    {
      source: 'stream-command-extension',
      type: 'scc:watchlist-import',
      nonce: message.nonce,
      items: message.items,
      diagnostics: message.diagnostics || null,
    },
    SCC_ORIGIN,
  );
});
