import { randomBytes } from 'node:crypto';
import { SearchError } from './search-error.js';
import type { Place, PlacesProvider } from '../types/place.js';
import { Cache } from '../utils/cache.js';
export function parseQuery(input: string): string | null {
  const value = input.trim();
  if (value.length > 201 || !value.endsWith('!')) return null;
  const query = value.slice(0, -1).trim().replace(/\s+/gu, ' ');
  if (query.length < 2 || query.length > 200 || /[\p{Cc}\p{Cf}!]/u.test(query)) return null;
  return query;
}
export class Places {
  private cache = new Cache<Place[]>();
  private pending = new Map<string, Promise<Place[]>>();
  private sessions: Cache<{ key: string; results: Place[] }>;
  constructor(private readonly provider: PlacesProvider, now = Date.now) {
    this.sessions = new Cache(50, 300_000, now);
  }
  search(query: string): Promise<Place[]> {
    const key = query.toLocaleLowerCase('ru');
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 10) return Promise.reject(new SearchError('BUSY'));
    const request = this.provider.search(query, AbortSignal.timeout(9000)).then(result => { this.cache.set(key, result, result.length ? 86_400_000 : 600_000); return result; }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
  async page(query: string, offset = ''): Promise<{ results: Place[]; next: string }> {
    const key = query.toLocaleLowerCase('ru');
    let token: string, results: Place[], start = 0;
    if (offset) {
      const match = /^([a-f0-9]{24}):([1-9][0-9]?)$/.exec(offset);
      if (!match) throw new SearchError('INVALID_OFFSET');
      token = match[1]!;
      start = Number(match[2]) * 10;
      const session = this.sessions.get(token);
      if (!session || session.key !== key || start >= session.results.length) throw new SearchError('INVALID_OFFSET');
      results = session.results;
    } else {
      results = [...new Map((await this.search(query)).filter(validPlace).slice(0, 100).map(p => [p.id, p])).values()];
      token = randomBytes(12).toString('hex');
      this.sessions.set(token, { key, results });
    }
    return { results: results.slice(start, start + 10), next: start + 10 < results.length ? `${token}:${start / 10 + 1}` : '' };
  }

}

// Validate the shared provider boundary before producing Telegram Venue cards.
function validPlace(p: Place): boolean {
  return typeof p.id === 'string' && Buffer.byteLength(p.id) > 0 && Buffer.byteLength(p.id) <= 64
    && typeof p.title === 'string' && !!p.title.trim() && typeof p.address === 'string' && !!p.address.trim()
    && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
    && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180;
}
