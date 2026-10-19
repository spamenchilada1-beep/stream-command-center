const { execFile } = require('child_process');
const http = require('http');

const FIRE_TV = '192.168.0.50:5555';
const SAMSUNG_TV = '192.168.0.95';
const SAMSUNG_PORT = 8001;
const PORT = 8787;

const FIREBASE_API_KEY = 'AIzaSyDOImXoew63ecuSvbJ6LXQwTzCBVYZBooQ';
const FIREBASE_PROJECT_ID = 'stream-command-center-c5445';
const FIRESTORE_DOCUMENTS_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pairingSessions`;
const FIRESTORE_BATCH_GET_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:batchGet`;
const BRIDGE_POLL_INTERVAL_MS = 5000;
const PAIRING_SESSION_TTL_MS = 10 * 60 * 1000;
const BRIDGE_PLATFORMS = [
  { platform: 'fire-tv', documentId: 'bridge_fire_tv' },
  { platform: 'samsung', documentId: 'bridge_samsung' },
];

let firebaseSession = null;
let bridgePollerStarted = false;
let bridgePollerPrimed = false;
let lastBridgePollError = '';

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, 'referenceValue')) return value.referenceValue;
  if (Object.prototype.hasOwnProperty.call(value, 'bytesValue')) return value.bytesValue;
  if (Object.prototype.hasOwnProperty.call(value, 'geoPointValue')) return value.geoPointValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreDocument(document) {
  return decodeFirestoreFields(document?.fields || {});
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function createAnonymousFirebaseSession() {
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const body = await responseJson(response);
  if (!response.ok || !body.idToken || !body.refreshToken) {
    throw new Error('Firebase anonymous authentication failed (' + response.status + '): ' + (body.error?.message || 'unknown error'));
  }
  firebaseSession = {
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000,
  };
  console.log('[BRIDGE FIRESTORE] Authenticated; listening directly without a browser relay.');
  return firebaseSession.idToken;
}

async function refreshAnonymousFirebaseSession() {
  if (!firebaseSession?.refreshToken) return createAnonymousFirebaseSession();
  const response = await fetch(
    'https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: firebaseSession.refreshToken,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const body = await responseJson(response);
  if (!response.ok || !body.id_token) {
    firebaseSession = null;
    return createAnonymousFirebaseSession();
  }
  firebaseSession = {
    idToken: body.id_token,
    refreshToken: body.refresh_token || firebaseSession.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return firebaseSession.idToken;
}

async function getFirebaseIdToken(forceRefresh = false) {
  if (!firebaseSession) return createAnonymousFirebaseSession();
  if (forceRefresh || firebaseSession.expiresAt - Date.now() < 120000) {
    return refreshAnonymousFirebaseSession();
  }
  return firebaseSession.idToken;
}

async function readBridgeDocument(documentId) {
  let token = await getFirebaseIdToken();
  let response = await fetch(FIRESTORE_DOCUMENTS_URL + '/' + documentId, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401) {
    token = await getFirebaseIdToken(true);
    response = await fetch(FIRESTORE_DOCUMENTS_URL + '/' + documentId, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  }
  if (response.status === 404) return null;
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error('Firestore read failed (' + response.status + '): ' + (body.error?.message || 'unknown error'));
  }
  return decodeFirestoreDocument(body);
}


async function readBridgeDocuments() {
  const documentNames = BRIDGE_PLATFORMS.map(item => 'projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/pairingSessions/' + item.documentId);
  const sendBatchGet = async token => fetch(FIRESTORE_BATCH_GET_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ documents: documentNames }),
    signal: AbortSignal.timeout(20000),
  });

  let token = await getFirebaseIdToken();
  let response = await sendBatchGet(token);
  if (response.status === 401) {
    token = await getFirebaseIdToken(true);
    response = await sendBatchGet(token);
  }

  const responseText = await response.text();
  if (!response.ok) {
    let message = responseText;
    try {
      message = JSON.parse(responseText).error?.message || message;
    } catch {
      // Keep the unstructured service response.
    }
    throw new Error('Firestore batch read failed (' + response.status + '): ' + message);
  }

  const responses = [];
  try {
    const parsed = JSON.parse(responseText);
    responses.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  } catch {
    for (const line of responseText.split(/\r?\n/).filter(Boolean)) {
      responses.push(JSON.parse(line));
    }
  }

  const byDocumentId = new Map();
  for (const item of responses) {
    if (item.found?.name) {
      byDocumentId.set(item.found.name.split('/').pop(), decodeFirestoreDocument(item.found));
    } else if (item.missing) {
      byDocumentId.set(item.missing.split('/').pop(), null);
    } else if (item.error) {
      throw new Error('Firestore batch read item failed: ' + (item.error.message || JSON.stringify(item.error)));
    }
  }

  return BRIDGE_PLATFORMS.map(item => ({
    ...item,
    data: byDocumentId.get(item.documentId) || null,
  }));
}

