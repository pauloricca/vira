// Budget retained data URLs conservatively as UTF-16, including key storage.
export class ArtworkCache {
  private entries = new Map<string, { value: string | null; bytes: number }>();
  private bytes = 0;
  constructor(private maxBytes = 16 * 1024 * 1024, private maxEntries = 512) {}
  has(key: string) { return this.entries.has(key); }
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: string | null) {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    const bytes = (key.length + (value?.length ?? 0)) * 2 + 64;
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
