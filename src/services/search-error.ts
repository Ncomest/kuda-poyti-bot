export type SearchStatus = 'EMPTY' | 'BUSY' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'INVALID_CITY' | 'AMBIGUOUS_CITY' | 'UNSUPPORTED_CATEGORY';
export class SearchError extends Error {
  constructor(public readonly status: SearchStatus) { super(status); }
}
export const messages: Record<SearchStatus, string> = {
  EMPTY: 'Места не найдены', BUSY: 'Сервис занят. Повторите позднее', TIMEOUT: 'Поиск занимает слишком много времени',
  PROVIDER_ERROR: 'Сервис поиска временно недоступен', INVALID_CITY: 'Город или его граница не определены',
  AMBIGUOUS_CITY: 'Уточните город и регион через запятую', UNSUPPORTED_CATEGORY: 'Уточните категорию: кафе, рестораны, супермаркеты',
};
