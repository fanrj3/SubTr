export const APP_VERSION = "0.2.10";

/**
 * Update manifest endpoint (GitHub Releases API "latest" works as-is).
 * Overridable: localStorage["subtr.updateManifestUrl"] > NEXT_PUBLIC_UPDATE_MANIFEST_URL > this.
 */
export const DEFAULT_UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/fanrj3/SubTr/main/update.json";

/** Repository / download links used by About + the update banner. */
export const REPO_URL = "https://github.com/fanrj3/SubTr";
export const RELEASES_URL = "https://github.com/fanrj3/SubTr/releases";

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
