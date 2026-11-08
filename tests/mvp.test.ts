import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridPlacesProvider } from '../src/providers/hybrid.js';
import { Nominatim } from '../src/providers/nominatim.js';
import { Places } from '../src/services/places.js';
import { SearchError } from '../src/services/search-error.js';
import { RateLimit } from '../src/utils/rate-limit.js';
import { createBot } from '../src/bot.js';
const status = (name: string) => (e: unknown) => e instanceof SearchError && e.status === name;
const fixture = { name: 'Место', display_name: 'Адрес, Россия', osm_type: 'node', osm_id: 1, lat: '51', lon: '39' };
test('MVP routes places and chains, categories never reach HTTP even with environment flags', async () => {
  let calls = 0, clock = 0;
  const provider = new HybridPlacesProvider(new Nominatim('https://example.org', 'test@example.org', async input => {
    calls++;
    assert.equal(new URL(String(input)).pathname, '/search');
    return Response.json(Array.from({ length: 23 }, (_, i) => ({ ...fixture, osm_id: i + 1 })));
  }, new RateLimit(() => (clock += 1000))));
  // No environment switch is read by the production composition.
  const previous = process.env.OVERPASS_ENABLED;
  process.env.OVERPASS_ENABLED = 'true';
  try {
    for (const query of ['Кафе Воронеж', 'Рестораны Москва', 'Супермаркеты Санкт-Петербург', 'Продуктовые магазины Воронеж'])
      await assert.rejects(provider.search(query), status('CATEGORY_UNAVAILABLE'));
    await assert.rejects(provider.search('Магазины Москва'), status('UNSUPPORTED_CATEGORY'));
    assert.equal(calls, 0);
    for (const query of ['Эрмитаж Санкт-Петербург', 'Красная площадь Москва', 'Пятёрочка Воронеж', 'Магнит Москва']) {
      const service = new Places(provider);
      const first = await service.page(query);
      const second = await service.page(query, first.next);
      const last = await service.page(query, second.next);
      assert.deepEqual([first.results.length, second.results.length, last.results.length, last.next], [10, 10, 3, '']);
      assert.equal(new Set([...first.results, ...second.results, ...last.results].map(p => p.id)).size, 23);
    }
    assert.equal(calls, 4);
  } finally {
    if (previous === undefined) delete process.env.OVERPASS_ENABLED; else process.env.OVERPASS_ENABLED = previous;
  }
});
test('expired sessions reject without re-querying and cache outlives sessions', async () => {
  let now = 0, calls = 0;
  const service = new Places({ async search() { calls++; return Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: 'Место', address: 'Адрес', latitude: 51, longitude: 39 })); } }, () => now);
  const first = await service.page('Место');
  now = 300_000;
  await assert.rejects(service.page('Место', first.next), status('INVALID_OFFSET'));
  assert.equal(calls, 1);
  await service.page('Место');
  assert.equal(calls, 1);
});
test('native venues enforce required fields and ignore invalid provider records', async () => {
  const place = { id: 'good', title: 'Я'.repeat(500), address: 'А'.repeat(800), latitude: 51, longitude: 39 };
  const service = new Places({ async search() { return [place, place, { ...place, id: 'bad', latitude: NaN }, { ...place, id: 'x'.repeat(65) }, { ...place, id: 'empty', title: '' }]; } });
  const bot = createBot('123:test', service, () => {});
  bot.botInfo = { id: 123, is_bot: true, first_name: 'Test', username: 'Test', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true };
  bot.api.config.use(async (_prev, _method, payload: any) => {
    assert.equal(payload.results.length, 1);
    const venue = payload.results[0];
    assert.deepEqual(Object.keys(venue).sort(), ['address', 'id', 'latitude', 'longitude', 'title', 'type']);
    assert.equal(venue.type, 'venue'); assert.equal(venue.title.length, 256); assert.ok(venue.address.length < 512);
    return { ok: true, result: true } as any;
  });
  await bot.handleUpdate({ update_id: 1, inline_query: { id: '1', from: { id: 1, is_bot: false, first_name: 'Test' }, query: 'Место Москва !', offset: '' } });
});
test('Nominatim abort is TIMEOUT, not an empty cached result', async () => {
  const controller = new AbortController();
  const provider = new Nominatim('https://example.org', 'test@example.org', async (_input, init) => {
    controller.abort();
    init!.signal!.throwIfAborted();
    return Response.json([]);
  });
  await assert.rejects(provider.search('Место', controller.signal), status('TIMEOUT'));
});
