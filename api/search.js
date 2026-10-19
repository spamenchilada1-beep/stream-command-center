function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

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
    const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
    const seen = new Set();
    const queryKey = normalizeTitle(query);
    const results = rawItems
      .filter(item => item && item.id != null && typeof (item.title || item.name) === 'string')
      .map(item => {
        const title = String(item.title || item.name).trim();
        const showType = String(item.showType || item.type || '').toLowerCase();
        const yearValue = item.firstAirYear ?? item.year ?? null;
        const year = Number.isFinite(Number(yearValue)) && yearValue != null ? Number(yearValue) : null;
        return {
          id: String(item.id),
          title,
          type: /movie|film/.test(showType) ? 'Movie' : 'Series',
          year,
          imdbId: typeof item.imdbId === 'string' ? item.imdbId : null,
          tmdbId: item.tmdbId == null ? null : String(item.tmdbId),
          _rank: normalizeTitle(title) === queryKey ? 0 : normalizeTitle(title).startsWith(queryKey) ? 1 : 2,
        };
      })
      .filter(item => {
        if (!item.id || !item.title) return false;
        const key = item.id + '|' + normalizeTitle(item.title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a._rank - b._rank || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title))
      .slice(0, 15)
      .map(({ _rank, ...item }) => item);

    return json(res, 200, { query, region, results });
  } catch {
    return json(res, 502, { error: 'catalog_request_failed' });
  }
}
