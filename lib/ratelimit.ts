/**
 * Rate limiting behind a small interface, so the in-memory version used today
 * can be replaced by a shared store (Redis, Vercel KV) without touching the
 * route that calls it.
 */

export interface RateDecision {
  allowed: boolean;
  /** Seconds until the caller may try again. 0 when allowed. */
  retryAfterSec: number;
}

export interface RateLimiter {
  take(key: string): RateDecision;
}

/**
 * Sliding-window limiter held in process memory.
 *
 * Honest limitation: on serverless hosting each warm instance has its own
 * memory, so this slows abuse down rather than enforcing an exact global cap.
 * The hard spending cap is the LiteLLM key's own budget.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = 5_000,
  ) {}

  take(key: string): RateDecision {
    const current = this.now();
    const windowStart = current - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > windowStart);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + this.windowMs - current) / 1000)) };
    }

    recent.push(current);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(windowStart);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** Drops keys with no recent activity so the map cannot grow without bound. */
  private prune(windowStart: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((time) => time <= windowStart)) this.hits.delete(key);
    }
    // Still too big: every remaining key is active. Drop the oldest entries.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}

/** Caps how many runs execute at once on this instance. */
export class ConcurrencyGate {
  private active = 0;

  constructor(private readonly max: number) {}

  /** Returns a release function, or null when the gate is full. */
  enter(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}
