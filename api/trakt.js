import crypto from 'node:crypto';

const PROJECT_ID = 'stream-command-center-c5445';
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TRAKT_API = 'https://api.trakt.tv';
const TRAKT_AUTH = 'https://auth.trakt.tv';
const PAGE_LIMIT = 250;
const MAX_PAGES = 50;
const DEFAULT_ACCENT = 'from-cyan-500/30 to-indigo-950';

let jwksCache = null;
let jwksExpiresAt = 0;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function getFirebaseJwks() {
  if (jwksCache && Date.now() < jwksExpiresAt) return jwksCache;
  const response = await fetch(FIREBASE_JWKS_URL);
  if (!response.ok) throw new Error('Could not validate Stream Command sign-in.');
  const data = await response.json();
  jwksCache = data.keys || [];
  const maxAge = Number((response.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksExpiresAt = Date.now() + Math.max(60, maxAge) * 1000;
  return jwksCache;
}

async function verifyFirebaseIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Sign in to your Stream Command account first.'), { status: 401 });
  let header;
  let claims;
  try {
    header = decodeJwtPart(parts[0]);
    claims = decodeJwtPart(parts[1]);
  } catch {
    throw Object.assign(new Error('Your sign-in session is invalid. Please sign in again.'), { status: 401 });
  }
  if (header.alg !== 'RS256' || !header.kid) throw Object.assign(new Error('Your sign-in session is invalid.'), { status: 401 });
  const jwks = await getFirebaseJwks();
  const jwk = jwks.find(item => item.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    const refreshed = await getFirebaseJwks();
    const replacement = refreshed.find(item => item.kid === header.kid);
    if (!replacement) throw Object.assign(new Error('Your sign-in session could not be validated.'), { status: 401 });
    return verifyJwtSignature(parts, header, claims, replacement);
  }
  return verifyJwtSignature(parts, header, claims, jwk);
}

function verifyJwtSignature(parts, header, claims, jwk) {
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2], 'base64url'));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== PROJECT_ID || claims.iss !== 'https://securetoken.google.com/' + PROJECT_ID ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      typeof claims.iat !== 'number' || claims.iat > now + 300) {
    throw Object.assign(new Error('Your sign-in session is invalid or expired. Please sign in again.'), { status: 401 });
  }
  if (claims.firebase?.sign_in_provider === 'anonymous') {
    throw Object.assign(new Error('Create or sign in to a Stream Command account to enable secure Trakt sync across devices.'), { status: 403 });
  }
  return { uid: claims.sub, idToken: parts.join('.') };
}

function getEncryptionKey() {
  const raw = process.env.TRAKT_TOKEN_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('Secure Trakt storage is not configured on the server.');
  return key;
}

function encryptTokens(tokens) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') };
}

function decryptTokens(vault) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(vault.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(vault.tag, 'base64'));
    const clear = Buffer.concat([decipher.update(Buffer.from(vault.data, 'base64')), decipher.final()]).toString('utf8');
    const tokens = JSON.parse(clear);
    if (!tokens.accessToken || !tokens.refreshToken || typeof tokens.expiresAt !== 'number') throw new Error('Invalid token payload');
    return tokens;
  } catch {
    throw new Error('Saved Trakt connection could not be decrypted. Please reconnect Trakt.');
  }
}

const firestoreDocumentUrl = uid => 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/users/' + encodeURIComponent(uid);

async function readUserDocument(idToken, uid) {
  const response = await fetch(firestoreDocumentUrl(uid), { headers: { Authorization: 'Bearer ' + idToken } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not access your Stream Command profile (' + response.status + ').');
  return response.json();
}

function getVaultFromDocument(document) {
  const fields = document?.fields?.traktVault?.mapValue?.fields;
  if (!fields?.iv?.stringValue || !fields?.tag?.stringValue || !fields?.data?.stringValue) return null;
  return { iv: fields.iv.stringValue, tag: fields.tag.stringValue, data: fields.data.stringValue };
}

async function writeVault(idToken, uid, vault) {
  const url = new URL(firestoreDocumentUrl(uid));
  url.searchParams.append('updateMask.fieldPaths', 'traktVault');
  const fields = vault ? {
    traktVault: { mapValue: { fields: {
      iv: { stringValue: vault.iv },
      tag: { stringValue: vault.tag },
      data: { stringValue: vault.data },
    } } },
  } : {};
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('Could not save your encrypted Trakt connection (' + response.status + '). ' + detail.slice(0, 180));
  }
}

async function saveTokens(idToken, uid, responseData) {
  if (!responseData?.access_token || !responseData?.refresh_token || typeof responseData.expires_in !== 'number') {
    throw new Error('Trakt returned an incomplete token response. Please connect again.');
  }
  const tokens = {
    accessToken: responseData.access_token,
    refreshToken: responseData.refresh_token,
    expiresAt: Date.now() + responseData.expires_in * 1000,
  };
  await writeVault(idToken, uid, encryptTokens(tokens));
  return tokens;
}

function getTraktClientId() {
  return process.env.VITE_TRAKT_CLIENT_ID || process.env.TRAKT_CLIENT_ID || '';
}

function validateRedirectUri(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Invalid Trakt redirect URL.'); }
  const allowedHost = url.hostname === 'stream.athenawaypoints.com' ||
    (url.hostname.endsWith('.vercel.app') && !url.hostname.startsWith('.'));
  const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localDev) throw new Error('Trakt redirect must use HTTPS.');
  if ((!allowedHost && !localDev) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Trakt redirect URL is not an approved Stream Command origin.');
  }
  return url.toString();
}

