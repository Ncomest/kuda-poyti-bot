import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot } from '../src/bot.js';
import { Places } from '../src/services/places.js';
test('inline handler gates API calls and sends native venue with attribution', async () => {
  let calls = 0;
  const bot = createBot('123:test', new Places({ async search() {
    calls++;
    return [{ id: 'place', title: 'Эрмитаж', address: 'Санкт-Петербург', latitude: 59.94, longitude: 30.31 }];
  } }), () => {});
  const answers: any[] = [];
  bot.botInfo = { id: 123, is_bot: true, first_name: 'Test', username: 'Kuda_PoytiBot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true };
  bot.api.config.use(async (_prev, method, payload) => {
    assert.equal(method, 'answerInlineQuery');
    answers.push(payload);
    return { ok: true, result: true } as any;
  });
  for (const [index, query] of ['кафе Воронеж', 'Эрмитаж Санкт-Петербург !'].entries()) {
    await bot.handleUpdate({ update_id: index, inline_query: { id: String(index), from: { id: 1, is_bot: false, first_name: 'Test' }, query, offset: '' } });
  }
  assert.equal(calls, 1);
  assert.deepEqual(answers[0].results, []);
  assert.equal(answers[1].results[0].type, 'venue');
  assert.match(answers[1].results[0].address, /© OpenStreetMap contributors/);
  assert.equal(answers[1].results[0].latitude, 59.94);
});
test('inline pagination, invalid offsets and provider errors use chat buttons without fake venues', async () => {
  let calls = 0;
  const bot = createBot('123:test', new Places({ async search(query) {
    calls++;
    if (query === 'ошибка') throw new Error('private data');
    return Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: 'Кафе', address: 'Воронеж', latitude: 51, longitude: 39 }));
  } }), () => {});
  bot.botInfo = { id: 123, is_bot: true, first_name: 'Test', username: 'Kuda_PoytiBot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true };
  const answers: any[] = [];
  bot.api.config.use(async (_prev, _method, payload) => { answers.push(payload); return { ok: true, result: true } as any; });
  const update = (query: string, offset: string) => bot.handleUpdate({ update_id: answers.length, inline_query: { id: String(answers.length), from: { id: 1, is_bot: false, first_name: 'Test' }, query, offset } });
  await update('кафе Воронеж !', '');
  await update('кафе Воронеж !', answers[0].next_offset);
  assert.equal(answers[0].results.length, 10); assert.equal(answers[1].results.length, 2);
  assert.equal(answers[1].next_offset, ''); assert.equal(calls, 1);
  assert.ok(answers[1].results.every((p: any) => p.type === 'venue' && !('input_message_content' in p)));
  await update('кафе Воронеж !', 'malformed');
  await update('ошибка !', '');
  for (const answer of answers.slice(2)) { assert.deepEqual(answer.results, []); assert.equal(answer.button.start_parameter, 'PROVIDER_ERROR'); }
});
