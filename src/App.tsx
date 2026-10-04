import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, MonitorPlay, Plus, QrCode, Search, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createUserWithEmailAndPassword, EmailAuthProvider, linkWithCredential, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getProviderConnection } from './providerConnections';
import { getAvailability, type AvailabilityResult } from './availability';
import { createImportNonce, isWatchlistImportMessage, mergeImportedWatchlist, normalizeImportedItems } from './watchlistImporter';

type Provider = {
  id: string;
  name: string;
  category: 'Subscription' | 'Free' | 'Specialty' | 'Live TV' | 'TVE' | 'Rental / Purchase' | 'Library';
  note?: string;
  devices: string[];
  host?: string;
};

type SavedTitle = {
  id: string;
  title: string;
  type: 'Movie' | 'Series';
  provider: string;
  accent: string;
};

type TvPlatform = 'google-tv' | 'fire-tv' | 'roku' | 'apple-tv' | 'samsung' | 'lg' | 'browser';

type TvRoute = {
  platform: TvPlatform;
  provider: string;
  routeType: TvCommand['routeType'];  status: 'adapter-ready' | 'licensed-link-needed' | 'receiver-fallback';
  launchUri: string | null;
};

type TvCommand = {
  action: 'open-title';
  platform: TvPlatform;
  titleId: string;
  title: string;
  provider: string;
  routeType: 'deep-link' | 'native-app' | 'fallback';
  routeStatus: TvRoute['status'];
  launchUri: string | null;
  targetUrl: string | null;
  sentAt: number;
};

function detectTvPlatform(): TvPlatform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('roku')) return 'roku';
  if (ua.includes('tizen')) return 'samsung';
  if (ua.includes('web0s') || ua.includes('webos')) return 'lg';
  if (ua.includes('appletv') || ua.includes('apple tv')) return 'apple-tv';
  if (ua.includes('aft') || ua.includes('fire tv') || ua.includes('silk') || /\baft[a-z0-9_-]*/.test(ua)) return 'fire-tv';
  if (ua.includes('android tv') || ua.includes('googletv') || ua.includes('google tv')) return 'google-tv';
  return 'browser';
}

const tvPlatforms: { id: TvPlatform; name: string; phase: string; routeType: TvCommand['routeType'] }[] = [
  { id: 'google-tv', name: 'Google TV', phase: 'Phase 1', routeType: 'deep-link' },
  { id: 'fire-tv', name: 'Fire TV', phase: 'Phase 1', routeType: 'deep-link' },
  { id: 'roku', name: 'Roku', phase: 'Phase 2', routeType: 'native-app' },
  { id: 'apple-tv', name: 'Apple TV', phase: 'Phase 2', routeType: 'native-app' },
  { id: 'samsung', name: 'Samsung TV', phase: 'Phase 2', routeType: 'native-app' },
  { id: 'lg', name: 'LG TV', phase: 'Phase 2', routeType: 'native-app' },
  { id: 'browser', name: 'Browser / TV web', phase: 'Now', routeType: 'fallback' },
];

