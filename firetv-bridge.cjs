const { execFile } = require('child_process');
const http = require('http');

const FIRE_TV = '192.168.0.50:5555';
const SAMSUNG_TV = '192.168.0.95';
const SAMSUNG_PORT = 8001;
const PORT = 8787;

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

const seenCommands = new Map();

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
  await runAdb(['-s', FIRE_TV, 'shell', 'am', 'force-stop', component]);
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
    const primeUri = uri.startsWith('amzn://')
      ? uri
      : uri.replace('https://app.primevideo.com/detail', 'amzn://avod/watch')
          .replace('https://app.primevideo.com/watch', 'amzn://avod/watch');
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
    res.setHeader('Access-Control-Allow-Origin', 'https://stream-command-center-three.vercel.app');
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

function launchBridgeBrowser() {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const url = 'https://stream-command-center-three.vercel.app/?bridge=1';
  execFile(chrome, ['--app=' + url], { windowsHide: true }, error => {
    if (error) console.error('[BRIDGE] Could not open relay browser:', error.message);
    else console.log('[BRIDGE] relay browser opened');
  });
}

async function main() {
  startBridgeServer();
  await runAdb(['connect', FIRE_TV]).catch(error => console.error('[BRIDGE] Fire TV ADB connect:', error.message));
  console.log('[BRIDGE] Fire TV + Samsung native handoff ready');
  launchBridgeBrowser();
}

main().catch(error => {
  console.error('[BRIDGE] fatal:', error.message);
  process.exit(1);
});
