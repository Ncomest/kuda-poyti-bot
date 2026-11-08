import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, Places } from '../src/services/places.js';
import { Nominatim, mapPlaces } from '../src/providers/nominatim.js';
import { RateLimit } from '../src/utils/rate-limit.js';
import { Cache } from '../src/utils/cache.js';
import { readConfig } from '../src/config.js';
const fixture = { name: 'Эрмитаж', display_name: 'Эрмитаж, Санкт-Петербург, Россия', lat: '59.94', lon: '30.31', osm_type: 'way', osm_id: 1, address: { country_code: 'ru' }, type: 'museum' };
test('explicit completion and validation', () => {
  assert.equal(parseQuery(' Эрмитаж   Санкт-Петербург ! '), 'Эрмитаж Санкт-Петербург');
  for (const query of ['', '!', 'a!', 'кафе', 'кафе ! Москва', 'кафе!!', 'x'.repeat(201) + '!', 'кафе\u0000!']) assert.equal(parseQuery(query), null);
});
test('mapping, country validation, missing fields, coordinates and duplicates', () => {
  const places = mapPlaces([fixture, fixture, { ...fixture, address: { country_code: 'us' } }, { ...fixture, lat: 'oops' }, { ...fixture, lon: '181' }, { ...fixture, name: '', display_name: '' }]);
  assert.equal(places.length, 1);
  assert.equal(places[0]?.title, 'Эрмитаж');
  assert.equal(places[0]?.latitude, 59.94);
  assert.equal(places[0]?.type, 'museum');
  assert.ok(Buffer.byteLength(places[0]!.id) <= 64);
  assert.equal(mapPlaces([{ ...fixture, name: undefined, address: undefined }])[0]?.title, fixture.display_name);
  assert.deepEqual(mapPlaces([]), []);
  assert.deepEqual(mapPlaces(null), []);
  assert.equal(mapPlaces(Array.from({ length: 20 }, (_, i) => ({ ...fixture, osm_id: i }))).length, 10);
});
test('HTTP request is Russia-only, Russian, identified and bounded', async () => {
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('countrycodes'), 'ru');
    assert.equal(url.searchParams.get('accept-language'), 'ru');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('q'), 'Эрмитаж');
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /KudaPoytiBot.*contact@example.org/);
    assert.ok(init?.signal);
    return Response.json([fixture]);
  };
  assert.equal((await new Nominatim('https://example.org', 'contact@example.org', http).search('Эрмитаж')).length, 1);
});
test('rate limit admits at most one per second, no backlog', async () => {
  let time = 0, calls = 0;
  const limiter = new RateLimit(() => time);
  const provider = new Nominatim('https://example.org', 'contact@example.org', async () => { calls++; return Response.json([]); }, limiter);
  await provider.search('one');
  await assert.rejects(provider.search('two'));
  time = 999;
  await assert.rejects(provider.search('three'));
  time = 1000;
  await provider.search('four');
  assert.equal(calls, 2);
});
test('single active request and deduplication/cache including empty results', async () => {
  let resolve!: (response: Response) => void, calls = 0;
  const provider = new Nominatim('https://example.org', 'contact@example.org', () => { calls++; return new Promise(r => { resolve = r; }); });
  const service = new Places(provider);
  const first = service.search('Кафе');
  const second = service.search('кафе');
  assert.equal(first, second);
  await assert.rejects(service.search('other'));
  resolve(Response.json([]));
  assert.deepEqual(await first, []);
  assert.deepEqual(await service.search('Кафе'), []);
  assert.equal(calls, 1);
});
test('429 respects Retry-After, failures are not cached or retried', async () => {
  let time = 0, calls = 0;
  const provider = new Nominatim('https://example.org', 'contact@example.org', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '60' } }); }, new RateLimit(() => time));
  await assert.rejects(provider.search('a'));
  time = 1000;
  await assert.rejects(provider.search('a'));
  assert.equal(calls, 1);
  time = 60_000;
  await assert.rejects(provider.search('a'));
  assert.equal(calls, 2);
});
test('5xx, network, timeout and invalid JSON fail safely', async () => {
  for (const http of [async () => new Response('', { status: 503 }), async () => { throw new TypeError('network'); }, async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => new Response('bad-json')]) {
    await assert.rejects(new Nominatim('https://example.org', 'contact@example.org', http).search('a'));
  }
});
test('bounded cache expires and evicts', () => {
  let time = 0;
  const cache = new Cache<number>(1, 100, () => time);
  cache.set('a', 1); cache.set('b', 2);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  time = 100;
  assert.equal(cache.get('b'), undefined);
});
test('configuration rejects missing secrets', () => {
  assert.throws(() => readConfig({}), /BOT_TOKEN/);
  assert.throws(() => readConfig({ BOT_TOKEN: 'test' }), /EMAIL/);
  assert.equal(readConfig({ BOT_TOKEN: 'test', NOMINATIM_CONTACT_EMAIL: 'contact@example.org' }).level, 'info');
});
test('OSM identity remains stable when names change', () => {
  assert.equal(mapPlaces([fixture])[0]?.id, mapPlaces([{ ...fixture, name: 'Новое название' }])[0]?.id);
  assert.deepEqual(mapPlaces([{ ...fixture, osm_id: undefined }]), []);
});
