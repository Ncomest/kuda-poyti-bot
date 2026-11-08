import { createHash } from 'node:crypto';
import type { Place, PlacesProvider } from '../types/place.js';
import { SearchError } from '../services/search-error.js';
import { boundedJson, retryDelay } from '../utils/http.js';
import { RateLimit } from '../utils/rate-limit.js';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export function mapPlaces(data: unknown): Place[] {
  if (!Array.isArray(data)) return [];
  const places: Place[] = [];
  for (const item of data) {
    if (!record(item)) continue;
    if (!['node', 'way', 'relation'].includes(text(item.osm_type)) || !Number.isSafeInteger(item.osm_id) || Number(item.osm_id) <= 0) continue;
    const address = record(item.address) ? item.address : {};
    if (address.country_code !== undefined && text(address.country_code).toLowerCase() !== 'ru') continue;
    if (!text(item.lat) || !text(item.lon)) continue;
    const latitude = Number(item.lat), longitude = Number(item.lon);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue;
    const display = text(item.display_name);
    const title = text(item.name) || display;
    if (!title) continue;
    const id = createHash('sha256').update(`osm:${item.osm_type}:${item.osm_id}`).digest('hex').slice(0, 32);
    if (places.some(p => p.id === id)) continue;
    places.push({ id, source: 'osm', osmType: item.osm_type as 'node' | 'way' | 'relation', osmId: Number(item.osm_id), title, address: display || title, latitude, longitude, type: text(item.type) || undefined });
    if (places.length === 40) break;
  }
  return places;
}
export class Nominatim implements PlacesProvider {
  private active = false;
  constructor(private readonly baseUrl: string, private readonly email: string,
    private readonly http: typeof fetch = fetch, private readonly limiter = new RateLimit()) {}
  async search(query: string, signal?: AbortSignal): Promise<Place[]> {
    return mapPlaces(await this.lookup(query, signal));
  }
  // CityResolver must use this same instance, sharing the application's limiter.
  async lookup(query: string, signal = AbortSignal.timeout(6000)): Promise<unknown> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
    if (this.active || !this.limiter.take()) throw new SearchError('BUSY');
    this.active = true;
    try {
      signal.throwIfAborted();
      const url = new URL('search', this.baseUrl.replace(/\/?$/, '/'));
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'ru', 'accept-language': 'ru', limit: '40' }).toString();
      const response = await this.http(url, { headers: { 'User-Agent': `KudaPoytiBot/1.0 (${this.email})`, Accept: 'application/json' }, signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500) this.limiter.defer(retryDelay(response.headers.get('retry-after')));
        throw new SearchError(response.status === 429 ? 'BUSY' : 'PROVIDER_ERROR');
      }
      const data = await boundedJson(response);
      if (!Array.isArray(data)) throw new SearchError('PROVIDER_ERROR');
      return data;
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'TimeoutError')) throw new SearchError('TIMEOUT');
      if (error instanceof SearchError) throw error;
      throw new SearchError('PROVIDER_ERROR');
    } finally { this.active = false; }
  }
}
