export type Category = 'cafe' | 'restaurant' | 'supermarket' | 'grocery';
export type ParsedQuery = { kind: 'place'; query: string } | { kind: 'category'; category: Category; city: string } | { kind: 'unsupported' };
const categories: [RegExp, Category][] = [
  [/^кафе\s+(.+)$/iu, 'cafe'], [/^рестораны?\s+(.+)$/iu, 'restaurant'],
  [/^супермаркеты?\s+(.+)$/iu, 'supermarket'], [/^продуктовые магазины\s+(.+)$/iu, 'grocery'],
];
export function parseSearch(input: string): ParsedQuery {
  const query = input.trim().replace(/\s+/gu, ' ');
  if (!query || query.length > 200 || /[\p{Cc}\p{Cf}!]/u.test(query)) return { kind: 'unsupported' };
  for (const [pattern, category] of categories) {
    const match = pattern.exec(query);
    if (match) return { kind: 'category', category, city: match[1]! };
  }
  if (/^(магазин\S*|кафе|ресторан\S*|супермаркет\S*|продуктовые магазины)(\s|$)/iu.test(query)) return { kind: 'unsupported' };
  return { kind: 'place', query };
}
