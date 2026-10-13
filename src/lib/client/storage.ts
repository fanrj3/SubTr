const cache = new Map<string, { raw: string | null; value: unknown }>();

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    const cached = cache.get(key);
    if (cached && cached.raw === raw) {
      return cached.value as T;
    }
    const value = raw === null ? fallback : (JSON.parse(raw) as T);
    cache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(value);
    window.localStorage.setItem(key, raw);
    cache.set(key, { raw, value });
  } catch {
    // Storage may be disabled or full; ignore silently.
  }
}
