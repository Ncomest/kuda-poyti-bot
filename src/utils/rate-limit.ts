// No waiting queue: reserve synchronously before starting fetch.
export class RateLimit {
  private next = 0;
  constructor(private readonly now = () => performance.now()) {}
  take(): boolean {
    if (this.now() < this.next) return false;
    this.next = this.now() + 1000;
    return true;
  }
  defer(milliseconds: number) { this.next = Math.max(this.next, this.now() + milliseconds); }
}
