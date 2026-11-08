import { createHash } from 'node:crypto';
import type { Place, PlacesProvider } from '../types/place.js';
import { RateLimit } from '../utils/rate-limit.js';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export function mapPlaces(data: unknown): Place[] {
  if (!Array.isArray(data)) return [];
  const places: Place[] = [];
  for (const item of data) {
    if (!record(item)) continue;
    const address = record(item.address) ? item.address : {};
    if (address.country_code !== undefined && text(address.country_code).toLowerCase() !== 'ru') continue;
    if (!text(item.lat) || !text(item.lon)) continue;
    const latitude = Number(item.lat), longitude = Number(item.lon);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue;
    const display = text(item.display_name);
    const title = text(item.name) || display;
    if (!title) continue;
    const id = createHash('sha256').update(`${item.osm_type}:${item.osm_id}:${latitude}:${longitude}:${title}`).digest('hex').slice(0, 32);
    if (places.some(p => p.id === id)) continue;
    places.push({ id, title, address: display || title, latitude, longitude, type: text(item.type) || undefined });
    if (places.length === 10) break;
  }
  return places;
}
export class SearchUnavailable extends Error {}
export class Nominatim implements PlacesProvider {
  private active = false;
  constructor(private readonly baseUrl: string, private readonly email: string,
    private readonly http: typeof fetch = fetch, private readonly limiter = new RateLimit()) {}
  async search(query: string): Promise<Place[]> {
    if (this.active || !this.limiter.take()) throw new SearchUnavailable('busy');
    this.active = true;
    try {
      const url = new URL('search', this.baseUrl.replace(/\/?$/, '/'));
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'ru', 'accept-language': 'ru', limit: '10' }).toString();
      const response = await this.http(url, { headers: { 'User-Agent': `KudaPoytiBot/1.0 (${this.email})`, Accept: 'application/json' }, signal: AbortSignal.timeout(6000), redirect: 'error' });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          const header = response.headers.get('retry-after');
          const seconds = header ? Number(header) : NaN;
          const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : header ? Math.max(0, Date.parse(header) - Date.now()) : 30_000;
          this.limiter.defer(Number.isFinite(delay) ? delay : 30_000);
        }
        throw new SearchUnavailable('http');
      }
      return mapPlaces(await response.json());
    } catch { throw new SearchUnavailable('search unavailable'); }
    finally { this.active = false; }
  }
}
