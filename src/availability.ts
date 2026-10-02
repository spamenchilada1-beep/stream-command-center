export type AvailabilityItem = {
  providerId: number;
  providerName: string;
  type: 'sub' | 'rent' | 'buy' | 'free' | 'tve';
  region: string;
  webUrl: string | null;
  iosUrl: string | null;
  androidUrl: string | null;
  tvosUrl: string | null;
  androidTvUrl: string | null;
  rokuUrl: string | null;
  price: number | null;
  format: string | null;
};

export type AvailabilityResult = {
  source: 'motn' | 'watchmode' | 'demo';
  region: string;
  title: {
    id: number | string;
    name: string;
    type: string;
    year: number | null;
    imdbId: string | null;
    tmdbId: number | null;
  };
  availability: AvailabilityItem[];
};

const demo: Record<string, AvailabilityItem[]> = {
  yellowstone: [
    { providerId: 0, providerName: 'Paramount+', type: 'sub', region: 'US', webUrl: 'https://www.paramountplus.com/', iosUrl: null, androidUrl: null, tvosUrl: null, androidTvUrl: null, rokuUrl: null, price: null, format: null },
    { providerId: 0, providerName: 'Prime Video', type: 'sub', region: 'US', webUrl: 'https://www.primevideo.com/', iosUrl: null, androidUrl: null, tvosUrl: null, androidTvUrl: null, rokuUrl: null, price: null, format: null },
  ],
  bear: [
    { providerId: 0, providerName: 'Hulu', type: 'sub', region: 'US', webUrl: 'https://www.hulu.com/', iosUrl: null, androidUrl: null, tvosUrl: null, androidTvUrl: null, rokuUrl: null, price: null, format: null },
  ],
  fallout: [
    { providerId: 0, providerName: 'Prime Video', type: 'sub', region: 'US', webUrl: 'https://www.primevideo.com/', iosUrl: null, androidUrl: null, tvosUrl: null, androidTvUrl: null, rokuUrl: null, price: null, format: null },
  ],
};

export async function getAvailability(title: string): Promise<AvailabilityResult> {
  try {
    const response = await fetch(`/api/availability?title=${encodeURIComponent(title)}&region=US`);
    if (response.ok) return await response.json() as AvailabilityResult;
  } catch {
    // Fall through to the development-safe local fallback.
  }

  return {
    source: 'demo',
    region: 'US',
    title: { id: title, name: title, type: 'unknown', year: null, imdbId: null, tmdbId: null },
    availability: demo[title.toLowerCase()] || [],
  };
}
