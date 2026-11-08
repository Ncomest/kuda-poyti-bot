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
  constructor(private readonly provider: PlacesProvider) {}
  search(query: string): Promise<Place[]> {
    const key = query.toLocaleLowerCase('ru');
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.provider.search(query).then(result => { this.cache.set(key, result); return result; }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
