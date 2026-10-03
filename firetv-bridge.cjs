const { execFile } = require('child_process');
const {
  getGlobalDefaultAccount,
  getAccessToken,
} = require('C:/Users/Pam Anglada/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');

const FIRE_TV = '192.168.0.50:5555';
const SAMSUNG_TV = '192.168.0.95';
const SAMSUNG_PORT = 8001;
const PROJECT_ID = 'stream-command-center-c5445';
const FIRESTORE_RUN_QUERY =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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
  tubi: 'com.tubitv.ott/.MainActivity',
  starz: 'com.starz.starzplay.firetv/.MainActivity',
  amc: 'com.amctve.amcfiretv/.MainActivity',
  apple: 'com.apple.atve.amazon.appletv/.MainActivity',
};

const seen = new Map();
let cloudToken = null;
let cloudTokenExpiresAt = 0;
let initialized = false;
let polling = false;
let nextPollAt = 0;

function normalize(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.mapValue?.fields) return fromFirestoreFields(value.mapValue.fields);
  if (value.arrayValue?.values) return value.arrayValue.values.map(fromFirestoreValue);
  return null;
}

function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

async function getCloudToken(force = false) {
  if (!force && cloudToken && Date.now() < cloudTokenExpiresAt - 5 * 60 * 1000) {
    return cloudToken;
  }

  const account = getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error('Firebase CLI login is not available on this PC');
  }

  const tokens = await getAccessToken(
    account.tokens.refresh_token,
    [CLOUD_PLATFORM_SCOPE]
  );
  cloudToken = tokens.access_token;
  cloudTokenExpiresAt = tokens.expires_at || Date.now() + (tokens.expires_in || 3600) * 1000;
  return cloudToken;
}

async function runAdb(args) {
  return new Promise((resolve, reject) => {
    execFile('C:\\platform-tools\\adb.exe', args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

async function queryPairedSessions(forceToken = false) {
  const token = await getCloudToken(forceToken);
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'pairingSessions' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'paired' },
        },
      },
    },
  };

  const response = await fetch(FIRESTORE_RUN_QUERY, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 401 && !forceToken) {
    cloudToken = null;
    return queryPairedSessions(true);
  }
  if (!response.ok) throw new Error(`Firestore query failed: HTTP ${response.status}`);

  const rows = await response.json();
  return rows
    .filter(row => row.document)
    .map(row => ({
      id: row.document.name.split('/').pop(),
      ...fromFirestoreFields(row.document.fields),
    }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function launchPeacockTitle(title) {
  const component = fireTvApps.peacock;
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'force-stop', component]);
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-n', component]);
  await sleep(3000);

  // Use Peacock's own signed-in search UI because the Fire TV app does not expose a public title deep link.
  for (let i = 0; i < 8; i += 1) await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '21']); // left
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '19']); // up
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']); // enter
  await sleep(700);

  const searchText = String(title || '').trim().replace(/ /g, '%s');
  if (!searchText) throw new Error('Peacock title is missing');
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'text', searchText]);
  await sleep(500);

  for (let i = 0; i < 4; i += 1) await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '20']); // down
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '21']); // left
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']); // select result
  await sleep(1200);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']); // open title
  await sleep(1200);
  await runAdb(['-s', FIRE_TV, 'shell', 'input', 'keyevent', '66']); // play
  return 'peacock-title-playback';
}

async function launchFireTv(command) {
  const provider = normalize(command.provider);
  const uri = command.launchUri || '';
  console.log(`[FIRETV] ${command.title} / ${command.provider}`);

  if (provider === 'peacock') {
    return launchPeacockTitle(command.title);
  }

  if (provider === 'primevideo' &&
      (uri.startsWith('amzn://') ||
       uri.includes('app.primevideo.com/watch') ||
       uri.includes('app.primevideo.com/detail'))) {
    const primeUri = uri.startsWith('amzn://')
      ? uri
      : uri.replace('https://app.primevideo.com/detail', 'amzn://avod/watch')
          .replace('https://app.primevideo.com/watch', 'amzn://avod/watch');
    await runAdb(['-s', FIRE_TV, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
      '-n', 'com.amazon.avod/.client.activity.FireTvDeepLinkRoutingActivity', '-d', primeUri]);
    return 'prime-playback';
  }

  if (provider === 'hulu') {
    const match = uri.match(/S\.content_id=([^;]+)/);
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

async function poll() {
  if (polling || Date.now() < nextPollAt) return;
  polling = true;

  try {
    const sessions = await queryPairedSessions();

    if (!initialized) {
      const now = Date.now();
      for (const session of sessions) {
        const command = session.command;
        if (!['fire-tv', 'samsung'].includes(session.platform) || !command?.sentAt) continue;
        const key = `${session.platform}:${session.id}`;
        const ageMs = now - Number(command.sentAt);
        if (ageMs > 0 && ageMs <= 10 * 60 * 1000) {
          seen.set(key, command.sentAt);
          try {
            const result = session.platform === 'fire-tv'
              ? await launchFireTv(command)
              : await launchSamsung(command);
            console.log(`[${session.platform.toUpperCase()}] STARTUP PASS ${command.title}: ${result}`);
          } catch (error) {
            console.error(`[${session.platform.toUpperCase()}] STARTUP FAIL ${command.title}: ${error.message}`);
          }
        } else {
          seen.set(key, command.sentAt);
        }
      }
      initialized = true;
      console.log(`[BRIDGE] baseline captured: ${sessions.length} paired session(s)`);
      return;
    }

    for (const session of sessions) {
      if (!['fire-tv', 'samsung'].includes(session.platform)) continue;
      const command = session.command;
      if (!command?.sentAt) continue;

      const key = `${session.platform}:${session.id}`;
      if (seen.get(key) === command.sentAt) continue;
      seen.set(key, command.sentAt);

      try {
        const result = session.platform === 'fire-tv'
          ? await launchFireTv(command)
          : await launchSamsung(command);
        console.log(`[${session.platform.toUpperCase()}] PASS ${command.title}: ${result}`);
      } catch (error) {
        console.error(`[${session.platform.toUpperCase()}] FAIL ${command.title}: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`[BRIDGE] poll error: ${error.message}`);
    if (error.message.includes('HTTP 429')) {
      nextPollAt = Date.now() + 10000;
      console.error('[BRIDGE] Firestore rate limit; backing off for 10 seconds');
    }
  } finally {
    polling = false;
  }
}

async function main() {
  await runAdb(['connect', FIRE_TV]).catch(() => undefined);
  await getCloudToken();
  console.log('[BRIDGE] Firebase CLI auth ready');
  console.log('[BRIDGE] Fire TV + Samsung native handoff ready');
  await poll();
  setInterval(poll, 5000);
}

main().catch(error => {
  console.error(`[BRIDGE] fatal: ${error.message}`);
  process.exit(1);
});
