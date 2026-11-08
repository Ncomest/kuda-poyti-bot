import type { Place, PlacesProvider } from '../types/place.js';
import { parseSearch } from '../services/query-parser.js';
import { SearchError } from '../services/search-error.js';
import type { CityResolver } from '../services/city-resolver.js';
import type { Overpass } from './overpass.js';
export class HybridPlacesProvider implements PlacesProvider {
  constructor(private readonly names: PlacesProvider, private readonly prototype?: { cities: CityResolver; overpass: Overpass }) {}
  async search(query: string, signal = AbortSignal.timeout(9000)): Promise<Place[]> {
    const parsed = parseSearch(query);
    if (parsed.kind === 'unsupported') throw new SearchError('UNSUPPORTED_CATEGORY');
    if (parsed.kind === 'place') return this.names.search(parsed.query, signal);
    // Live verification failed. No geography request and no fake results in production.
    if (!this.prototype) throw new SearchError('PROVIDER_ERROR');
    const city = await this.prototype.cities.resolve(parsed.city, signal);
    return this.prototype.overpass.search(city, parsed.category, signal);
  }
}
