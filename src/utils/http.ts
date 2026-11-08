import { SearchError } from '../services/search-error.js';
export async function boundedJson(response: Response, limit = 1_000_000): Promise<unknown> {
  if (!response.body) throw new SearchError('PROVIDER_ERROR');
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new SearchError('PROVIDER_ERROR');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function retryDelay(header: string | null): number {
  if (!header) return 30_000;
  const seconds = Number(header);
  return Math.min(86_400_000, Math.max(1000, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()) || 30_000);
}
