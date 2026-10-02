function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.WATCHMODE_API_KEY;
  const motnKey = process.env.MOTN_API_KEY;
  if (!apiKey && !motnKey) return json(res, 503, { error: 'availability_source_not_configured' });

  const title = String(req.query?.title || '').trim();
  const region = String(req.query?.region || 'US').toUpperCase();
  if (!title) return json(res, 400, { error: 'title_required' });

  try {
    const motnKey = process.env.MOTN_API_KEY;
    if (motnKey) {
      const motnSearchUrl = new URL('https://api.movieofthenight.com/v4/shows/search/title');
      motnSearchUrl.searchParams.set('title', title);
      motnSearchUrl.searchParams.set('country', region.toLowerCase());
      const motnSearchResponse = await fetch(motnSearchUrl, {
        headers: { 'X-API-Key': motnKey, Accept: 'application/json' },
      });
      if (motnSearchResponse.ok) {
        const motnSearchData = await motnSearchResponse.json();
        const motnResults = Array.isArray(motnSearchData) ? motnSearchData : [];
        const exact = motnResults.find(item => String(item.title).toLowerCase() === title.toLowerCase()) || motnResults[0];
        if (exact?.id) {
          const motnShowUrl = new URL('https://api.movieofthenight.com/v4/shows/' + exact.id);
          motnShowUrl.searchParams.set('country', region.toLowerCase());
          const motnShowResponse = await fetch(motnShowUrl, {
            headers: { 'X-API-Key': motnKey, Accept: 'application/json' },
          });
          if (motnShowResponse.ok) {
            const motnShow = await motnShowResponse.json();
            const options = Array.isArray(motnShow?.streamingOptions?.[region.toLowerCase()])
              ? motnShow.streamingOptions[region.toLowerCase()]
              : [];
            const availability = options.map(source => ({
              providerId: source.service?.id || source.service?.name || 'motn',
              providerName: source.service?.name || 'Unknown service',
              type: source.type === 'subscription' ? 'sub' : source.type === 'free' ? 'free' : source.type === 'rent' ? 'rent' : source.type === 'buy' ? 'buy' : 'tve',
              region,
              webUrl: source.link || null,
              iosUrl: null,
              androidUrl: null,
              tvosUrl: null,
              androidTvUrl: null,
              rokuUrl: null,
              price: source.price?.amount ? Number(source.price.amount) : null,
              format: source.quality || null,
            }));
            if (availability.length) {
              return json(res, 200, {
                source: 'motn',
                region,
                title: {
                  id: exact.id,
                  name: exact.title,
                  type: exact.showType || 'series',
                  year: exact.firstAirYear || null,
                  imdbId: exact.imdbId || null,
                  tmdbId: exact.tmdbId || null,
                },
                availability,
              });
            }
          }
        }
      }
    }

    const searchUrl = new URL('https://api.watchmode.com/v1/search/');
    searchUrl.searchParams.set('search_field', 'name');
    searchUrl.searchParams.set('search_value', title);
    searchUrl.searchParams.set('types', 'tv,movie');

    const searchResponse = await fetch(searchUrl, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    if (!searchResponse.ok) {
      return json(res, searchResponse.status, { error: 'watchmode_search_failed' });
    }

    const searchData = await searchResponse.json();
    const results = Array.isArray(searchData.title_results) ? searchData.title_results : [];
    const exact = results.find(item => String(item.name).toLowerCase() === title.toLowerCase()) || results[0];

    if (!exact?.id) return json(res, 404, { error: 'title_not_found', title });

    const sourcesUrl = new URL(`https://api.watchmode.com/v1/title/${exact.id}/sources/`);
    sourcesUrl.searchParams.set('regions', region);

    const sourcesResponse = await fetch(sourcesUrl, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    if (!sourcesResponse.ok) {
      return json(res, sourcesResponse.status, { error: 'watchmode_sources_failed' });
    }

    const sources = await sourcesResponse.json();
    const availability = Array.isArray(sources) ? sources.map(source => ({
      providerId: source.source_id,
      providerName: source.name,
      type: source.type,
      region: source.region,
      webUrl: source.web_url || null,
      iosUrl: source.ios_url || null,
      androidUrl: source.android_url || null,
      tvosUrl: source.tvos_url || null,
      androidTvUrl: source.android_tv_url || null,
      rokuUrl: source.roku_url || null,
      price: source.price ?? null,
      format: source.format || null,
    })) : [];

    return json(res, 200, {
      source: 'watchmode',
      region,
      title: {
        id: exact.id,
        name: exact.name,
        type: exact.type,
        year: exact.year || null,
        imdbId: exact.imdb_id || null,
        tmdbId: exact.tmdb_id || null,
      },
      availability,
    });
  } catch {
    return json(res, 500, { error: 'availability_request_failed' });
  }
}
