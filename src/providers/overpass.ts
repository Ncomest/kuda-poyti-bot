// Experimental adapter. Not wired to a public endpoint in the application.
import type { Place } from '../types/place.js';
import type { Category } from '../services/query-parser.js';
import type { City } from '../services/city-resolver.js';
import { SearchError } from '../services/search-error.js';
import { boundedJson, retryDelay } from '../utils/http.js';
const tags: Record<Category, string[]> = { cafe: ['["amenity"="cafe"]'], restaurant: ['["amenity"="restaurant"]'], supermarket: ['["shop"="supermarket"]'], grocery: ['["shop"="supermarket"]', '["shop"="convenience"]'] };
const labels: Record<Category, string> = { cafe: 'Кафе', restaurant: 'Ресторан', supermarket: 'Супермаркет', grocery: 'Продуктовый магазин' };
export function buildQuery(city: City, category: Category): string {
  if (!Number.isSafeInteger(city.relationId) || city.relationId <= 0 || !Object.hasOwn(tags, category)) throw new SearchError('INVALID_CITY');
  return `[out:json][timeout:7][maxsize:16777216];rel(${city.relationId});map_to_area->.city;.city out ids;(${tags[category].map(t => `nwr${t}(area.city);`).join('')});out center qt 101;`;
}
export function mapOverpass(data: unknown, city: City, category: Category): Place[] {
  if (!data || typeof data !== 'object' || 'remark' in data || !('elements' in data) || !Array.isArray(data.elements)) throw new SearchError('PROVIDER_ERROR');
  const area = data.elements.find(e => e?.type === 'area' && e.id === 3_600_000_000 + city.relationId);
  if (!area) throw new SearchError('INVALID_CITY');
  const places = new Map<string, Place>();
  for (const e of data.elements) {
    if (!e || !['node', 'way', 'relation'].includes(e.type) || !Number.isSafeInteger(e.id) || e.id <= 0) continue;
    const lat = e.type === 'node' ? e.lat : e.center?.lat, lon = e.type === 'node' ? e.lon : e.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const text = (key: string): string => typeof t[key] === 'string' ? t[key].trim().slice(0, 400) : '';
    const title = text('name:ru') || text('name') || text('brand:ru') || text('brand') || labels[category];
    const address = text('addr:full') || [text('addr:city') || city.name, text('addr:street') || text('addr:place'), text('addr:housenumber')].filter(Boolean).join(', ');
    const hasAddress = ['addr:full', 'addr:street', 'addr:place', 'addr:housenumber'].some(k => text(k));
    const id = `osm:${e.type}:${e.id}`;
    places.set(id, { id, source: 'osm', osmType: e.type, osmId: e.id, title, type: category, latitude: lat, longitude: lon, address: hasAddress ? address : `${city.name}, адрес не указан` });
  }
  return [...places.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export class Overpass {
  private active = false;
  private next = 0;
  constructor(private readonly endpoint: string, private readonly http: typeof fetch = fetch) {}
  async search(city: City, category: Category, signal: AbortSignal): Promise<Place[]> {
    if (this.active || Date.now() < this.next) throw new SearchError('BUSY');
    this.active = true;
    this.next = Date.now() + 1000;
    try {
      signal.throwIfAborted();
      const response = await this.http(this.endpoint, { method: 'POST', body: new URLSearchParams({ data: buildQuery(city, category) }), signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500) this.next = Date.now() + retryDelay(response.headers.get('retry-after'));
        throw new SearchError(response.status === 429 ? 'BUSY' : 'PROVIDER_ERROR');
      }
      const result = mapOverpass(await boundedJson(response), city, category);
      // 101 is a sentinel, never claim a complete city inventory.
      return result.slice(0, 100);
    } catch (error) {
      if (signal.aborted) throw new SearchError('TIMEOUT');
      if (error instanceof SearchError) throw error;
      throw new SearchError('PROVIDER_ERROR');
    } finally { this.active = false; }
  }
}
