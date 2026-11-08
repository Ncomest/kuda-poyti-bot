import { SearchError, messages } from './services/search-error.js';
import { Bot } from 'grammy';
import { Places, parseQuery } from './services/places.js';
export function createBot(token: string, places: Places, warn: () => void) {
  const bot = new Bot(token);
  bot.command('start', ctx => {
    const status = ctx.match as keyof typeof messages;
    if (Object.hasOwn(messages, status)) return ctx.reply(messages[status]);
    return ctx.reply(
    'Найдите место в любом чате: введите @Kuda_PoytiBot, название и город, затем !\n\n' +
    'Пример: @Kuda_PoytiBot Эрмитаж Санкт-Петербург !\n\n' +
    'Символ ! запускает поиск: до него запрос никуда не отправляется. Выберите результат, чтобы отправить карточку места с картой. Для нового поиска удалите ! и добавьте его после завершения ввода.\n\n' +
    'Данные: © OpenStreetMap contributors (ODbL)\nhttps://www.openstreetmap.org/copyright\nНе вводите личные или конфиденциальные данные.'
  ); });
  bot.on('inline_query', async ctx => {
    const query = parseQuery(ctx.inlineQuery.query);
    let results: Awaited<ReturnType<Places['search']>> = [];
    let next = '';
    let status: keyof typeof messages | undefined;
    if (query) {
      try { const page = await places.page(query, ctx.inlineQuery.offset); results = page.results; next = page.next; if (!results.length) status = 'EMPTY'; }
      catch (error) { status = error instanceof SearchError ? error.status : 'PROVIDER_ERROR'; warn(); }
    }
    await ctx.answerInlineQuery(results.map(p => ({ type: 'venue' as const, id: p.id,
      title: p.title.slice(0, 256), address: `${p.address.slice(0, 400)} · © OpenStreetMap contributors`,
      latitude: p.latitude, longitude: p.longitude })), { cache_time: 0, is_personal: true, next_offset: next, ...(status ? { button: { text: messages[status], start_parameter: status } } : {}) });
  });
  // Never print Telegram errors: they may contain API URLs with tokens.
  bot.catch(() => warn());
  return bot;
}
