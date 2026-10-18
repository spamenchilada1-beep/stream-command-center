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

type TraktTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type TraktResponse = {
  data: unknown;
  headers: Headers;
};

const API_BASE = 'https://api.trakt.tv';
const AUTH_BASE = 'https://auth.trakt.tv';
const TOKEN_STORAGE_KEY = 'stream-trakt-tokens-v1';
const EXCLUDED_STORAGE_KEY = 'stream-trakt-excluded-title-ids-v1';
const STATE_STORAGE_KEY = 'stream-trakt-oauth-state';
const VERIFIER_STORAGE_KEY = 'stream-trakt-code-verifier';
const DEFAULT_ACCENT = 'from-cyan-500/30 to-indigo-950';
const PAGE_LIMIT = 250;
const MAX_PAGES = 50;

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

function loadTokens(): TraktTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TraktTokens>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) return null;
    return parsed as TraktTokens;
  } catch {
    return null;
  }
}

function saveTokens(data: { access_token?: string; refresh_token?: string; expires_in?: number }): TraktTokens {
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
    throw new Error('Trakt returned an incomplete token response. Please connect again.');
  }
  const tokens: TraktTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  return tokens;
}

export function hasTraktConnection(): boolean {
  return loadTokens() !== null;
}

export function disconnectTrakt(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
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

  const clientId = getClientId();
  if (!clientId) throw new Error('Trakt is not configured yet. Add the public Trakt Client ID to the deployment settings.');

  const response = await fetch(API_BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code,
      client_id: clientId,
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw await responseError(response);

  saveTokens(await response.json());
  return syncTraktWatchlist();
}

async function performTokenRefresh(): Promise<TraktTokens> {
  const current = loadTokens();
  if (!current?.refreshToken) throw new Error('The Trakt session expired. Please connect Trakt again.');

  const response = await fetch(API_BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      refresh_token: current.refreshToken,
      client_id: getClientId(),
      redirect_uri: getRedirectUri(),
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw new Error('Trakt needs you to reconnect. Please use Connect Trakt again.');
    }
    throw await responseError(response);
  }
  return saveTokens(await response.json());
}

let refreshPromise: Promise<TraktTokens> | null = null;

function refreshTokens(): Promise<TraktTokens> {
  if (refreshPromise) return refreshPromise;
  const pending = performTokenRefresh();
  refreshPromise = pending;
  return pending.finally(() => {
    if (refreshPromise === pending) refreshPromise = null;
  });
}
async function getUsableAccessToken(): Promise<string> {
  if (!isTraktConfigured()) throw new Error('Trakt is not configured yet.');
  const tokens = loadTokens();
  if (!tokens) throw new Error('Connect Trakt before syncing its watchlist.');
  if (tokens.expiresAt <= Date.now() + 60_000) {
    return (await refreshTokens()).accessToken;
  }
  return tokens.accessToken;
}

async function traktGet(url: string, alreadyRetried = false): Promise<TraktResponse> {
  const accessToken = await getUsableAccessToken();
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + accessToken,
      'trakt-api-version': '2',
      'trakt-api-key': getClientId(),
    },
  });

  if (response.status === 401 && !alreadyRetried) {
    await refreshTokens();
    return traktGet(url, true);
  }
  if (!response.ok) throw await responseError(response);
  return { data: await response.json() as unknown, headers: response.headers };
}

function mapWatchlistEntry(entry: unknown, kind: 'movies' | 'shows'): TraktWatchlistTitle | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Record<string, unknown>;
  const media = (row[kind === 'movies' ? 'movie' : 'show'] || row) as Record<string, unknown>;
  const title = String(media.title || media.name || '').trim();
  if (!title) return null;

  const ids = (media.ids && typeof media.ids === 'object') ? media.ids as Record<string, unknown> : {};
  const primaryId = ids.trakt ?? ids.slug ?? ids.tmdb ?? (String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + String(media.year || 'unknown'));
  return {
    id: 'trakt-' + (kind === 'movies' ? 'movie-' : 'show-') + String(primaryId),
    title,
    type: kind === 'movies' ? 'Movie' : 'Series',
    provider: 'Trakt',
    accent: DEFAULT_ACCENT,
    source: 'trakt',
  };
}

async function fetchWatchlistKind(kind: 'movies' | 'shows'): Promise<TraktWatchlistTitle[]> {
  const items: TraktWatchlistTitle[] = [];
  let page = 1;
  let hasMorePages = true;

  while (page <= MAX_PAGES && hasMorePages) {
    const url = new URL(API_BASE + '/sync/watchlist/' + kind);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('extended', 'full');

    const response = await traktGet(url.toString());
    const rows = Array.isArray(response.data) ? response.data : [];
    for (const row of rows) {
      const mapped = mapWatchlistEntry(row, kind);
      if (mapped) items.push(mapped);
    }

    const header = response.headers.get('X-Pagination-Page-Count');
    const parsedPageCount = header ? Number(header) : NaN;
    hasMorePages = Number.isFinite(parsedPageCount) && parsedPageCount > 0
      ? page < parsedPageCount
      : rows.length === PAGE_LIMIT;
    page += 1;
  }

  if (hasMorePages) {
    throw new Error('This Trakt watchlist is larger than one safe sync pass can process. Please narrow it and try again.');
  }
  return items;
}

export async function syncTraktWatchlist(): Promise<TraktSyncResult> {
  const [movies, shows] = await Promise.all([
    fetchWatchlistKind('movies'),
    fetchWatchlistKind('shows'),
  ]);
  const seen = new Set<string>();
  const excluded = getExcludedTraktTitleIds();
  const items = [...movies, ...shows].filter(item => {
    const key = item.id.toLowerCase();
    if (excluded.has(item.id) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, total: items.length };
}
