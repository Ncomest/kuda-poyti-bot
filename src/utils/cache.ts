export class Cache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  constructor(private readonly limit = 100, private readonly ttl = 300_000, private readonly now = Date.now) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    if (item.expires <= this.now()) { this.entries.delete(key); return; }
    return item.value;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: this.now() + this.ttl });
  }
}
