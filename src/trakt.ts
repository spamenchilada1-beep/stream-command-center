import { auth } from './firebase';

export type TraktWatchlistTitle = {
  id: string;
  title: string;
  type: 'Movie' | 'Series';
  provider: 'Trakt';
  accent: string;
  source: 'trakt';
};

export type TraktSyncResult = {
  items: TraktWatchlistTitle[];
  total: number;
};

type TraktBackendResult = {
  items?: TraktWatchlistTitle[];
  total?: number;
  connected?: boolean;
  error?: string;
};

type TraktResponse = {
  data: unknown;
  headers: Headers;
};

const API_BASE = 'https://api.trakt.tv';
const AUTH_BASE = 'https://auth.trakt.tv';
const CONNECTED_STORAGE_KEY = 'stream-trakt-connected-v1';
const EXCLUDED_STORAGE_KEY = 'stream-trakt-excluded-title-ids-v1';
const STATE_STORAGE_KEY = 'stream-trakt-oauth-state';
const VERIFIER_STORAGE_KEY = 'stream-trakt-code-verifier';
const DEFAULT_ACCENT = 'from-cyan-500/30 to-indigo-950';

function getEnvValue(name: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[name]?.trim() || '';
}

function getClientId(): string {
  return getEnvValue('VITE_TRAKT_CLIENT_ID');
}

function getRedirectUri(): string {
  return getEnvValue('VITE_TRAKT_REDIRECT_URI') || (window.location.origin + '/');
}

export function isTraktConfigured(): boolean {
  return getClientId().length > 0;
}

export function hasTraktConnection(): boolean {
  return localStorage.getItem(CONNECTED_STORAGE_KEY) === 'true';
}

async function requestTraktBackend(action: string, payload: Record<string, unknown> = {}): Promise<TraktBackendResult> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('Create or sign in to a Stream Command account to enable secure Trakt sync across devices.');
  }
  const idToken = await user.getIdToken();
  const response = await fetch('/api/trakt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + idToken,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let body: TraktBackendResult = {};
  try { body = await response.json() as TraktBackendResult; } catch {}
  if (!response.ok) throw new Error(body.error || ('Trakt request failed (' + response.status + ').'));
  return body;
}

export async function checkTraktConnection(): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !isTraktConfigured()) {
    localStorage.removeItem(CONNECTED_STORAGE_KEY);
    return false;
  }
  try {
    const result = await requestTraktBackend('status');
    const connected = result.connected === true;
    if (connected) localStorage.setItem(CONNECTED_STORAGE_KEY, 'true');
    else localStorage.removeItem(CONNECTED_STORAGE_KEY);
    return connected;
  } catch {
    // Preserve the last known UI state during transient network errors; a sync still revalidates server-side.
    return hasTraktConnection();
  }
}

function getExcludedTraktTitleIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXCLUDED_STORAGE_KEY) || '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

export function hasTraktExclusions(): boolean {
  return getExcludedTraktTitleIds().size > 0;
}

export function excludeTraktTitle(id: string): void {
  const excluded = getExcludedTraktTitleIds();
  excluded.add(id);
  localStorage.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify(Array.from(excluded)));
}

export function clearTraktExclusions(): void {
  localStorage.removeItem(EXCLUDED_STORAGE_KEY);
}

export function isTraktOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function beginTraktAuthorization(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error('Trakt is not configured yet. The public Trakt Client ID must be added to the deployment settings first.');
  }
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('Create or sign in to a Stream Command account first so Trakt can sync securely across devices.');
  }

  const verifier = randomBase64Url(48);
  const state = randomBase64Url(24);
  const challenge = await createCodeChallenge(verifier);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  sessionStorage.setItem(STATE_STORAGE_KEY, state);

  const authorizeUrl = new URL(AUTH_BASE + '/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', getRedirectUri());
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', state);
  window.location.assign(authorizeUrl.toString());
}

function clearOAuthQueryParameters(): void {
  const url = new URL(window.location.href);
  ['code', 'state', 'error', 'error_description'].forEach(key => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}

async function responseError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json() as { error_description?: string; error?: string; message?: string };
    detail = body.error_description || body.message || body.error || '';
  } catch {
    // Some error responses do not contain JSON.
  }
  return new Error(detail || ('Trakt request failed (' + response.status + ').'));
}

function normalizeResult(result: TraktBackendResult): TraktSyncResult {
  const seen = new Set<string>();
  const excluded = getExcludedTraktTitleIds();
  const items = (Array.isArray(result.items) ? result.items : []).filter(item => {
    if (!item || typeof item.id !== 'string' || !item.title) return false;
    const key = item.id.toLowerCase();
    if (excluded.has(item.id) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, total: items.length };
}

export async function finishTraktOAuthCallback(): Promise<TraktSyncResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const providerError = params.get('error');
  const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);

  clearOAuthQueryParameters();
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);

  if (providerError) {
    throw new Error(providerError === 'access_denied' ? 'Trakt access was cancelled. No connection was made.' : 'Trakt authorization failed: ' + providerError);
  }
  if (!code) throw new Error('Trakt did not return an authorization code. Please try connecting again.');
  if (!expectedState || !returnedState || expectedState !== returnedState) {
    throw new Error('Trakt security check failed. Please start the connection again.');
  }
  if (!verifier) throw new Error('The Trakt sign-in session expired. Please connect again.');

  const result = await requestTraktBackend('exchange', {
    code,
    codeVerifier: verifier,
    redirectUri: getRedirectUri(),
  });
  localStorage.setItem(CONNECTED_STORAGE_KEY, 'true');
  return normalizeResult(result);
}

export async function syncTraktWatchlist(): Promise<TraktSyncResult> {
  const result = await requestTraktBackend('sync');
  localStorage.setItem(CONNECTED_STORAGE_KEY, 'true');
  return normalizeResult(result);
}

export async function disconnectTrakt(): Promise<void> {
  await requestTraktBackend('disconnect');
  localStorage.removeItem(CONNECTED_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
}
