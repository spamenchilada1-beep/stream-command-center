export type ImportedWatchlistItem = {
  title: string;
  type?: 'Movie' | 'Series';
  provider: string;
  id?: string;
};

export type WatchlistImportMessage = {
  source: 'stream-command-extension';
  type: 'scc:watchlist-import';
  nonce: string;
  items: ImportedWatchlistItem[];
};

export type NormalizedImportedTitle = {
  id: string;
  title: string;
  type: 'Movie' | 'Series';
  provider: string;
  accent: string;
};

const DEFAULT_ACCENT = 'from-cyan-500/30 to-indigo-950';
const MAX_ITEMS_PER_IMPORT = 500;
const MIN_NONCE_LENGTH = 16;

function stableId(title: string, provider: string): string {
  return `imported-${provider}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isWatchlistImportMessage(value: unknown): value is WatchlistImportMessage {
  if (!value || typeof value !== 'object') return false;

  const message = value as Partial<WatchlistImportMessage>;
  if (message.source !== 'stream-command-extension') return false;
  if (message.type !== 'scc:watchlist-import') return false;
  if (typeof message.nonce !== 'string' || message.nonce.length < MIN_NONCE_LENGTH) return false;
  if (!Array.isArray(message.items) || message.items.length > MAX_ITEMS_PER_IMPORT) return false;

  return message.items.every(item =>
    !!item &&
    typeof item === 'object' &&
    typeof item.title === 'string' &&
    cleanText(item.title).length > 0 &&
    cleanText(item.title).length <= 300 &&
    typeof item.provider === 'string' &&
    cleanText(item.provider).length > 0 &&
    cleanText(item.provider).length <= 120 &&
    (item.type === undefined || item.type === 'Movie' || item.type === 'Series') &&
    (item.id === undefined || (typeof item.id === 'string' && cleanText(item.id).length <= 300))
  );
}

export function normalizeImportedItems(items: ImportedWatchlistItem[]): NormalizedImportedTitle[] {
  const seen = new Set<string>();

  return items
    .map(item => {
      const title = cleanText(item.title);
      const provider = cleanText(item.provider);
      const id = cleanText(item.id || '') || stableId(title, provider);

      return {
        id,
        title,
        type: item.type || 'Series',
        provider,
        accent: DEFAULT_ACCENT,
      };
    })
    .filter(item => {
      const key = item.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function mergeImportedWatchlist(
  existing: NormalizedImportedTitle[],
  imported: NormalizedImportedTitle[],
): NormalizedImportedTitle[] {
  const merged = [...existing];
  const seen = new Set(existing.map(item => item.id.toLowerCase()));

  for (const item of imported) {
    const key = item.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

export function createImportNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
