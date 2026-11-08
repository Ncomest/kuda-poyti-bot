import type { Place, PlacesProvider } from '../types/place.js';
import { parseSearch, type Category } from '../services/query-parser.js';
import { SearchError } from '../services/search-error.js';

// Future category sources adapt city resolution and provider details behind this boundary.
export interface CategoryPlacesProvider {
  search(category: Category, city: string, signal: AbortSignal): Promise<Place[]>;
}
export class HybridPlacesProvider implements PlacesProvider {
  constructor(private readonly names: PlacesProvider, private readonly categories?: CategoryPlacesProvider) {}
  async search(query: string, signal = AbortSignal.timeout(9000)): Promise<Place[]> {
    const parsed = parseSearch(query);
    if (parsed.kind === 'unsupported') throw new SearchError('UNSUPPORTED_CATEGORY');
    if (parsed.kind === 'place') return this.names.search(parsed.query, signal);
    // Production never supplies a category provider. No geography lookup or HTTP fallback.
    if (!this.categories) throw new SearchError('CATEGORY_UNAVAILABLE');
    return this.categories.search(parsed.category, parsed.city, signal);
  }
}
