function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const query = String(req.query?.query || '').trim();
  const region = String(req.query?.region || 'US').toUpperCase();
  if (query.length < 2) return json(res, 400, { error: 'query_too_short' });
  if (query.length > 120) return json(res, 400, { error: 'query_too_long' });

  const apiKey = process.env.MOTN_API_KEY;
  if (!apiKey) return json(res, 503, { error: 'catalog_source_not_configured' });

  try {
    const url = new URL('https://api.movieofthenight.com/v4/shows/search/title');
    url.searchParams.set('title', query);
    url.searchParams.set('country', region.toLowerCase());

    const response = await fetch(url, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    if (!response.ok) return json(res, 502, { error: 'catalog_provider_unavailable' });

    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
    const seen = new Set();
    const results = items
      .filter(item => item && item.id != null && typeof (item.title || item.name) === 'string')
      .map(item => {
        const title = String(item.title || item.name).trim();
        const typeText = String(item.showType || item.type || '').toLowerCase();
        const yearValue = item.firstAirYear ?? item.year ?? null;
        const year = Number.isFinite(Number(yearValue)) && yearValue != null ? Number(yearValue) : null;
        return {
          id: String(item.id),
          title,
          type: typeText.includes('movie') ? 'Movie' : 'Series',
          year,
          imdbId: typeof item.imdbId === 'string' ? item.imdbId : null,
          tmdbId: item.tmdbId == null ? null : String(item.tmdbId),
        };
      })
      .filter(item => {
        const key = item.id + '|' + item.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 15);

    return json(res, 200, { query, region, results });
  } catch {
    return json(res, 502, { error: 'catalog_request_failed' });
  }
}
