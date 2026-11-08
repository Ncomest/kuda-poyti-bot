export class Cache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private bytes = 0;
  constructor(private readonly limit = 100, private readonly ttl = 300_000, private readonly now = Date.now, private readonly maxBytes = 4_000_000) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    if (item.expires <= this.now()) { this.bytes -= item.bytes; this.entries.delete(key); return; }
    return item.value;
  }
  set(key: string, value: T, ttl = this.ttl) {
    for (const [entryKey, item] of this.entries) {
      if (item.expires <= this.now()) { this.bytes -= item.bytes; this.entries.delete(entryKey); }
    }
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value));
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    while (this.entries.size && (this.entries.size >= this.limit || this.bytes + bytes > this.maxBytes)) {
      const first = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(first)!.bytes;
      this.entries.delete(first);
    }
    this.entries.set(key, { value, bytes, expires: this.now() + ttl });
    this.bytes += bytes;
  }
}
