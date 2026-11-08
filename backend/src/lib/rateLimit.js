// Tiny fixed-window rate limiter kept in memory (one server process, so this is enough).
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const windows = new Map();
  return function allow(key) {
    const t = now();
    let entry = windows.get(key);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      windows.set(key, entry);
    }
    entry.count++;
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
    }
    return entry.count <= max;
  };
}
