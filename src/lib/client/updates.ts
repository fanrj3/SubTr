import {
  APP_VERSION,
  DEFAULT_UPDATE_MANIFEST_URL,
  RELEASES_URL,
  compareSemver,
} from "@/lib/version";

export const UPDATE_LAST_CHECKED_KEY = "subtr.update.lastCheckedAt";
export const UPDATE_DISMISSED_KEY = "subtr.update.dismissed";
export const UPDATE_AVAILABLE_KEY = "subtr.update.available";
export const UPDATE_MANIFEST_OVERRIDE_KEY = "subtr.updateManifestUrl";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateCheckResult =
  | { status: "upToDate" }
  | { status: "available"; version: string; url: string }
  | { status: "error" };

function readItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export function resolveUpdateEndpoint(): string {
  return (
    readItem(UPDATE_MANIFEST_OVERRIDE_KEY) ||
    process.env.NEXT_PUBLIC_UPDATE_MANIFEST_URL ||
    DEFAULT_UPDATE_MANIFEST_URL
  );
}

/** Fetch + compare the latest release; never throws. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const endpoint = resolveUpdateEndpoint();
    const res = await fetch(endpoint, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("bad status");
    const data = (await res.json()) as {
      tag_name?: unknown;
      version?: unknown;
      html_url?: unknown;
    };
    const version = String(data.tag_name ?? data.version ?? "").replace(/^v/i, "");
    if (!version) throw new Error("no version");
    const url = typeof data.html_url === "string" ? data.html_url : RELEASES_URL;
    if (compareSemver(version, APP_VERSION) > 0) {
      return { status: "available", version, url };
    }
    return { status: "upToDate" };
  } catch {
    return { status: "error" };
  }
}

/** Auto-check gate: at most once per 24 h. */
export function shouldAutoCheck(now = Date.now()): boolean {
  const last = Number(readItem(UPDATE_LAST_CHECKED_KEY) ?? 0);
  return !last || now - last >= UPDATE_CHECK_INTERVAL_MS;
}

export function markChecked(now = Date.now()): void {
  writeItem(UPDATE_LAST_CHECKED_KEY, String(now));
}

export function readDismissedVersion(): string | null {
  return readItem(UPDATE_DISMISSED_KEY);
}

export function dismissVersion(version: string): void {
  writeItem(UPDATE_DISMISSED_KEY, version);
}

export function readAvailableUpdate(): { version: string; url: string } | null {
  const raw = readItem(UPDATE_AVAILABLE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; url?: unknown };
    if (typeof parsed.version === "string" && typeof parsed.url === "string") {
      return { version: parsed.version, url: parsed.url };
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

export function writeAvailableUpdate(update: { version: string; url: string }): void {
  writeItem(UPDATE_AVAILABLE_KEY, JSON.stringify(update));
}

export function clearAvailableUpdate(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(UPDATE_AVAILABLE_KEY);
  } catch {
    // Ignore storage errors.
  }
}