async function pollFirestoreBridgeCommands() {
  const docs = await readBridgeDocuments();

  if (!bridgePollerPrimed) {
    let existingCommands = 0;
    for (const item of docs) {
      const sentAt = Number(item.data?.command?.sentAt || 0);
      if (sentAt) {
        existingCommands += 1;
        lastBridgeCommands.set(item.platform, sentAt);
      }
    }
    bridgePollerPrimed = true;
    console.log('[BRIDGE FIRESTORE] Connected; ignored ' + existingCommands + ' pre-existing command(s) and waiting for new ones.');
    return;
  }

  for (const item of docs) {
    const data = item.data;
    const command = data?.command;
    const sentAt = Number(command?.sentAt || 0);
    if (data?.status !== 'paired' || !sentAt) continue;
    if (lastBridgeCommands.get(item.platform) === sentAt) continue;

    lastBridgeCommands.set(item.platform, sentAt);
    const commandAge = Date.now() - sentAt;
    if (commandAge < 0 || commandAge > PAIRING_SESSION_TTL_MS) {
      console.log('[BRIDGE FIRESTORE] Ignored expired/future ' + item.platform + ' command.');
      continue;
    }

    try {
      console.log('[BRIDGE FIRESTORE] New command: ' + command.title + ' / ' + command.provider + ' (' + item.platform + ')');
      const result = await handleCommand({ platform: item.platform, command });
      console.log('[BRIDGE FIRESTORE] DELIVERED ' + command.title + ': ' + result);
    } catch (error) {
      console.error('[BRIDGE FIRESTORE] DELIVERY FAILED ' + (command.title || 'unknown title') + ': ' + error.message);
    }
  }
}

function startFirestoreBridgeListener() {
  if (bridgePollerStarted) return;
  bridgePollerStarted = true;
  const poll = async () => {
    try {
      await pollFirestoreBridgeCommands();
      if (lastBridgePollError) {
        console.log('[BRIDGE FIRESTORE] Connection recovered.');
        lastBridgePollError = '';
      }
    } catch (error) {
      const message = error?.message || String(error);
      if (message !== lastBridgePollError) {
        console.error('[BRIDGE FIRESTORE] Listener unavailable: ' + message);
        lastBridgePollError = message;
      }
    } finally {
      setTimeout(poll, BRIDGE_POLL_INTERVAL_MS);
    }
  };
  void poll();
}

const samsungApps = {
  netflix: '3201907018807',
  hulu: '3201601007625',
  primevideo: '3201910019365',
  disneyplus: 'MCmYXNxgcu.DisneyPlus',
  appletv: '3201807016597',
  tubi: '3KA0pm7a7V.TubiTV',
  youtube: '111299001912',
  peacock: 'G20163014979',
};

const fireTvApps = {
  primevideo: 'com.amazon.avod/.client.activity.FireTvHomeScreenActivity',
  netflix: 'com.netflix.ninja/.MainActivity',
  hulu: 'com.hulu.plus/.SplashActivity',
  disneyplus: 'com.disney.disneyplus/.MainActivity',
  peacock: 'com.peacock.peacockfiretv/com.peacock.peacocktv.AmazonMainActivity',
  tubi: 'com.tubitv.ott/com.tubitv.activities.FireTVMainActivity',
  starz: 'com.starz.starzplay.firetv/.MainActivity',
  amc: 'com.amctve.amcfiretv/.MainActivity',
  apple: 'com.apple.atve.amazon.appletv/.MainActivity',
};

const seenCommands = new Map();
const lastBridgeCommands = new Map();

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function runAdb(args) {
  return new Promise((resolve, reject) => {
    execFile('C:\\platform-tools\\adb.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message || 'ADB command failed'));
      resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchPeacockTitle(title) {
  const component = fireTvApps.peacock;
  const packageName = component.split('/')[0];
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'force-stop', packageName]);
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-n', component]);
  await sleep(3000);

  for (let i = 0; i < 8; i += 1) await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '21']);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '19']);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']);
  await sleep(700);

  const searchText = String(title || '').trim().replace(/ /g, '%s');
  if (!searchText) throw new Error('Peacock title is missing');
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'text', searchText]);
  await sleep(500);

  for (let i = 0; i < 4; i += 1) await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '20']);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '21']);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']);
  await sleep(1200);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']);
  await sleep(1200);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']);
  return 'peacock-title-playback';
}

