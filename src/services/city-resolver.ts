import { Cache } from '../utils/cache.js';
import { SearchError } from './search-error.js';
export interface City { name: string; relationId: number; region: string }
export type CityLookup = (query: string, signal: AbortSignal) => Promise<unknown>;
const normalized = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
export class CityResolver {
  private cache = new Cache<City>(100, 7 * 86_400_000);
  constructor(private readonly lookup: CityLookup) {}
  async resolve(query: string, signal: AbortSignal): Promise<City> {
    const key = normalized(query);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const [name, region, ...extra] = query.split(',').map(s => s.trim());
    if (!name || extra.length || (region !== undefined && !region)) throw new SearchError('INVALID_CITY');
    const data = await this.lookup(query, signal);
    if (!Array.isArray(data)) throw new SearchError('PROVIDER_ERROR');
    const candidates = new Map<number, City>();
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const a = item.address;
      if (!a || a.country_code !== 'ru' || item.osm_type !== 'relation' || !Number.isSafeInteger(item.osm_id) || item.osm_id <= 0) continue;
      if (item.class !== 'boundary' || item.type !== 'administrative' || !['city', 'town', 'village'].includes(item.addresstype)) continue;
      if (typeof item.name !== 'string' || normalized(item.name) !== normalized(name)) continue;
      const state = typeof a.state === 'string' ? a.state : '';
      if (region && normalized(state) !== normalized(region)) continue;
      candidates.set(item.osm_id, { name: item.name, relationId: item.osm_id, region: state });
    }
    // A full limit-sized result may conceal further homonyms: never choose silently.
    if (candidates.size > 1 || (candidates.size && data.length >= 10)) throw new SearchError('AMBIGUOUS_CITY');
    const city = candidates.values().next().value;
    if (!city) throw new SearchError('INVALID_CITY');
    this.cache.set(key, city);
    return city;
  }
}
