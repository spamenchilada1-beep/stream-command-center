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
  source: 'motn' | 'watchmode' | 'unavailable';
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
  error?: string;
};

function unavailable(title: string, error: string): AvailabilityResult {
  return {
    source: 'unavailable',
    region: 'US',
    title: { id: title, name: title, type: 'unknown', year: null, imdbId: null, tmdbId: null },
    availability: [],
    error,
  };
}

export async function getAvailability(title: string): Promise<AvailabilityResult> {
  try {
    const response = await fetch(`/api/availability?title=${encodeURIComponent(title)}&region=US`);

    if (response.ok) {
      const result = await response.json() as Partial<AvailabilityResult>;
      if ((result.source === 'motn' || result.source === 'watchmode') && Array.isArray(result.availability)) {
        return result as AvailabilityResult;
      }
      return unavailable(title, 'invalid_availability_response');
    }

    let error = `availability_http_${response.status}`;
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') error = body.error;
    } catch {
      // Keep the HTTP status as the diagnostic.
    }
    return unavailable(title, error);
  } catch {
    return unavailable(title, 'availability_request_failed');
  }
}