async function launchFireTv(command) {
  const provider = normalize(command.provider);
  const uri = command.launchUri || '';
  console.log(`[FIRETV] ${command.title} / ${command.provider}`);

  if (provider === 'peacock') return launchPeacockTitle(command.title);

  if (provider === 'primevideo' &&
      (uri.startsWith('amzn://') || uri.includes('app.primevideo.com/watch') || uri.includes('app.primevideo.com/detail'))) {
    const primeUri = uri;
    await runAdb(['-s', FIRE_TV, 'shell', 'am', 'force-stop', 'com.amazon.avod']);
    await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
      '-n', 'com.amazon.avod/.client.activity.FireTvDeepLinkRoutingActivity', '-d', primeUri]);
    return 'prime-playback';
  }

  if (provider === 'hulu') {
    const match = uri.match(/S\\.content_id=([^;]+)/);
    if (match) {
      await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-a', 'hulu.intent.action.PLAY_CONTENT',
        '-n', 'com.hulu.plus/.SplashActivity', '--es', 'content_id', decodeURIComponent(match[1])]);
      return 'hulu-playback';
    }
  }

  const component = fireTvApps[provider];
  if (!component) throw new Error(`No Fire TV app adapter for ${command.provider}`);
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-n', component]);
  return 'native-app';
}

function sendSamsungLaunch(appId, actionType, metaTag = '') {
  return new Promise((resolve, reject) => {
    const name = Buffer.from('StreamCommandBridge').toString('base64');
    const ws = new WebSocket(
      `ws://${SAMSUNG_TV}:${SAMSUNG_PORT}/api/v2/channels/samsung.remote.control?name=${name}`
    );
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Samsung launch timed out'));
    }, 5000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        method: 'ms.channel.emit',
        params: {
          event: 'ed.apps.launch',
          to: 'host',
          data: { appId, action_type: actionType, metaTag },
        },
      }));
      setTimeout(() => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve();
      }, 1200);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(new Error('Samsung WebSocket launch failed'));
    };
  });
}

async function launchSamsung(command) {
  const provider = normalize(command.provider);
  const appId = samsungApps[provider];
  if (!appId) throw new Error(`No Samsung app adapter for ${command.provider}`);

  console.log(`[SAMSUNG] ${command.title} / ${command.provider}`);

  if (command.targetUrl) {
    await sendSamsungLaunch(appId, 'DEEP_LINK', command.targetUrl);
    return 'deep-link-sent';
  }

  await sendSamsungLaunch(appId, 'NATIVE_LAUNCH');
  return 'native-app';
}

async function handleCommand(payload) {
  const platform = payload?.platform;
  const command = payload?.command;
  if (!['fire-tv', 'samsung'].includes(platform)) throw new Error('Unsupported TV platform');
  if (!command?.sentAt) throw new Error('TV command missing sentAt');

  const key = `${platform}:${command.sentAt}`;
  if (seenCommands.get(key)) return 'already-processed';
  seenCommands.set(key, true);

  try {
    const result = platform === 'fire-tv' ? await launchFireTv(command) : await launchSamsung(command);
    console.log(`[${platform.toUpperCase()}] PASS ${command.title}: ${result}`);
    return result;
  } catch (error) {
    seenCommands.delete(key);
    console.error(`[${platform.toUpperCase()}] FAIL ${command.title}: ${error.message}`);
    throw error;
  }
}

function startBridgeServer() {
  const server = http.createServer(async (req, res) => {
    const requestOrigin = req.headers.origin;
    if (
      requestOrigin === 'https://stream.athenawaypoints.com' ||
      requestOrigin === 'https://stream-command-center-three.vercel.app'
    ) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, bridge: 'firetv-samsung', port: PORT }));
    }

    if (req.method !== 'POST' || req.url !== '/command') {
      res.writeHead(404);
      return res.end();
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 250000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const result = await handleCommand(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[BRIDGE] local command relay listening on http://127.0.0.1:${PORT}`);
  });
}

async function main() {
  startBridgeServer();
  await runAdb(['connect', FIRE_TV]).catch(error => console.error('[BRIDGE] Fire TV ADB connect:', error.message));
  console.log('[BRIDGE] Fire TV + Samsung native handoff ready');
  startFirestoreBridgeListener();
}

if (require.main === module) {
  main().catch(error => {
    console.error('[BRIDGE] fatal:', error.message);
    process.exit(1);
  });
}

module.exports = {
  decodeFirestoreValue,
  decodeFirestoreDocument,
  readBridgeDocument,
  readBridgeDocuments,
  pollFirestoreBridgeCommands,
};
