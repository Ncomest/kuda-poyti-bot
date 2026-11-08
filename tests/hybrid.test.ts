import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../src/services/query-parser.js';
import { CityResolver } from '../src/services/city-resolver.js';
import { Overpass, buildQuery, mapOverpass } from '../src/providers/overpass.js';
import { HybridPlacesProvider } from '../src/providers/hybrid.js';
import { SearchError } from '../src/services/search-error.js';
import { Places } from '../src/services/places.js';
import { Nominatim } from '../src/providers/nominatim.js';
import { Cache } from '../src/utils/cache.js';
import { boundedJson } from '../src/utils/http.js';
const city = { name: 'Воронеж', relationId: 123, region: 'Воронежская область' };
const signal = () => AbortSignal.timeout(1000);
const boundary = { name: city.name, osm_id: city.relationId, osm_type: 'relation', class: 'boundary', type: 'administrative', addresstype: 'city', address: { country_code: 'ru', state: city.region } };
const area = { type: 'area', id: 3_600_000_000 + city.relationId };
const node = { type: 'node', id: 1, lat: 51, lon: 39, tags: { name: 'Кафе', 'name:ru': 'Русское кафе', 'addr:street': 'Ленина', 'addr:housenumber': '1' } };
const data = (...elements: unknown[]) => ({ elements: [area, ...elements] });
const status = (expected: string) => (e: unknown) => e instanceof SearchError && e.status === expected;
test('parser preserves multiword cities, categories and chain names', () => {
  for (const [q, category, cityName] of [['кафе Воронеж', 'cafe', 'Воронеж'], ['ресторан Санкт-Петербург', 'restaurant', 'Санкт-Петербург'], ['рестораны Москва', 'restaurant', 'Москва'], ['супермаркеты Нижний Новгород', 'supermarket', 'Нижний Новгород'], ['продуктовые магазины Великий Новгород', 'grocery', 'Великий Новгород']]) {
    assert.deepEqual(parseSearch(q!), { kind: 'category', category, city: cityName });
  }
  for (const q of ['', 'магазины Воронеж', 'кафе', 'кафе\u0000Воронеж', 'x'.repeat(201)]) assert.equal(parseSearch(q).kind, 'unsupported');
  for (const q of ['Пятёрочка Воронеж', 'Магнит Москва', 'Эрмитаж Санкт-Петербург']) assert.deepEqual(parseSearch(q), { kind: 'place', query: q });
});
test('city validates context, rejects ambiguity/missing boundary, caches only success', async () => {
  let calls = 0;
  const resolver = new CityResolver(async () => { calls++; return [boundary]; });
  assert.deepEqual(await resolver.resolve('Воронеж', signal()), city);
  await resolver.resolve('воронеж', signal());
  assert.equal(calls, 1);
  await assert.rejects(new CityResolver(async () => [boundary, { ...boundary, osm_id: 456 }]).resolve(city.name, signal()), status('AMBIGUOUS_CITY'));
  for (const item of [{ ...boundary, osm_type: 'node' }, { ...boundary, address: { country_code: 'us' } }, { ...boundary, class: 'tourism' }, { ...boundary, name: 'Другое' }]) {
    await assert.rejects(new CityResolver(async () => [item]).resolve(city.name, signal()), status('INVALID_CITY'));
  }
  assert.deepEqual(await resolver.resolve('Воронеж, Воронежская область', signal()), city);
  await assert.rejects(resolver.resolve('Воронеж, Московская область', signal()), status('INVALID_CITY'));
  const failed = new CityResolver(async () => { throw new SearchError('TIMEOUT'); });
  await assert.rejects(failed.resolve(city.name, signal()), status('TIMEOUT'));
});
test('Overpass maps node, way, relation, fallbacks, safe IDs, coordinates and duplicates', () => {
  const result = mapOverpass(data(node, node, { type: 'way', id: 2, center: { lat: 51, lon: 39 }, tags: { brand: 'Бренд', 'addr:full': 'Полный адрес' } }, { type: 'relation', id: 3, center: { lat: 51, lon: 39 } }, { ...node, id: 4, lat: NaN }, { ...node, id: 5, lon: 200 }, { type: 'way', id: 6 }), city, 'cafe');
  assert.equal(result.length, 3);
  assert.equal(result[0]?.title, 'Русское кафе');
  assert.equal(result[0]?.address, 'Воронеж, Ленина, 1');
  assert.ok(result.every(p => Buffer.byteLength(p.id) <= 64));
  assert.equal(result.find(p => p.osmId === 2)?.address, 'Полный адрес');
  assert.equal(result.find(p => p.osmId === 3)?.address, 'Воронеж, адрес не указан');
  assert.equal(mapOverpass(data({ ...node, id: 10 }, { ...node, id: 11 }), city, 'cafe').length, 2);
  assert.throws(() => mapOverpass({ elements: [node] }, city, 'cafe'), status('INVALID_CITY'));
  for (const body of [null, {}, { elements: [] , remark: 'runtime error' }, { elements: null }]) assert.throws(() => mapOverpass(body, city, 'cafe'), SearchError);
});
test('QL uses numeric relation and fixed filters, no city text interpolation', () => {
  const q = buildQuery({ ...city, name: '";out;' }, 'grocery');
  assert.match(q, /rel\(123\)/); assert.match(q, /map_to_area/); assert.match(q, /out center qt 101/);
  assert.ok(!q.includes('";out;'));
  assert.throws(() => buildQuery({ ...city, relationId: NaN }, 'cafe'), SearchError);
});
test('Overpass failure modes, no retry, cooldown and bounded body', async () => {
  for (const code of [429, 500, 502, 503, 504]) {
    let calls = 0;
    const provider = new Overpass('https://example.org', async () => { calls++; return new Response('', { status: code, headers: { 'Retry-After': '60' } }); });
    await assert.rejects(provider.search(city, 'cafe', signal()), status(code === 429 ? 'BUSY' : 'PROVIDER_ERROR'));
    await assert.rejects(provider.search(city, 'cafe', signal()), status('BUSY'));
    assert.equal(calls, 1);
  }
  for (const response of [new Response('bad json'), Response.json({ remark: 'timeout', elements: [] }), Response.json({ wrong: [] })]) {
    await assert.rejects(new Overpass('https://example.org', async () => response).search(city, 'cafe', signal()), status('PROVIDER_ERROR'));
  }
  await assert.rejects(boundedJson(new Response('x'.repeat(100)), 10));
  await assert.rejects(new Overpass('https://example.org', async () => { throw new TypeError('network'); }).search(city, 'cafe', signal()), status('PROVIDER_ERROR'));
});
test('abort interrupts Overpass and the shared deadline also covers city lookup', async () => {
  const http: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); });
  await assert.rejects(new Overpass('https://example.org', http).search(city, 'cafe', AbortSignal.timeout(10)), status('TIMEOUT'));
  let calls = 0;
  const shared = AbortSignal.timeout(10);
  const hybrid = new HybridPlacesProvider({ async search() { return []; } }, {
    cities: new CityResolver(async (_q, s) => { assert.equal(s, shared); await new Promise(r => setTimeout(r, 20)); return [boundary]; }),
    overpass: new Overpass('https://example.org', async () => { calls++; return Response.json(data(node)); }),
  });
  await assert.rejects(hybrid.search('кафе Воронеж', shared), status('TIMEOUT'));
  assert.equal(calls, 0);
});
test('production categories are disabled and never query Nominatim or return mocks', async () => {
  let calls = 0;
  const hybrid = new HybridPlacesProvider({ async search() { calls++; return []; } });
  await assert.rejects(hybrid.search('кафе Воронеж'), status('PROVIDER_ERROR'));
  await assert.rejects(hybrid.search('магазины Воронеж'), status('UNSUPPORTED_CATEGORY'));
  assert.equal(calls, 0);
  await hybrid.search('Пятёрочка Воронеж'); assert.equal(calls, 1);
});
test('mock integration routes once, caches results and paginates without duplicate API requests', async () => {
  let geography = 0, overpass = 0, names = 0;
  const hybrid = new HybridPlacesProvider({ async search() { names++; return []; } }, {
    cities: new CityResolver(async () => { geography++; return [boundary]; }),
    overpass: new Overpass('https://example.org', async () => { overpass++; return Response.json(data(...Array.from({ length: 25 }, (_, i) => ({ ...node, id: i + 1 })))); }),
  });
  const service = new Places(hybrid);
  const a = await service.page('кафе Воронеж'); const b = await service.page('кафе Воронеж', a.next); const c = await service.page('кафе Воронеж', b.next);
  assert.equal(a.results.length, 10); assert.equal(b.results.length, 10); assert.equal(c.results.length, 5); assert.equal(c.next, '');
  assert.equal(new Set([...a.results, ...b.results, ...c.results].map(p => p.id)).size, 25);
  assert.deepEqual(await service.page('кафе Воронеж', a.next), b);
  for (const bad of ['10', 'bad', a.next.replace(':1', ':99')]) await assert.rejects(service.page('кафе Воронеж', bad));
  await assert.rejects(service.page('кафе Москва', a.next));
  await service.page('кафе Воронеж');
  assert.deepEqual([geography, overpass, names], [1, 1, 0]);
});
test('Nominatim is bounded, rejects invalid structure, errors are not cached', async () => {
  await assert.rejects(new Nominatim('https://example.org', 'test@example.org', async () => Response.json({})).search('музей'), status('PROVIDER_ERROR'));
  let calls = 0;
  const places = new Places({ async search() { calls++; throw new SearchError('PROVIDER_ERROR'); } });
  await assert.rejects(places.search('a')); await assert.rejects(places.search('a')); assert.equal(calls, 2);
  const cache = new Cache<string>(10, 1000, Date.now, 12);
  cache.set('a', '12345'); cache.set('b', '12345'); assert.equal(cache.get('a'), undefined);
  cache.set('x', 'x'.repeat(100)); assert.equal(cache.get('x'), undefined);
});
