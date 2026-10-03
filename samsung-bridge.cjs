const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously } = require('firebase/auth');
const { getFirestore, collection, query, where, onSnapshot } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyDOXmXoew63ecuSvbJ6LXQwTzCBVYZBooQ',
  authDomain: 'stream-command-center-c5445.firebaseapp.com',
  projectId: 'stream-command-center-c5445',
  storageBucket: 'stream-command-center-c5445.firebasestorage.app',
  messagingSenderId: '1040426316438',
  appId: '1:1040426316438:web:6635d77a34dc1f518d08b7',
};

const TV = '192.168.0.95';
const PORT = 8001;
const samsungApps = {
  netflix: '3201907018807',
  hulu: '3201601007625',
  'primevideo': '3201910019365',
  'disneyplus': 'MCmYXNxgcu.DisneyPlus',
  'appletv': '3201807016597',
  tubi: '3KA0pm7a7V.TubiTV',
  youtube: '111299001912',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const seen = new Map();
let initialized = false;

function normalize(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sendLaunch(appId, actionType, metaTag = '') {
  return new Promise((resolve, reject) => {
    const name = Buffer.from('StreamCommandBridge').toString('base64');
    const ws = new WebSocket(
      `ws://${TV}:${PORT}/api/v2/channels/samsung.remote.control?name=${name}`
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

async function launch(command) {
  const provider = normalize(command.provider);
  const appId = samsungApps[provider];
  if (!appId) throw new Error(`No Samsung app adapter for ${command.provider}`);

  console.log(`[SAMSUNG] ${command.title} / ${command.provider}`);

  if (command.targetUrl) {
    try {
      await sendLaunch(appId, 'DEEP_LINK', command.targetUrl);
      console.log(`[SAMSUNG] DEEP_LINK sent: ${command.targetUrl}`);
      return 'deep-link';
    } catch (error) {
      console.log(`[SAMSUNG] deep-link failed: ${error.message}`);
    }
  }

  await sendLaunch(appId, 'NATIVE_LAUNCH');
  return 'native-app';
}

async function main() {
  await signInAnonymously(auth);
  console.log(`[SAMSUNG] watching ${TV}`);
  const q = query(
    collection(db, 'pairingSessions'),
    where('status', '==', 'paired'),
    where('platform', '==', 'samsung')
  );

  onSnapshot(q, async snapshot => {
    for (const item of snapshot.docs) {
      const data = item.data();
      const command = data.command;
      if (!command?.sentAt) continue;
      if (!initialized) {
        seen.set(item.id, command.sentAt);
        continue;
      }
      if (seen.get(item.id) === command.sentAt) continue;
      seen.set(item.id, command.sentAt);

      try {
        const result = await launch(command);
        console.log(`[SAMSUNG] PASS ${command.title}: ${result}`);
      } catch (error) {
        console.error(`[SAMSUNG] FAIL ${command.title}: ${error.message}`);
      }
    }

    if (!initialized) {
      initialized = true;
      console.log(`[SAMSUNG] ready; paired sessions: ${snapshot.size}`);
    }
  }, error => console.error(`[SAMSUNG] Firestore error: ${error.message}`));
}

main().catch(error => {
  console.error(`[SAMSUNG] fatal: ${error.message}`);
  process.exit(1);
});
