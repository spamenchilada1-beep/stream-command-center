import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/availability.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_MOTN_KEY = process.env.MOTN_API_KEY;
const ORIGINAL_WATCHMODE_KEY = process.env.WATCHMODE_API_KEY;

const selectedSeries = {
  id: '330',
  title: 'Yellowstone',
  showType: 'series',
  firstAirYear: 2018,
  imdbId: 'tt4236770',
  tmdbId: 'tv/73586',
};

const primaryOptions = [
  {
    service: { id: 'prime', name: 'Prime Video' },
    type: 'buy',
    link: 'https://example.test/prime',
  },
  {
    service: { id: 'peacock', name: 'Peacock' },
    type: 'subscription',
    link: 'https://example.test/peacock',
  },
];

function mockUpstream({
  record = selectedSeries,
  watchmodeSearchStatus = 503,
  watchmodeResults = [],
  watchmodeSources = [],
} = {}) {
  let selectedShowCalls = 0;

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.hostname === 'api.movieofthenight.com' && url.pathname === '/v4/shows/330') {
      selectedShowCalls += 1;
      const payload = selectedShowCalls === 1
        ? record
        : { ...record, streamingOptions: { us: primaryOptions } };
      return { ok: true, status: 200, json: async () => payload };
    }

    if (url.hostname === 'api.watchmode.com' && url.pathname === '/v1/search/') {
      return {
        ok: watchmodeSearchStatus >= 200 && watchmodeSearchStatus < 300,
        status: watchmodeSearchStatus,
        json: async () => ({ title_results: watchmodeResults }),
      };
    }

    if (url.hostname === 'api.watchmode.com' && url.pathname.endsWith('/sources/')) {
      return { ok: true, status: 200, json: async () => watchmodeSources };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function requestAvailability() {
  const req = {
    method: 'GET',
    query: {
      title: 'Yellowstone',
      region: 'US',
      catalogId: '330',
      type: 'Series',
      year: '2018',
      imdbId: 'tt4236770',
      tmdbId: 'tv/73586',
    },
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };

  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('keeps primary provider options when optional Watchmode lookup fails', async () => {
  process.env.MOTN_API_KEY = 'test-motn-key';
  process.env.WATCHMODE_API_KEY = 'test-watchmode-key';
  mockUpstream({ watchmodeSearchStatus: 503 });

  const result = await requestAvailability();

  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'motn');
  assert.deepEqual(
    result.body.availability.map((item) => item.providerName),
    ['Prime Video', 'Peacock'],
  );
});

test('does not let Watchmode add or replace providers; it only enriches matching links', async () => {
  process.env.MOTN_API_KEY = 'test-motn-key';
  process.env.WATCHMODE_API_KEY = 'test-watchmode-key';
  mockUpstream({
    watchmodeSearchStatus: 200,
    watchmodeResults: [{
      id: 77,
      name: 'Yellowstone',
      type: 'tv',
      year: 2018,
      imdb_id: 'tt4236770',
      tmdb_id: 'tv/73586',
    }],
    watchmodeSources: [{
      name: 'Paramount+',
      ios_url: 'https://example.test/native',
    }],
  });

  const result = await requestAvailability();

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.availability.map((item) => item.providerName),
    ['Prime Video', 'Peacock'],
  );
  assert.equal(
    result.body.availability.some((item) => item.providerName === 'Paramount+'),
    false,
  );
});

test('rejects selected catalog metadata with a conflicting type or year', async (t) => {
  process.env.MOTN_API_KEY = 'test-motn-key';
  process.env.WATCHMODE_API_KEY = 'test-watchmode-key';

  for (const mismatch of [
    { showType: 'movie', firstAirYear: 2018 },
    { showType: 'series', firstAirYear: 2024 },
  ]) {
    await t.test(JSON.stringify(mismatch), async () => {
      mockUpstream({
        record: { ...selectedSeries, ...mismatch },
        watchmodeSearchStatus: 200,
        watchmodeResults: [],
      });

      const result = await requestAvailability();
      assert.equal(result.status, 404);
      assert.equal(result.body.error, 'title_not_found');
    });
  }
});

test('rejects a same-name catalog result with a contradictory IMDb identity', async () => {
  process.env.MOTN_API_KEY = 'test-motn-key';
  process.env.WATCHMODE_API_KEY = 'test-watchmode-key';
  mockUpstream({
    record: { ...selectedSeries, imdbId: 'tt9999999' },
    watchmodeSearchStatus: 200,
    watchmodeResults: [],
  });

  const result = await requestAvailability();

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'title_not_found');
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;

  if (ORIGINAL_MOTN_KEY === undefined) delete process.env.MOTN_API_KEY;
  else process.env.MOTN_API_KEY = ORIGINAL_MOTN_KEY;

  if (ORIGINAL_WATCHMODE_KEY === undefined) delete process.env.WATCHMODE_API_KEY;
  else process.env.WATCHMODE_API_KEY = ORIGINAL_WATCHMODE_KEY;
});