async function exchangeCode(idToken, uid, body) {
  const clientId = getTraktClientId();
  if (!clientId) throw new Error('Trakt is not configured on the server.');
  const redirectUri = validateRedirectUri(body.redirectUri);
  if (!body.code || !body.codeVerifier) throw new Error('Trakt authorization response is incomplete.');
  const response = await fetch(TRAKT_AUTH + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code: body.code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: body.codeVerifier,
    }),
  });
  if (!response.ok) {
    let detail = '';
    try { const json = await response.json(); detail = json.error_description || json.message || json.error || ''; } catch {}
    throw new Error(detail || 'Trakt authorization exchange failed (' + response.status + ').');
  }
  await saveTokens(idToken, uid, await response.json());
}

async function refreshTokens(idToken, uid, tokens) {
  const response = await fetch(TRAKT_AUTH + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      refresh_token: tokens.refreshToken,
      client_id: getTraktClientId(),
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      await writeVault(idToken, uid, null);
      throw Object.assign(new Error('Your Trakt connection expired. Please connect Trakt again.'), { status: 401 });
    }
    throw new Error('Trakt token refresh failed (' + response.status + ').');
  }
  return saveTokens(idToken, uid, await response.json());
}

async function getTokens(idToken, uid) {
  const document = await readUserDocument(idToken, uid);
  const vault = getVaultFromDocument(document);
  if (!vault) throw Object.assign(new Error('Connect Trakt to your Stream Command account first.'), { status: 409 });
  let tokens = decryptTokens(vault);
  if (tokens.expiresAt <= Date.now() + 60_000) tokens = await refreshTokens(idToken, uid, tokens);
  return tokens;
}

async function traktGet(url, idToken, uid, tokens, retried = false) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + tokens.accessToken,
      'trakt-api-version': '2',
      'trakt-api-key': getTraktClientId(),
    },
  });
  if (response.status === 401 && !retried) {
    const refreshed = await refreshTokens(idToken, uid, tokens);
    return traktGet(url, idToken, uid, refreshed, true);
  }
  if (!response.ok) throw new Error('Trakt watchlist request failed (' + response.status + ').');
  return { data: await response.json(), headers: response.headers };
}

function mapWatchlistEntry(entry, kind) {
  if (!entry || typeof entry !== 'object') return null;
  const media = entry[kind === 'movies' ? 'movie' : 'show'] || entry;
  const title = String(media.title || media.name || '').trim();
  if (!title) return null;
  const ids = media.ids && typeof media.ids === 'object' ? media.ids : {};
  const primaryId = ids.trakt ?? ids.slug ?? ids.tmdb ?? (title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + String(media.year || 'unknown'));
  return {
    id: 'trakt-' + (kind === 'movies' ? 'movie-' : 'show-') + String(primaryId),
    title,
    type: kind === 'movies' ? 'Movie' : 'Series',
    provider: 'Trakt',
    accent: DEFAULT_ACCENT,
    source: 'trakt',
  };
}

async function fetchWatchlistKind(kind, idToken, uid, tokens) {
  const items = [];
  let page = 1;
  let pageCount = 1;
  while (page <= Math.min(pageCount, MAX_PAGES)) {
    const url = new URL(TRAKT_API + '/sync/watchlist/' + kind);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('extended', 'full');
    const response = await traktGet(url.toString(), idToken, uid, tokens);
    const rows = Array.isArray(response.data) ? response.data : [];
    rows.forEach(row => { const mapped = mapWatchlistEntry(row, kind); if (mapped) items.push(mapped); });
    const header = response.headers.get('X-Pagination-Page-Count');
    const parsed = header ? Number(header) : NaN;
    pageCount = Number.isFinite(parsed) && parsed > 0 ? parsed : (rows.length === PAGE_LIMIT ? page + 1 : page);
    page += 1;
  }
  if (page <= pageCount) throw new Error('This Trakt watchlist is too large for one safe sync pass.');
  return items;
}

async function syncWatchlist(idToken, uid) {
  const tokens = await getTokens(idToken, uid);
  const [movies, shows] = await Promise.all([
    fetchWatchlistKind('movies', idToken, uid, tokens),
    fetchWatchlistKind('shows', idToken, uid, tokens),
  ]);
  const seen = new Set();
  const items = [...movies, ...shows].filter(item => {
    const key = item.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, total: items.length };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const identity = await verifyFirebaseIdToken(idToken);
    const body = await readJson(req);
    const action = String(body.action || '');
    if (action === 'status') {
      const document = await readUserDocument(identity.idToken, identity.uid);
      return send(res, 200, { connected: Boolean(getVaultFromDocument(document)) });
    }
    if (action === 'exchange') {
      await exchangeCode(identity.idToken, identity.uid, body);
      return send(res, 200, await syncWatchlist(identity.idToken, identity.uid));
    }
    if (action === 'sync') {
      return send(res, 200, await syncWatchlist(identity.idToken, identity.uid));
    }
    if (action === 'disconnect') {
      await writeVault(identity.idToken, identity.uid, null);
      return send(res, 200, { connected: false });
    }
    return send(res, 400, { error: 'Unsupported Trakt action.' });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return send(res, status, { error: error instanceof Error ? error.message : 'Trakt request failed.' });
  }
}
