export const APP_VERSION = "0.2.10";

/**
 * Default update manifest endpoint (GitHub "latest release" JSON).
 *
 * TODO: replace OWNER/REPO with the real repository before shipping.
 * Can be overridden without a rebuild via
 * `localStorage.subtr.updateManifestUrl` or `NEXT_PUBLIC_UPDATE_MANIFEST_URL`.
 */
export const DEFAULT_UPDATE_MANIFEST_URL =
  "https://api.github.com/repos/OWNER/REPO/releases/latest";

/** Compare two semver strings (pre-release suffixes ignored). >0 means a is newer. */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/i, "")
      .split(".")
      .slice(0, 3)
      .map((part) => parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
