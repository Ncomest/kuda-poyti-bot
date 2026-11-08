export interface Place {
  id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  type?: string;
}
export interface PlacesProvider { search(query: string): Promise<Place[]> }
