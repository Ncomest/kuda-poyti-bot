import { readConfig } from './config.js';
import { createBot } from './bot.js';
import { Nominatim } from './providers/nominatim.js';
import { HybridPlacesProvider } from './providers/hybrid.js';
import { Places } from './services/places.js';
async function main() {
  const config = readConfig();
  const warn = () => { if (['debug', 'info', 'warn'].includes(config.level)) console.warn('Запрос не выполнен. Повторите позднее.'); };
  const bot = createBot(config.token, new Places(new HybridPlacesProvider(new Nominatim(config.url, config.email))), warn);
  let stopping = false;
  const stop = () => { stopping = true; if (bot.isRunning()) void bot.stop(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await bot.init();
  if (stopping) return;
  await bot.start({ allowed_updates: ['message', 'inline_query'], onStart: () => {
    if (['debug', 'info'].includes(config.level)) console.info('Kuda Poyti Bot запущен');
  } });
}
main().catch(error => {
  // Only our own configuration messages are safe to display.
  const message = error instanceof Error && /^(Не задан|Задайте|Некорректный)/.test(error.message) ? error.message : 'Не удалось запустить бота';
  console.error(message);
  process.exitCode = 1;
});
