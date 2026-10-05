const PROVIDER_SCAN_MESSAGE = 'scc:provider-scan';
const PROVIDER_RESULT_MESSAGE = 'provider-watchlist-items';

function createProviderAdapter({ providerId, matches, scan }) {
  if (!providerId || typeof matches !== 'function' || typeof scan !== 'function') {
    throw new Error('Invalid provider adapter definition.');
  }

  return Object.freeze({
    providerId,
    matches,
    scan,
  });
}

function findProviderAdapter(adapters, url) {
  if (!url || !Array.isArray(adapters)) return null;
  return adapters.find(adapter => adapter.matches(url)) || null;
}

function sendProviderItems(nonce, items, diagnostics = null) {
  return chrome.runtime.sendMessage({
    type: PROVIDER_RESULT_MESSAGE,
    nonce,
    items,
    diagnostics,
  });
}
