const SCC_ORIGINS = new Set([
  'https://stream.athenawaypoints.com',
  'https://stream-command-center-three.vercel.app',
]);

window.addEventListener('message', event => {
  if (event.source !== window || !SCC_ORIGINS.has(event.origin)) return;

  const message = event.data;
  if (message?.source !== 'stream-command-center' || message?.type !== 'scc:import-start') return;
  if (typeof message.nonce !== 'string' || message.nonce.length < 16) return;
  const targetOrigin = event.origin;

  try {
    chrome.runtime.sendMessage({
      type: 'scc:import-start',
      nonce: message.nonce,
    }).then(response => {
      window.postMessage(
        {
          source: 'stream-command-extension',
          type: 'scc:import-start-ack',
          nonce: message.nonce,
          ok: response?.ok === true,
          reason: response?.reason || null,
        },
        targetOrigin,
      );
    }).catch(error => {
      window.postMessage(
        {
          source: 'stream-command-extension',
          type: 'scc:import-start-ack',
          nonce: message.nonce,
          ok: false,
          reason: String(error?.message || error || 'runtime-message-failed'),
        },
        targetOrigin,
      );
    });
  } catch (error) {
    window.postMessage(
      {
        source: 'stream-command-extension',
        type: 'scc:import-start-ack',
        nonce: message.nonce,
        ok: false,
        reason: String(error?.message || error || 'bridge-send-failed'),
      },
      targetOrigin,
    );
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
    window.location.origin,
  );
});