const providers: Provider[] = [
  { id: 'netflix', name: 'Netflix', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'prime-video', name: 'Prime Video', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'max', name: 'Max', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },  { id: 'disney-plus', name: 'Disney+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'hulu', name: 'Hulu', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'paramount-plus', name: 'Paramount+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'peacock', name: 'Peacock', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'apple-tv-plus', name: 'Apple TV+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'mgm-plus', name: 'MGM+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'starz', name: 'STARZ', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'amc-plus', name: 'AMC+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'crunchyroll', name: 'Crunchyroll', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'discovery-plus', name: 'discovery+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'espn', name: 'ESPN', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'espn-plus', name: 'ESPN+', category: 'Subscription', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'fubo', name: 'Fubo', category: 'Live TV', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'sling', name: 'Sling TV', category: 'Live TV', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'youtube-tv', name: 'YouTube TV', category: 'Live TV', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'philo', name: 'Philo', category: 'Live TV', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'britbox', name: 'BritBox', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'acorn-tv', name: 'Acorn TV', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'shudder', name: 'Shudder', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'mubi', name: 'MUBI', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'hallmark', name: 'Hallmark+', category: 'Specialty', devices: ['iOS', 'Android', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'criterion', name: 'Criterion Channel', category: 'Specialty', devices: ['iOS', 'Android', 'Roku', 'Apple TV'] },
  { id: 'dropout', name: 'Dropout', category: 'Specialty', devices: ['iOS', 'Android', 'Roku', 'Apple TV'] },
  { id: 'hidive', name: 'HIDIVE', category: 'Specialty', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'tubi', name: 'Tubi', category: 'Free', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'pluto-tv', name: 'Pluto TV', category: 'Free', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'roku-channel', name: 'The Roku Channel', category: 'Free', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Samsung', 'LG'] },
  { id: 'plex', name: 'Plex', category: 'Free', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung', 'LG'] },
  { id: 'crackle', name: 'Crackle', category: 'Free', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Samsung'] },
  { id: 'kanopy', name: 'Kanopy', category: 'Library', devices: ['iOS', 'Android', 'Roku', 'Apple TV', 'Samsung'] },  { id: 'hoopla', name: 'Hoopla', category: 'Library', devices: ['iOS', 'Android', 'Roku', 'Apple TV', 'Samsung'] },
  { id: 'freevee', name: 'Freevee', category: 'Free', note: 'Amazon free catalog', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'nbc', name: 'NBC', category: 'TVE', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'cbs', name: 'CBS', category: 'TVE', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'abc', name: 'ABC', category: 'TVE', devices: ['iOS', 'Android', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'fox', name: 'FOX', category: 'TVE', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'pbs', name: 'PBS', category: 'TVE', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Apple TV', 'Samsung'] },
  { id: 'history', name: 'HISTORY', category: 'TVE', devices: ['iOS', 'Android', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'lifetime', name: 'Lifetime', category: 'TVE', devices: ['iOS', 'Android', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'food-network', name: 'Food Network', category: 'TVE', devices: ['iOS', 'Android', 'Fire TV', 'Roku', 'Apple TV'] },
  { id: 'fandango-at-home', name: 'Fandango at Home', category: 'Rental / Purchase', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku', 'Samsung', 'LG'] },
  { id: 'google-tv', name: 'Google TV', category: 'Rental / Purchase', devices: ['iOS', 'Android', 'Google TV'] },
  { id: 'apple-tv-store', name: 'Apple TV Store', category: 'Rental / Purchase', devices: ['iOS', 'Apple TV'] },
  { id: 'mgm-plus-amazon', name: 'MGM+ via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'starz-amazon', name: 'STARZ via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'amc-plus-amazon', name: 'AMC+ via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'britbox-amazon', name: 'BritBox via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'acorn-amazon', name: 'Acorn TV via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
  { id: 'shudder-amazon', name: 'Shudder via Prime Video', category: 'Subscription', host: 'Prime Video', devices: ['iOS', 'Android', 'Google TV', 'Fire TV', 'Roku'] },
];

const providerWebFallbacks: Record<string, string> = {
  'Netflix': 'https://www.netflix.com/',
  'Prime Video': 'https://www.primevideo.com/',
  'Hulu': 'https://www.hulu.com/',
  'Paramount+': 'https://www.paramountplus.com/',
  'Disney+': 'https://www.disneyplus.com/',
  'Max': 'https://www.max.com/',
  'Peacock': 'https://www.peacocktv.com/',
  'Apple TV+': 'https://tv.apple.com/',  'MGM+': 'https://www.mgmplus.com/',
  'STARZ': 'https://www.starz.com/',
  'AMC+': 'https://www.amcplus.com/',
  'Crunchyroll': 'https://www.crunchyroll.com/',
  'Tubi': 'https://tubitv.com/',
  'Pluto TV': 'https://pluto.tv/',
  'Plex': 'https://watch.plex.tv/',
};

function normalizeProviderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getNativeTvUrl(platform: TvPlatform, provider: string, item: { iosUrl: string | null; androidUrl: string | null; tvosUrl: string | null; androidTvUrl: string | null; rokuUrl: string | null }, webUrl: string | null = null): string | null {
  const candidates = platform === 'apple-tv' ? [item.tvosUrl]
    : platform === 'roku' ? [item.rokuUrl]
    : platform === 'google-tv' || platform === 'fire-tv' ? [item.androidTvUrl, item.androidUrl]
    : [];
  const nativeUrl = candidates.find(value => value && !value.toLowerCase().includes('deeplinks available for paid plans')) || null;

  if (platform === 'fire-tv' && normalizeProviderName(provider) === 'primevideo' && webUrl) {
    try {
      const url = new URL(webUrl);
      if (url.hostname === 'app.primevideo.com' && url.pathname === '/detail') {
        url.pathname = '/watch';
        return 'amzn://avod/watch' + url.search;
      }
    } catch {
      return null;
    }
  }

  if (platform === 'fire-tv' && normalizeProviderName(provider) === 'hulu' && webUrl) {
    try {
      const url = new URL(webUrl);
      const match = url.pathname.match(/^\/(series|watch)\/([^/]+)/);
      if (match) {
        return `intent://launch/#Intent;action=hulu.intent.action.PLAY_CONTENT;package=com.hulu.plus;component=com.hulu.plus/.SplashActivity;S.content_id=${match[2]};end`;
      }
    } catch {
      return null;
    }
  }

  if (platform === 'fire-tv' && normalizeProviderName(provider) === 'peacock') {
    return 'intent://launch/#Intent;package=com.peacock.peacockfiretv;component=com.peacock.peacockfiretv/com.peacock.peacocktv.AmazonMainActivity;end';
  }

  return nativeUrl;
}

function launchNativeTvUrl(uri: string): void {
  window.location.assign(uri);
}

function resolveTvRoute(platform: TvPlatform, provider: string, webUrl: string | null = null, nativeUrl: string | null = null): TvRoute {
  const routeType = tvPlatforms.find(item => item.id === platform)?.routeType || 'fallback';
  if (routeType === 'deep-link') {
    return {
      platform,
      provider,
      routeType: nativeUrl ? 'deep-link' : webUrl ? 'fallback' : routeType,
      status: nativeUrl ? 'adapter-ready' : webUrl ? 'receiver-fallback' : 'licensed-link-needed',
      launchUri: nativeUrl || webUrl,
    };
  }
  if (routeType === 'native-app') {
    return {
      platform,
      provider,
      routeType: nativeUrl ? 'native-app' : webUrl ? 'fallback' : routeType,
      status: nativeUrl ? 'adapter-ready' : webUrl ? 'receiver-fallback' : 'adapter-ready',
      launchUri: nativeUrl || webUrl,
    };
  }
  return {    platform,
    provider,
    routeType,
    status: 'receiver-fallback',
    launchUri: providerWebFallbacks[provider] || null,
  };
}

const starterTitles: SavedTitle[] = [
  { id: 'yellowstone', title: 'Yellowstone', type: 'Series', provider: 'Peacock', accent: 'from-amber-500/40 to-orange-950' },
  { id: 'bear', title: 'The Bear', type: 'Series', provider: 'Hulu', accent: 'from-red-500/40 to-slate-950' },
  { id: 'fallout', title: 'Fallout', type: 'Series', provider: 'Prime Video', accent: 'from-cyan-500/30 to-indigo-950' },
];

const categories = ['All', 'Subscription', 'Free', 'Specialty', 'Live TV', 'TVE', 'Rental / Purchase', 'Library'];
const PAIRING_SESSION_TTL_MS = 10 * 60 * 1000;
const SCC_IMPORT_EXTENSION_ID = 'fhcjfhfhdcnknkikepklmgpmcenallmm';

type ChromeRuntimeBridge = {
  sendMessage: (extensionId: string, message: unknown) => Promise<{ ok?: boolean; accepted?: boolean; scanCount?: number; importedCount?: number; reason?: string }>;
};

function getChromeRuntimeBridge(): ChromeRuntimeBridge | null {
  const browserWindow = window as Window & { chrome?: { runtime?: ChromeRuntimeBridge } };
  return browserWindow.chrome?.runtime || null;
}

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'services' | 'watchlist'>('home');
  const [connected, setConnected] = useState<string[]>(() => JSON.parse(localStorage.getItem('stream-connected') || '[]'));
  const [watchlist, setWatchlist] = useState<SavedTitle[]>(() => {
    const stored = JSON.parse(localStorage.getItem('stream-watchlist') || JSON.stringify(starterTitles)) as SavedTitle[];
    return stored.map(item => item.id === 'yellowstone' ? { ...item, provider: 'Peacock' } : item);
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [showConnect, setShowConnect] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [showTv, setShowTv] = useState(false);  const [selectedTitle, setSelectedTitle] = useState<SavedTitle | null>(null);
  const [showWhereToWatch, setShowWhereToWatch] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [tvPaired, setTvPaired] = useState(false);
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'waiting' | 'phone-ready' | 'paired'>('idle');
  const [pairingError, setPairingError] = useState('');
  const [pairingSession, setPairingSession] = useState<any>(null);
  const [tvPlatform, setTvPlatform] = useState<TvPlatform>('browser');
  const [receiverMode, setReceiverMode] = useState(false);
  const [receiverRequested, setReceiverRequested] = useState(false);
  const [tvConnectedNotice, setTvConnectedNotice] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountMode, setAccountMode] = useState<'signed-out' | 'signed-in' | 'anonymous'>('anonymous');
  const [showAccount, setShowAccount] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [accountForm, setAccountForm] = useState({ email: '', password: '' });
  const [trialEndsAt, setTrialEndsAt] = useState<number | null>(null);
  const [importNonce, setImportNonce] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const importNonceRef = useRef<string | null>(null);
  const lastAutoLaunchCommand = useRef<number | null>(null);
  const lastBridgeCommands = useRef<Record<string, number>>({});

  useEffect(() => { localStorage.setItem('stream-connected', JSON.stringify(connected)); }, [connected]);
  useEffect(() => { localStorage.setItem('stream-watchlist', JSON.stringify(watchlist)); }, [watchlist]);

  useEffect(() => {
    const handleImportMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isWatchlistImportMessage(event.data)) return;
      if (event.data.nonce !== importNonceRef.current) return;

      const imported = normalizeImportedItems(event.data.items);
      setWatchlist(current => mergeImportedWatchlist(current, imported));
      setImportMessage(`${imported.length} title${imported.length === 1 ? '' : 's'} imported.`);
      importNonceRef.current = null;
      setImportNonce(null);
    };

    window.addEventListener('message', handleImportMessage);
    return () => window.removeEventListener('message', handleImportMessage);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (!user) {
        signInAnonymously(auth).catch(() => setAuthReady(false));
        return;
      }
      setAuthReady(true);
      setAccountMode(user.isAnonymous ? 'anonymous' : 'signed-in');
      setAccountEmail(user.email || '');      if (user.isAnonymous) return;
      const profileRef = doc(db, 'users', user.uid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        const profile = profileSnap.data();
        setTrialEndsAt(typeof profile.trialEndsAt === 'number' ? profile.trialEndsAt : null);
        if (Array.isArray(profile.connectedProviders)) setConnected(profile.connectedProviders);
        if (Array.isArray(profile.watchlist)) setWatchlist(profile.watchlist);
      } else {
        const trialStart = Date.now();
        const trialEnd = trialStart + 72 * 60 * 60 * 1000;
        setTrialEndsAt(trialEnd);
        await setDoc(profileRef, {
          email: user.email || '',
          connectedProviders: connected,
          watchlist,
          trialStartAt: trialStart,
          trialEndsAt: trialEnd,
          subscriptionStatus: 'trialing',
          plan: 'premium',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!authReady || !auth.currentUser || auth.currentUser.isAnonymous) return;    const profileRef = doc(db, 'users', auth.currentUser.uid);
    setDoc(profileRef, {
      email: auth.currentUser.email || accountEmail,
      connectedProviders: connected,
      watchlist,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => undefined);
  }, [connected, watchlist, authReady, accountEmail]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pairCode = params.get('pair');
    const receiverCode = params.get('tv');
    if (pairCode) {
      const requestedPlatform = params.get('platform') as TvPlatform | null;
      if (tvPlatforms.some(item => item.id === requestedPlatform)) setTvPlatform(requestedPlatform!);
      setPairingCode(pairCode);
      setPairingStatus('phone-ready');
      setShowTv(true);
      return;
    }
    if (window.location.pathname === '/tv' || receiverCode === 'new') {
      const requestedPlatform = params.get('platform') as TvPlatform | null;
      const platform = tvPlatforms.some(item => item.id === requestedPlatform) ? requestedPlatform : detectTvPlatform();
      setTvPlatform(platform);
      setReceiverMode(true);
      setShowTv(true);
      if (receiverCode && receiverCode !== 'new') {
        setPairingCode(receiverCode);
        setPairingStatus('waiting');
      } else {
        setReceiverRequested(true);
      }
      return;
    }
    if (receiverCode) {
      setPairingCode(receiverCode);
      setPairingStatus('waiting');
      setReceiverMode(true);
      setShowTv(true);
    }
  }, []);

  useEffect(() => {
    if (!receiverRequested || !authReady || pairingCode) return;
    startTvPairing(null, tvPlatform).catch(() => undefined);
  }, [receiverRequested, authReady, pairingCode, tvPlatform]);

  const bridgeMode = new URLSearchParams(window.location.search).get('bridge') === '1';

  useEffect(() => {
    if (!bridgeMode || !authReady) return;
    const cleanups = (['fire-tv', 'samsung'] as const).map(platform => {
      const bridgeDocId = platform === 'fire-tv' ? 'bridge_fire_tv' : 'bridge_samsung';
      return onSnapshot(doc(db, 'pairingSessions', bridgeDocId), snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const command = data.command as TvCommand | undefined;
        const sentAt = Number(command?.sentAt || 0);
        if (data.status !== 'paired' || !command || !sentAt) return;
        if (lastBridgeCommands.current[platform] === sentAt) return;
        if (Date.now() - sentAt > PAIRING_SESSION_TTL_MS) {
          lastBridgeCommands.current[platform] = sentAt;
          return;
        }
        lastBridgeCommands.current[platform] = sentAt;
        fetch('http://127.0.0.1:8787/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, command }),
        }).then(async response => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
          console.log(`[BRIDGE RELAY] ${platform} ${command.title}: ${result.result || 'sent'}`);
        }).catch(error => {
          console.error('[BRIDGE RELAY] command failed', error);
          lastBridgeCommands.current[platform] = 0;
        });
      });
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [bridgeMode, authReady]);

  useEffect(() => {
    if (!pairingCode || !authReady || bridgeMode) return;
    const sessionRef = doc(db, 'pairingSessions', pairingCode);    return onSnapshot(sessionRef, snapshot => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setPairingSession(data);
      if (tvPlatforms.some(item => item.id === data.platform)) setTvPlatform(data.platform as TvPlatform);
      if (data.status === 'paired') {
        const isTvOwner = data.tvUserId === auth.currentUser?.uid;
        const isPhoneOwner = data.phoneUserId === auth.currentUser?.uid;
        if (isTvOwner || isPhoneOwner) {
          setTvPaired(true);
          setPairingStatus('paired');
        } else {
          setTvPaired(false);
          setPairingStatus('phone-ready');
        }
      }
      if (data.title && !selectedTitle) {
        setSelectedTitle({
          id: data.titleId,
          title: data.title,
          type: data.type || 'Series',
          provider: data.provider,
          accent: data.accent || 'from-indigo-500/30 to-slate-950',
        });
      }
    });
  }, [pairingCode, authReady, selectedTitle]);

  const visibleProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providers.filter(provider =>
      (!query || provider.name.toLowerCase().includes(query) || provider.note?.toLowerCase().includes(query)) &&
      (category === 'All' || provider.category === category)
    );
  }, [search, category]);

  const connectProvider = (id: string) => {
    const provider = providers.find(item => item.id === id);
    if (!provider) return;
    const connection = getProviderConnection(id);

    if (connected.includes(id)) {
      setConnected(current => current.filter(item => item !== id));
      setConnectionMessage(`${provider.name} removed from your Stream Command services.`);
      return;
    }

    setConnected(current => [...current, id]);
    if (connection.launchUrl) {
      window.open(connection.launchUrl, '_blank', 'noopener,noreferrer');
      setConnectionMessage(`${provider.name} added. Any provider sign-in happens on the provider's own site.`);
    } else {
      setConnectionMessage(`${provider.name} added to your Stream Command services.`);
    }
  };

  const submitAccount = async () => {
    const email = accountForm.email.trim();
    const password = accountForm.password;
    if (!email || password.length < 6) {
      setAccountMessage('Enter an email and a password with at least 6 characters.');
      return;
    }
    setAccountBusy(true);
    setAccountMessage('');
    try {
      const currentUser = auth.currentUser;
      if (currentUser?.isAnonymous) {
        try {
          const credential = EmailAuthProvider.credential(email, password);
          await linkWithCredential(currentUser, credential);
          setAccountMessage('Account created. Your saved services and watchlist are now tied to this account.');
          setAccountForm({ email: '', password: '' });
          return;
        } catch (error: any) {
          if (error?.code !== 'auth/email-already-in-use') throw error;
        }
      }
      await signInWithEmailAndPassword(auth, email, password);
      setAccountMessage('Signed in. Your account data is now available on this device.');
      setAccountForm({ email: '', password: '' });
    } catch (error: any) {
      const code = error?.code || '';
      setAccountMessage(code === 'auth/invalid-credential' ? 'That email or password was not recognized.' : code === 'auth/email-already-in-use' ? 'That email already has an account. Use Sign in with that account.' : 'We could not complete the account request. Please try again.');    } finally {
      setAccountBusy(false);
    }
  };

  const startTvPairing = async (title: SavedTitle | null = null, platformOverride: TvPlatform | null = null) => {
    setSelectedTitle(title);
    const platform = platformOverride || tvPlatform;
    setTvPlatform(platform);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setPairingCode(code);
    setPairingError('');
    setTvPaired(false);
    setPairingStatus('waiting');
    setPairingSession(null);
    setShowTv(true);
    if (!auth.currentUser) await signInAnonymously(auth);
    await setDoc(doc(db, 'pairingSessions', code), {
      status: 'waiting',
      tvName: `${tvPlatforms.find(item => item.id === platform)?.name || 'TV'} • Living Room`,
      platform,
      tvUserId: auth.currentUser?.uid || null,
      titleId: title?.id || null,
      title: title?.title || null,
      type: title?.type || null,
      provider: title?.provider || null,
      accent: title?.accent || null,
      command: null,
      createdAt: serverTimestamp(),
    });
  };
  const confirmPhonePairing = async () => {
    if (!pairingCode) return;
    setPairingError('');
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      const user = auth.currentUser;
      if (!user) throw new Error('AUTH_NOT_READY');

      const sessionRef = doc(db, 'pairingSessions', pairingCode);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) throw new Error('PAIRING_CODE_NOT_FOUND');

      const session = sessionSnap.data();
      if (session.status !== 'waiting') throw new Error('PAIRING_CODE_NOT_WAITING');

      const createdAt = session.createdAt;
      if (!createdAt || typeof createdAt.toMillis !== 'function') throw new Error('PAIRING_TIMESTAMP_MISSING');

      if (Date.now() - createdAt.toMillis() > PAIRING_SESSION_TTL_MS) {
        await updateDoc(sessionRef, {
          status: 'expired',
          expiredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        throw new Error('PAIRING_CODE_EXPIRED');
      }

      // The TV-created platform is authoritative. The phone never overwrites it.
      await updateDoc(sessionRef, {
        status: 'paired',
        phoneUserId: user.uid,
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      localStorage.setItem('stream-tv-session', pairingCode);
      setTvPaired(true);
      setPairingStatus('paired');
      setShowTv(false);
      setActiveTab('watchlist');
      setTvConnectedNotice(true);
    } catch (error: any) {
      console.error('TV pairing confirmation failed', error);
      const code = error?.code || error?.message || 'unknown-error';
      const messages: Record<string, string> = {
        'permission-denied': 'Firebase denied the pairing write. The signed-in phone identity is the blocker.',
        'failed-precondition': 'Firebase rejected the pairing request. Please start a fresh TV session.',
        'not-found': 'The TV pairing session could not be found. Start a fresh TV session.',
        AUTH_NOT_READY: 'The phone sign-in is not ready yet. Wait one second and tap again.',
        PAIRING_CODE_NOT_FOUND: 'That pairing code does not exist anymore. Start a fresh TV session.',
        PAIRING_CODE_NOT_WAITING: 'That TV session is already paired or expired. Start a fresh TV session.',
        PAIRING_TIMESTAMP_MISSING: 'That TV session is invalid. Start a fresh TV session.',
        PAIRING_CODE_EXPIRED: 'That pairing code expired. Start a fresh TV session.',
      };
      setPairingError(messages[code] || `Pairing failed: ${code}`);
    }
  };

  const sendTitleToPairedTv = async (titleOverride: SavedTitle | null = null, codeOverride: string | null = null, sessionOverride: any = null) => {
    const title = titleOverride || selectedTitle;
    const code = codeOverride || pairingCode;
    if (!code || !title) return;
    setSelectedTitle(title);
    setPairingCode(code);
    const activeSession = sessionOverride || pairingSession; const platform = (activeSession?.platform || tvPlatform) as TvPlatform;
    const result = await getAvailability(title.title);
    const sources = result.availability || [];
    const preferred = sources.find(item => normalizeProviderName(item.providerName) === normalizeProviderName(title.provider));
    const providerName = title.provider;
    const nativeUrl = preferred ? getNativeTvUrl(platform, providerName, preferred, preferred.webUrl || null) : null;
    const targetUrl = platform === 'samsung'
      ? (preferred?.androidTvUrl && !preferred.androidTvUrl.toLowerCase().includes('deeplinks available for paid plans') ? preferred.androidTvUrl : preferred?.webUrl || null)
      : preferred?.webUrl || null;
    const route = resolveTvRoute(platform, providerName, preferred?.webUrl || null, nativeUrl);
    const command: TvCommand = {
      action: 'open-title',
      platform,
      titleId: title.id,
      title: title.title,
      provider: providerName,
      routeType: route.routeType,
      routeStatus: route.status,
      launchUri: route.launchUri,
      targetUrl,
      sentAt: Date.now(),
    };
    await updateDoc(doc(db, 'pairingSessions', code), { command });
    if (platform === 'fire-tv' || platform === 'samsung') {
      const bridgeDocId = platform === 'fire-tv' ? 'bridge_fire_tv' : 'bridge_samsung';
      await setDoc(doc(db, 'pairingSessions', bridgeDocId), {
        status: 'paired',
        pairingCode: code,
        platform,
        command,
        updatedAt: serverTimestamp(),
      });
    }
  };
  const sendToTv = async (title: SavedTitle) => {
    const savedCode = localStorage.getItem('stream-tv-session');
    const activeCode = savedCode || (pairingStatus === 'paired' && pairingCode ? pairingCode : null);
    if (activeCode) {
      const sessionSnap = await getDoc(doc(db, 'pairingSessions', activeCode));
      if (sessionSnap.exists() && sessionSnap.data().status === 'paired') {
        const session = sessionSnap.data();
        setPairingCode(activeCode);
        setPairingSession(session);
        setPairingStatus('paired');
        setTvPaired(true);
        setShowTv(true);
        if (!savedCode) localStorage.setItem('stream-tv-session', activeCode);
        await sendTitleToPairedTv(title, activeCode, session);
        return;
      }
      if (savedCode) localStorage.removeItem('stream-tv-session');
    }
    await startTvPairing(title);
  };
  const openWhereToWatch = async (title: SavedTitle) => {
    setSelectedTitle(title);
    setAvailability(null);
    setAvailabilityLoading(true);
    setShowWhereToWatch(true);
    const result = await getAvailability(title.title);
    setAvailability(result);
    setAvailabilityLoading(false);
  };

  useEffect(() => {
    const command = pairingSession?.command as TvCommand | undefined;
    if (!receiverMode || !command?.launchUri || !command.sentAt) return;
    if (lastAutoLaunchCommand.current === command.sentAt) return;
    lastAutoLaunchCommand.current = command.sentAt;
    if (command.platform === 'fire-tv' || command.platform === 'samsung') return;
    if (command.routeStatus === 'adapter-ready') launchNativeTvUrl(command.launchUri);
  }, [receiverMode, pairingSession?.command]);

  if (bridgeMode) {
    return <div className="flex min-h-screen items-center justify-center bg-[#05060a] px-6 text-center text-white"><div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Stream Command Bridge</p><h1 className="mt-4 text-3xl font-semibold">Native TV relay active.</h1><p className="mt-2 text-sm text-white/40">This window listens for Fire TV and Samsung commands from your paired session.</p></div></div>;
  }

  return (
    <div className="min-h-screen bg-[#08090d] text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 sm:px-6">
        <header className="flex items-center justify-between py-5">
          <button onClick={() => setActiveTab('home')} className="flex items-center gap-3 text-left">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-black"><MonitorPlay size={21} /></span>
            <span><span className="block text-sm font-semibold tracking-tight">STREAM COMMAND</span><span className="block text-[10px] uppercase tracking-[0.24em] text-white/40">your watch universe</span></span>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAccount(true)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10">{accountMode === 'signed-in' ? (accountEmail || 'Account') : 'Sign in'}</button>
            <button onClick={() => setShowConnect(true)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10">+ Add service</button>
          </div>
        </header>

        <main className="flex-1">
          <nav className="mb-8 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1">
            {[['home', 'Command Center'], ['services', 'My Services'], ['watchlist', 'My Watchlist']].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id as typeof activeTab)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm transition ${activeTab === id ? 'bg-white text-black' : 'text-white/55 hover:text-white'}`}>{label}</button>
            ))}          </nav>

          {activeTab === 'home' && (
            <>
              <section className="grid gap-5 lg:grid-cols-[1.5fr_.8fr]">
                <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-indigo-950 via-[#11131c] to-[#0b0c11] p-7 sm:p-10">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Everything you want to watch</p>
                  <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">Stop hunting across apps.</h1>
                  <p className="mt-5 max-w-xl text-base leading-7 text-white/55">Keep your services, saved shows, and next watch in one command center. Then send what you want to watch from your phone to the TV.</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <button onClick={() => setShowConnect(true)} className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black">Connect services</button>
                    <button onClick={() => setShowTv(true)} className="flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/5"><QrCode size={17} /> Connect a TV</button>
                  </div>
                </div>
                <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-7">
                  <div className="flex items-center justify-between"><p className="text-sm font-semibold">Your setup</p><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300">Catalog v1</span></div>
                  <div className="mt-7 space-y-4"><Stat label="Providers cataloged" value={String(providers.length)} /><Stat label="Services added" value={String(connected.length)} /><Stat label="Saved to watch" value={String(watchlist.length)} /></div>
                  <button onClick={() => setActiveTab('services')} className="mt-7 flex w-full items-center justify-between rounded-2xl border border-white/10 p-4 text-sm hover:bg-white/5">Explore provider catalog <ChevronRight size={17} /></button>
                </div>
              </section>
              <section className="mt-8"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-white/35">Watch next</p><h2 className="mt-1 text-2xl font-semibold">Your saved list</h2></div><button onClick={() => setActiveTab('watchlist')} className="text-sm text-white/45 hover:text-white">View all</button></div><TitleGrid titles={watchlist} onWatch={sendToTv} onWhereToWatch={openWhereToWatch} /></section>
            </>
          )}

          {activeTab === 'services' && (
            <section>
              <div className="mb-6"><p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Provider catalog • {providers.length} entries</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">My Services</h1><p className="mt-2 max-w-2xl text-white/45">Connect what you use. The catalog separates subscription, free, live TV, TVE, rental/purchase, library, specialty, and Prime Video channel relationships.</p></div>
              <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><Search size={18} className="text-white/35" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find Netflix, MGM+, Peacock, Tubi..." className="w-full bg-transparent text-sm outline-none placeholder:text-white/25" /></div>
              <div className="mb-5 flex gap-2 overflow-x-auto pb-1">{categories.map(item => <button key={item} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${category === item ? 'border-white bg-white text-black' : 'border-white/10 text-white/45 hover:text-white'}`}>{item}</button>)}</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">                {visibleProviders.map(provider => {
                  const isConnected = connected.includes(provider.id);
                  return <button key={provider.id} onClick={() => connectProvider(provider.id)} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left hover:bg-white/[0.06]">
                    <div className="flex items-start justify-between gap-3"><span><span className="block font-medium">{provider.name}</span><span className="mt-1 block text-xs text-white/35">{provider.category}{provider.host ? ` • via ${provider.host}` : ''}</span></span>{isConnected ? <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={16} /></span> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-white/35"><Plus size={16} /></span>}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{provider.devices.map(device => <span key={device} className="rounded-md bg-white/5 px-1.5 py-1 text-[9px] text-white/35">{device}</span>)}</div>
                    {provider.note && <p className="mt-2 text-[10px] text-cyan-300/60">{provider.note}</p>}
                  </button>;
                })}
              </div>
              {visibleProviders.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">No provider matches that search.</div>}
            </section>
          )}

          {activeTab === 'watchlist' && <section>
            {tvConnectedNotice && <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={16} /></span><div><p className="text-sm font-semibold text-emerald-200">TV connected</p><p className="text-xs text-white/40">Choose a title below to send it to your TV.</p></div></div><button onClick={() => setTvConnectedNotice(false)} className="rounded-full p-1.5 text-white/30 hover:bg-white/5 hover:text-white"><X size={16} /></button></div>}
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-cyan-300">One place</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">My Watchlist</h1><p className="mt-2 text-white/45">No more remembering which app you saved something in.</p></div><button onClick={async () => {
              setImportMessage('');
              const nonce = createImportNonce();
              importNonceRef.current = nonce;
              setImportNonce(nonce);
              const runtime = getChromeRuntimeBridge();
              if (!runtime) {
                setImportMessage('Chrome extension not detected. Install the Stream Command Watchlist Importer extension.');
                return;
              }
              try {
                const result = await runtime.sendMessage(SCC_IMPORT_EXTENSION_ID, {
                  type: 'scc:import-start',
                  nonce,
                });
                if (!result?.ok) {
                  setImportMessage(`Importer could not start: ${result?.reason || 'extension unavailable'}.`);
                  return;
                }
                const scanned = result.scanCount ?? 0;
                if (scanned === 0) {
                  setImportMessage('No supported provider tabs were found. Keep a supported streaming service open and try again.');
                }
              } catch {
                setImportMessage('Importer connection failed. The extension is not available to this browser page.');
              }
            }} className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/15">Import watchlists</button></div>{importNonce && <div className="mb-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100/80">Import session active. Scanning your open signed-in streaming services.</div>}{importMessage && <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{importMessage}</div>}<TitleGrid titles={watchlist} onWatch={sendToTv} onWhereToWatch={openWhereToWatch} />
          </section>}
        </main>

        <footer className="mt-12 border-t border-white/10 pt-5 text-xs text-white/25">Working prototype • Provider-agnostic architecture • Catalog metadata only for now</footer>
      </div>
      {showAccount && <Modal title={accountMode === 'signed-in' ? 'Your Stream Command account' : 'Save your streaming setup'} onClose={() => { setShowAccount(false); setAccountMessage(''); }}>
        {accountMode === 'signed-in' ? <>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-emerald-300/70">Signed in</p><p className="mt-1 font-medium">{accountEmail}</p><p className="mt-2 text-sm leading-6 text-white/45">Your services and watchlist sync to your account. The app can keep you signed in on this device.</p></div>
          {trialEndsAt && <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4"><p className="text-xs uppercase tracking-[0.18em] text-cyan-300/70">Premium trial</p><p className="mt-1 font-medium">72 hours</p><p className="mt-2 text-xs text-white/40">Trial window ends {new Date(trialEndsAt).toLocaleString()}.</p></div>}
          <p className="mt-4 text-xs text-white/30">Subscription billing is not enabled yet. This account layer is preparing the trial → subscription flow.</p>
        </> : <>
          <p className="mb-4 text-sm leading-6 text-white/45">Create an account once and keep your services and watchlist with you. If you are currently using anonymous mode, we upgrade that same Firebase identity so the TV pairing foundation stays intact.</p>
          <div className="space-y-3">
            <input value={accountForm.email} onChange={event => setAccountForm(current => ({ ...current, email: event.target.value }))} type="email" placeholder="Email address" className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm outline-none placeholder:text-white/25" />
            <input value={accountForm.password} onChange={event => setAccountForm(current => ({ ...current, password: event.target.value }))} type="password" placeholder="Password (6+ characters)" className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm outline-none placeholder:text-white/25" />
            <button disabled={accountBusy} onClick={submitAccount} className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-black disabled:opacity-50">{accountBusy ? 'Working...' : 'Create account / Sign in'}</button>          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-white/35">New accounts receive the planned 72-hour premium trial window. Payment collection will be added after the core product flow is validated.</div>
          {accountMessage && <p className="mt-4 text-sm text-cyan-200">{accountMessage}</p>}
        </>}
      </Modal>}

      {showConnect && <Modal title="Connect your services" onClose={() => { setShowConnect(false); setConnectionMessage(''); }}><p className="mb-4 text-sm text-white/45">Choose a service to start its supported connection flow. Provider account authentication is being wired through individual adapters.</p>{connectionMessage && <div className="mb-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs leading-5 text-cyan-100/80">{connectionMessage}</div>}<div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">{providers.map(provider => { const active = connected.includes(provider.id); return <button key={provider.id} onClick={() => connectProvider(provider.id)} className={`flex items-center justify-between rounded-xl border p-3 text-sm ${active ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]'}`}><span>{provider.name}</span>{active ? <Check size={16} className="text-emerald-300" /> : <Plus size={16} className="text-white/35" />}</button>; })}</div></Modal>}

      {showWhereToWatch && selectedTitle && <Modal title={`Where to watch “${selectedTitle.title}”`} onClose={() => { setShowWhereToWatch(false); setAvailability(null); }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-white/45">{availability?.source === 'watchmode' ? 'Live U.S. availability' : 'Development fallback availability'}</p>
          {availability && <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/35">{availability.source}</span>}
        </div>
        {availabilityLoading ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">Checking current availability…</div> : availability && availability.availability.length > 0 ? <div className="space-y-2">
          {availability.availability.map((item, index) => {
            const provider = providers.find(entry => entry.name === item.providerName);
            const connectedHere = provider ? connected.includes(provider.id) : false;
            const availabilityLabel = item.type === 'free' ? 'Free' : item.type === 'rent' ? 'Rent' : item.type === 'buy' ? 'Buy' : item.type === 'tve' ? 'TV provider login' : 'Subscription';
            return <div key={`${item.providerName}-${item.type}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div><p className="font-medium">{item.providerName}</p><p className="text-xs text-white/35">{connectedHere ? 'Added to your services' : availabilityLabel}{item.format ? ` • ${item.format}` : ''}{item.price != null ? ` • $${item.price.toFixed(2)}` : ''}</p></div>
              <button onClick={() => { if (item.webUrl) { window.open(item.webUrl, '_blank', 'noopener,noreferrer'); setShowWhereToWatch(false); } }} disabled={!item.webUrl} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">Watch</button>
            </div>;
          })}
        </div> : <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/45">No current availability was returned for this title.</div>}
      </Modal>}

      {receiverMode && showTv && <div className="fixed inset-0 z-50 h-screen max-h-screen overflow-hidden bg-[#05060a] text-white">
        <div className="flex h-full min-h-0 flex-col px-6 py-4 sm:px-10 sm:py-5">
          <div className="flex items-center justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Stream Command • TV Receiver</p><p className="mt-1 text-sm text-white/35">Phone-to-TV command channel</p></div>
            <button onClick={() => { setReceiverMode(false); setShowTv(false); }} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5">Exit receiver</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden py-2">
            <div className="max-h-full w-full max-w-5xl overflow-y-auto overscroll-contain">              {pairingStatus === 'waiting' && <div className="flex w-full flex-col items-center justify-start pt-2 text-center">
                <div className="rounded-[1.5rem] border border-white/10 bg-white p-4 shadow-2xl">
                  <QRCodeSVG value={`${window.location.origin}/?pair=${pairingCode}&platform=${encodeURIComponent(tvPlatform)}`} size={270} bgColor="#ffffff" fgColor="#000000" includeMargin />
                </div>
                <div className="mt-3 inline-flex flex-col items-center rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-5 py-2">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/60">Pairing code</span>
                  <span className="mt-0.5 font-mono text-3xl font-semibold tracking-[0.24em] text-cyan-200">{pairingCode}</span>
                </div>
                <p className="mt-4 text-lg font-medium tracking-tight text-white/85">Scan to connect your phone</p>
                <p className="mt-1 text-sm text-white/35">Then choose what to watch from your phone.</p>
              </div>}
              {pairingStatus === 'paired' && <div className="text-center">
                <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-4 py-2 text-sm text-emerald-300"><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /> Phone connected</div>
                {pairingSession?.command ? <>
                  <p className="mt-10 text-xs uppercase tracking-[0.24em] text-cyan-300/70">Now playing request</p>
                  <h1 className="mt-3 text-6xl font-semibold tracking-[-0.05em] sm:text-8xl">{pairingSession.command.title}</h1>
                  <p className="mt-4 text-xl text-white/45">{pairingSession.command.provider}</p>
                  <div className="mx-auto mt-8 max-w-2xl rounded-3xl border border-white/10 bg-white/[0.035] p-6 text-left">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/30">Route status</p>
                    <p className="mt-2 text-lg font-medium">{pairingSession.command.routeStatus === 'licensed-link-needed' ? 'Native TV route ready for a licensed title link.' : pairingSession.command.routeStatus === 'adapter-ready' ? 'Native TV adapter is ready for integration.' : 'Browser receiver fallback is ready.'}</p>
                    <p className="mt-2 text-sm leading-6 text-white/40">{pairingSession.command.platform === 'fire-tv' || pairingSession.command.platform === 'samsung' ? 'Native app handoff is handled on the paired TV so its existing app session is preserved.' : pairingSession.command.routeStatus === 'receiver-fallback' ? 'This receiver can open the provider web experience. Native third-party TV app launching will be enabled through the platform adapter layer.' : 'The command is live and correctly routed without pretending a native app launch is available before the provider/platform integration is connected.'}</p>
                    {pairingSession.command.launchUri && pairingSession.command.platform !== 'fire-tv' && pairingSession.command.platform !== 'samsung' && <button onClick={() => launchNativeTvUrl(pairingSession.command.launchUri!)} className="mt-5 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">Open on This TV</button>}
                  </div>
                </> : <><h1 className="mt-10 text-5xl font-semibold tracking-[-0.04em] sm:text-7xl">Ready when you are.</h1><p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-white/45">Your phone is connected. Choose a title on the phone and tap Watch on TV.</p></>}
              </div>}
            </div>
          </div>
          <div className="shrink-0 py-1 text-center text-xs text-white/20">Live Firestore receiver • {tvPlatforms.find(item => item.id === (pairingSession?.platform || tvPlatform))?.name || 'TV'} • Waiting for phone commands</div>
        </div>
      </div>}
      {showTv && !receiverMode && <Modal title={pairingStatus === 'paired' ? 'TV connected' : pairingStatus === 'phone-ready' ? 'Connect this TV' : 'Connect a TV'} onClose={() => setShowTv(false)}>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center">
          {pairingStatus === 'idle' ? <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-cyan-400/10 text-cyan-200"><MonitorPlay size={30} /></div>
            <p className="mt-5 font-semibold">What kind of connection are you starting?</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={async () => { setReceiverMode(true); await startTvPairing(selectedTitle, tvPlatform); }} className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-4 text-left hover:bg-cyan-300/15"><p className="font-medium">This screen is the TV</p><p className="mt-1 text-xs leading-5 text-white/45">Turn this screen into the live receiver and show a QR code.</p></button>
              <button onClick={() => setReceiverMode(false)} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"><p className="font-medium">I’m on my phone</p><p className="mt-1 text-xs leading-5 text-white/45">Pair another TV from this device.</p></button>
            </div>
            <p className="mt-5 text-sm leading-6 text-white/45">Google TV and Fire TV are our first direct-routing targets. Other platforms are prepared for native adapters.</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {tvPlatforms.map(platform => <button key={platform.id} onClick={() => { if (receiverMode) { setTvPlatform(platform.id); startTvPairing(selectedTitle, platform.id).then(() => setShowTv(true)); } else { startTvPairing(selectedTitle, platform.id); } }} className={`rounded-2xl border p-4 text-left transition ${tvPlatform === platform.id ? 'border-cyan-300/40 bg-cyan-300/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                <p className="font-medium">{platform.name}</p><p className="mt-1 text-xs text-white/35">{platform.phase} • {platform.routeType === 'deep-link' ? 'Deep-link ready' : platform.routeType === 'native-app' ? 'Native adapter planned' : 'Web fallback'}</p>
              </button>)}
            </div>
          </> : pairingStatus === 'phone-ready' ? <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-cyan-400/10 text-cyan-200"><QrCode size={30} /></div>
            <p className="mt-5 font-semibold">Pair with {pairingSession?.tvName || 'Living Room TV'}?</p>
            <p className="mt-2 text-sm leading-6 text-white/45">This device found a live TV pairing session. Confirm once to connect it.</p>
            {pairingSession?.title && <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left"><p className="text-xs uppercase tracking-[0.18em] text-white/35">TV is waiting for</p><p className="mt-1 font-semibold">{pairingSession.title}</p><p className="text-xs text-white/35">{pairingSession.provider}</p></div>}
            <button onClick={confirmPhonePairing} className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">Pair this TV</button>
            {pairingError && <p className="mt-3 text-sm text-rose-200">{pairingError}</p>}
          </> : pairingStatus === 'waiting' ? <>
            <div className="mx-auto rounded-2xl border border-white/15 bg-white/[0.04] p-3"><QRCodeSVG value={`${window.location.origin}${window.location.pathname}?pair=${pairingCode}&platform=${encodeURIComponent(tvPlatform)}`} size={170} bgColor="transparent" fgColor="#ffffff" includeMargin /></div>
            <p className="mt-5 font-semibold">Scan to connect your phone</p>
            <p className="mt-2 text-sm leading-6 text-white/45">Open the camera on your phone and scan this code. The TV session will update automatically when the phone confirms.</p>
            <div className="mx-auto mt-5 inline-flex items-center rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-5 py-3 font-mono text-2xl font-semibold tracking-[0.3em] text-cyan-200">{pairingCode}</div>
            <p className="mt-2 text-[11px] text-white/30">Live Firestore pairing session</p>
            <button onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}?pair=${pairingCode}&platform=${encodeURIComponent(tvPlatform)}`)} className="mt-5 rounded-full border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5">Copy pairing link</button>
          </> : <>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={30} /></div>            <p className="mt-5 font-semibold">Living Room TV is paired</p>
            <p className="mt-2 text-sm leading-6 text-white/45">This device is now connected to the live TV session.</p>
            {pairingSession?.command && <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-left"><p className="text-xs uppercase tracking-[0.18em] text-emerald-300/70">TV command received</p><p className="mt-1 font-semibold">{pairingSession.command.title}</p><p className="text-xs text-white/35">Route: {pairingSession.command.provider} • {tvPlatforms.find(item => item.id === pairingSession.command.platform)?.name || pairingSession.command.platform}</p><p className="mt-2 text-xs text-white/45">{pairingSession.command.routeStatus === 'licensed-link-needed' ? 'Native TV deep-link route is waiting for the provider’s licensed title link.' : pairingSession.command.routeStatus === 'adapter-ready' ? 'Platform adapter is ready for native TV integration.' : 'Receiver fallback is ready.'}</p>{pairingSession.command.launchUri && <p className="mt-3 text-xs text-emerald-200/70">Sent to the paired TV. Keep the TV receiver open to launch it there.</p>}</div>}
            {selectedTitle && <button onClick={sendTitleToPairedTv} className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">Send “{selectedTitle.title}” to TV</button>}
            <button onClick={() => setShowTv(false)} className="mt-3 rounded-full border border-white/10 px-5 py-2.5 text-sm font-semibold text-white/70">Done</button>
          </>}
        </div>
      </Modal>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex items-end justify-between border-b border-white/10 pb-3"><span className="text-sm text-white/40">{label}</span><span className="text-2xl font-semibold">{value}</span></div>;
}

function TitleGrid({ titles, onWatch, onWhereToWatch }: { titles: SavedTitle[]; onWatch: (title: SavedTitle) => void; onWhereToWatch: (title: SavedTitle) => void }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{titles.map(title => <article key={title.id} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]"><div className={`flex h-40 items-end bg-gradient-to-br ${title.accent} p-5`}><div><span className="text-xs uppercase tracking-[0.18em] text-white/45">{title.type}</span><h3 className="mt-1 text-2xl font-semibold">{title.title}</h3></div></div><div className="flex items-center justify-between p-4"><div><p className="text-sm">{title.provider}</p><p className="text-xs text-white/35">Saved to your list</p></div><div className="flex gap-2"><button onClick={() => onWhereToWatch(title)} className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 hover:bg-white/5">Where to watch</button><button onClick={() => onWatch(title)} className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-black">Watch on TV</button></div></div></article>)}</div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#111219] p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="rounded-full p-2 text-white/45 hover:bg-white/5 hover:text-white"><X size={18} /></button></div>{children}</div></div>;
}

export default App;
