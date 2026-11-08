export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = env.BOT_TOKEN?.trim();
  const email = env.NOMINATIM_CONTACT_EMAIL?.trim();
  if (!token) throw new Error('Не задан BOT_TOKEN');
  if (!email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
    throw new Error('Задайте корректный NOMINATIM_CONTACT_EMAIL');
  const url = new URL(env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Некорректный NOMINATIM_URL');
  const level = env.LOG_LEVEL || 'info';
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(level)) throw new Error('Некорректный LOG_LEVEL');
  return { token, email, url: url.toString(), level };
}
