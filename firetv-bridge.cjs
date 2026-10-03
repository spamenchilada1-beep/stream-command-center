const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously } = require('firebase/auth');
const { getFirestore, collection, query, where, onSnapshot } = require('firebase/firestore');
const { execFile } = require('child_process');

const firebaseConfig = {
  apiKey: 'AIzaSyDOImXoew63ecuSvbJ6LXQwTzCBVYZBooQ',
  authDomain: 'stream-command-center-c5445.firebaseapp.com',
  projectId: 'stream-command-center-c5445',
  storageBucket: 'stream-command-center-c5445.firebasestorage.app',
  messagingSenderId: '1040426316438',
  appId: '1:1040426316438:web:6635d77a34dc1f518d08b7',
};

const ADB = 'C:\\platform-tools\\adb.exe';
const TV = '192.168.0.50:5555';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const seen = new Map();
let initialized = false;

function runAdb(args) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

async function launch(command) {
  const provider = (command.provider || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uri = command.launchUri || '';
  console.log(`[BRIDGE] ${command.title} / ${command.provider}`);

  if (provider === 'primevideo' && (uri.startsWith('amzn://') || uri.includes('app.primevideo.com/watch') || uri.includes('app.primevideo.com/detail'))) {
    const primeUri = uri.startsWith('amzn://')
      ? uri
      : uri.replace('https://app.primevideo.com/detail', 'amzn://avod/watch')
          .replace('https://app.primevideo.com/watch', 'amzn://avod/watch');
    await runAdb(['shell','am','start','-a','android.intent.action.VIEW','-n','com.amazon.avod/.client.activity.FireTvDeepLinkRoutingActivity','-d',primeUri]);
    return 'prime-playback';
  }

  if (provider === 'hulu') {
    const match = uri.match(/S\.content_id=([^;]+)/);
    if (!match) throw new Error('Hulu content_id missing');
    await runAdb(['shell','am','start','-a','hulu.intent.action.PLAY_CONTENT','-n','com.hulu.plus/.SplashActivity','--es','content_id',decodeURIComponent(match[1])]);
    return 'hulu-playback';
  }

  if (provider === 'peacock') {
    await runAdb(['shell','am','start','-n','com.peacock.peacockfiretv/com.peacock.peacocktv.AmazonMainActivity']);
    return 'peacock-app';
  }

  const nativeApps = {
    netflix: 'com.netflix.ninja/.MainActivity',
    hulu: 'com.hulu.plus/.SplashActivity',
    disneyplus: 'com.disney.disneyplus/.MainActivity',
    tubi: 'com.tubitv.ott/.MainActivity',
    starz: 'com.starz.starzplay.firetv/.MainActivity',
    amc: 'com.amctve.amcfiretv/.MainActivity',
    apple: 'com.apple.atve.amazon.appletv/.MainActivity',
  };
  const component = nativeApps[provider];
  if (component) {
    await runAdb(['shell','am','start','-n',component]);
    return 'native-app';
  }

  throw new Error(`No Fire TV bridge adapter for ${command.provider}`);
}

async function main() {
  await runAdb(['connect', TV]).catch(() => undefined);
  await signInAnonymously(auth);
  console.log('[BRIDGE] authenticated');
  const q = query(collection(db, 'pairingSessions'), where('status', '==', 'paired'), where('platform', '==', 'fire-tv'));
  onSnapshot(q, async snapshot => {
    for (const item of snapshot.docs) {
      const data = item.data();
      const command = data.command;
      if (!command?.sentAt) continue;
      const key = item.id;
      if (!initialized) {
        seen.set(key, command.sentAt);
        continue;
      }
      if (seen.get(key) === command.sentAt) continue;
      seen.set(key, command.sentAt);
      try {
        const result = await launch(command);
        console.log(`[BRIDGE] PASS ${command.title}: ${result}`);
      } catch (error) {
        console.error(`[BRIDGE] FAIL ${command.title}: ${error.message}`);
      }
    }
    if (!initialized) {
      initialized = true;
      console.log(`[BRIDGE] watching ${snapshot.size} paired Fire TV session(s)`);
    }
  }, error => console.error(`[BRIDGE] Firestore error: ${error.message}`));
}

main().catch(error => { console.error(`[BRIDGE] fatal: ${error.message}`); process.exit(1); });

