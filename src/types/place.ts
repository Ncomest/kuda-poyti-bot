export interface Place {
  id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  type?: string;
  source?: 'osm';
  osmType?: 'node' | 'way' | 'relation';
  osmId?: number;
}
export interface PlacesProvider { search(query: string, signal?: AbortSignal): Promise<Place[]> }
