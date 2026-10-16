# SubTr — Update story

This document specifies how SubTr checks for and (later) installs updates.
Phase 1 (this release) is **check + notify only**. No download, no install.

## 1. Manifest

The renderer fetches a small JSON manifest over HTTPS. Two supported shapes:

**GitHub `releases/latest`** (default, zero-maintenance):

```json
{
  "tag_name": "v0.2.11",
  "name": "SubTr 0.2.11",
  "html_url": "https://github.com/<owner>/<repo>/releases/tag/v0.2.11",
  "body": "Release notes…",
  "published_at": "2026-01-01T00:00:00Z"
}
```

**Custom manifest** (self-hosted, if we ever need channels):

```json
{ "version": "0.2.11", "url": "https://example.com/download", "notes": "…" }
```

The client reads `tag_name ?? version`, strips a leading `v`, and compares with
`APP_VERSION` from `src/lib/version.ts` using `compareSemver`.

## 2. Endpoint configuration

- Default: `DEFAULT_UPDATE_MANIFEST_URL` in `src/lib/version.ts`
  (`https://api.github.com/repos/OWNER/REPO/releases/latest`) — **TODO**: set
  `OWNER/REPO` before shipping.
- Override without a rebuild, in order of precedence:
  1. `localStorage["subtr.updateManifestUrl"]`
  2. `NEXT_PUBLIC_UPDATE_MANIFEST_URL`
  3. the default constant

## 3. UI states (Settings → About → Check for updates)

| State | Shown |
|---|---|
| idle | "Check for updates" button |
| checking | disabled button, "Checking…" |
| up to date | "You’re on the latest version." |
| update available | "Update available: {version}" + "Open download page" link (`html_url`) |
| failed | quiet "Could not check for updates." (no modal) |

The check is best-effort: unauthenticated GitHub API calls are rate-limited
(60/h/IP); a 403/network failure maps to the quiet error state.

## 3b. Automatic notification (silent, once/day)

Besides the manual button, the app shell runs a **silent** check on mount
(web and desktop) and shows a slim banner when a newer release exists.

- **Gate:** at most once per 24 h (`subtr.update.lastCheckedAt`). Failures are
  silent — never a toast or error UI.
- **Banner:** one line under the top bar (≤40 px, tokens only, no gradients):
  "新版本 {version} 可用" / "New version {version} is available" + a
  "查看更新" / "View update" link (`RELEASES_URL`) + ✕ dismiss.
- **Per-version dismiss:** `subtr.update.dismissed` stores the dismissed
  version, so the banner stays hidden for that release.
- **Cache:** the last known available release is cached in
  `subtr.update.available` so the banner survives page navigation within the
  24 h window (and is cleared when the check reports up-to-date).

```text
mount ─▶ readAvailableUpdate() ─▶ show cached (if not dismissed)
      └▶ shouldAutoCheck()? ── no ──▶ done
             └─ yes ─▶ markChecked() ─▶ checkForUpdate()
                         ├ available ─▶ cache + show banner
                         ├ upToDate  ─▶ clear cache
                         └ error     ─▶ silent
```

## 4. Why unsigned builds cannot auto-install on macOS

Electron's auto-updaters (Squirrel.Mac / `electron-updater`) verify the
downloaded app's code signature against the running app. On macOS:

- The update ZIP must be **signed with a Developer ID** and **notarized** by
  Apple; otherwise Gatekeeper blocks the replacement.
- `electron-updater` additionally requires the feed metadata (e.g. `latest-mac.yml`)
  and a signed update to be accepted.

Unsigned/ad-hoc builds therefore cannot auto-apply updates: the OS refuses the
swap. Windows (NSIS/Squirrel) is more permissive but still expects a signed
installer for a clean UX. Linux packages (AppImage/deb) update via the package
manager or a manual re-download.

## 5. Staged plan

1. **Phase 1 (now):** check + notify. Manual About check plus a silent
   once-per-24 h auto-check with a per-version dismissible banner. Fetch the
   manifest, compare versions, show the release link. No network install. Works
   for unsigned builds.
2. **Phase 2 (signed):** add `electron-updater` with macOS signing +
   notarization and Windows code signing. Ship an update feed (`latest-mac.yml`,
   `latest.yml`) alongside the signed artifacts. Keep the manual link as a
   fallback.
3. **Phase 3 (options):** channels (stable/beta) via the manifest, staged
   rollouts, and in-app release notes.

## 6. Release checklist

- [ ] Bump `APP_VERSION` in `src/lib/version.ts` (single source of truth).
- [ ] Bump `package.json` `version` and the desktop app version if applicable.
- [ ] Tag the release (`vX.Y.Z`) and produce installers.
- [ ] macOS: sign + notarize, then publish the notarized artifact.
- [ ] Publish the GitHub release with notes; confirm the `releases/latest`
      endpoint returns the new `tag_name` and `html_url`.
- [ ] Smoke-test Settings → About → Check for updates against the live endpoint
      (both "up to date" and "update available" paths).
