# SubTr — Development Log

Consolidated development history for tracking: what shipped in which version, the commit to inspect, and where the code lives. Maintained by the orchestrator at each release. (Summaries only — no raw plans.)

Repo: `~/04_Dev/SubTr` · Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Electron 44

---

## Version index

| Version | Key commits | Theme |
|---|---|---|
| pre-0.1.0 | `ccdb396` scaffold · `09c96d8` rename · `23b595e` web app · `8219072` overlap fix · `a2598c4` dedup fix | Web app: reader, subtitle overlay, LLM proxy, presets |
| 0.1.x→0.2.0 dev | `46feadf` | OpenCode Go preset + Electron desktop (system-wide capture) |
| **0.2.0** | `032dbf4` | Fast mode, Auto target language, teleprompter scroll, lessons learned |
| **0.2.1** | `66af67f` | Settings page, profiles v2, thinking control, subtitle customization |
| **0.2.2** | `4c10810` · docs `0efc776` | Theme + UI language, compact window, position player |
| **0.2.3** | `cb855ca` · docs `3650ab3` | Native theme, display-aspect preview, Test button, fade-out, caps, capture handshake |
| **0.2.10** | `2204fb8` | Plugin API v2 (host capabilities), image-translate P0, voice long-run fix |
| **0.2.9** | `7f5c4e5` | Tray icons + Usage submenu, navigation silkiness, pace scale, About, voice (Beta) phase 2 |
| **0.2.8** | `bfef0e6` | Home widgets below reader, scroll isolation, position layout, plugin kit + preview, tray usage, voice (Beta) phase 1 |
| **0.2.7** | `7fe1bf1` | Settings refactor (nav rail + setting rows), Base UI primitives, DESIGN.md |
| **0.2.6** | `c4260d8` | Usage-stats plugin, panel capability, settings polish |
| **0.2.5** | `34d13b5` | Plugins v1, cost meter + status bar, encrypted config export/import, player polish |
| **0.2.4** | `f3cc2a3` | Dictionary, real-screen player, hotkey, tray |

---

## Feature index (where to look)

| Feature | Since | Commit | Primary files |
|---|---|---|---|
| Next.js scaffold + Tailwind v4 + ESLint | pre-0.1.0 | `ccdb396` | `next.config.ts`, `eslint.config.mjs` |
| Reader (paste / edit / select) | pre-0.1.0 | `23b595e` | `src/components/reader.tsx` |
| Subtitle overlay (in-app, streaming) | pre-0.1.0 | `23b595e` | `src/components/subtitle-overlay.tsx` |
| LLM proxy `/api/translate` (SSE→text) | pre-0.1.0 | `23b595e` | `src/app/api/translate/route.ts`, `src/lib/server/llm.ts` |
| `/api/test` (connection check) | pre-0.1.0 | `23b595e` | `src/app/api/test/route.ts` |
| Provider presets (15 providers) | pre-0.1.0 | `23b595e` | `src/lib/presets.ts` |
| OpenCode Go preset (session header + UA) | pre-0.2.0 | `46feadf` | `src/lib/presets.ts` |
| Electron desktop (selection-hook capture, overlay window, ⌘⇧D) | pre-0.2.0 | `46feadf` | `desktop/main.cjs`, `desktop/preload.cjs` |
| Subtitle position/style settings + drag canvas | 0.2.1 | `66af67f` | `src/components/settings/*`, `src/lib/client/subtitle-style.ts` |
| Profiles v2 (multi API setups + migration) | 0.2.1 | `66af67f` | `src/lib/client/settings.ts` |
| Thinking control (off/low/medium/high per provider) | 0.2.1 | `66af67f` | `src/lib/presets.ts` (`thinking`/`defaultParams`), settings page |
| Fast mode for short text (+ retry without overrides) | 0.2.0 | `032dbf4` | `src/lib/server/llm.ts`, settings page |
| Auto target language (CJK↔EN) | 0.2.0 | `032dbf4` | `src/lib/client/translation-utils.ts` |
| Teleprompter scroll (hold→scroll→final, interrupt, Esc) | 0.2.0 | `032dbf4` | `src/components/subtitle-overlay.tsx` |
| Markdown rendering in subtitles | 0.2.1 | `66af67f` | `src/components/markdown-renderer.tsx` |
| Theme (system/light/dark) + pre-hydration | 0.2.2 | `4c10810` | `src/lib/client/theme.ts`, `src/app/layout.tsx` |
| UI language (system/zh-CN/en, 109 keys) | 0.2.2 | `4c10810` | `src/lib/client/i18n/**` |
| Position preview player (play/scrub/metrics) | 0.2.2 | `4c10810` | `src/components/position-player.tsx` |
| Native title bar follows theme | 0.2.3 | `cb855ca` | `theme.ts` → `setNativeTheme` bridge |
| Canvas = display aspect + enlarge (modal) | 0.2.3 | `cb855ca` | `src/components/position-player.tsx` |
| Fade-out on dismissal (all paths) | 0.2.3 | `cb855ca` | `src/components/subtitle-overlay.tsx` |
| Capture delivery handshake + pending queue | 0.2.3 | `cb855ca` | `desktop/main.cjs`, `desktop/preload.cjs` |
| Selection cap 10000 (server 12000) | 0.2.3 | `cb855ca` | `src/lib/types.ts` |
| Single-word dictionary (ECDICT offline; phonetics + senses; no LLM) | 0.2.4 | `f3cc2a3` | `src/lib/client/dictionary.ts`, `public/dict/`, `scripts/build-dict.mjs` |
| Subtitle hold-phase progress bar | 0.2.4 | `f3cc2a3` | `src/components/subtitle-overlay.tsx` |
| Position board: presets + center-snap guides (position-only box) | 0.2.4 | `f3cc2a3` | `src/components/position-player.tsx` |
| Real-screen player (Play drives the overlay; drag-pause; ✅ lock; resume) | 0.2.4 | `f3cc2a3` | `position-player.tsx`, `subtitle-overlay.tsx`, `src/app/overlay/page.tsx`, `desktop/main.cjs` |
| Test-connection latency flavor text (tiers + emoji) | 0.2.4 | `f3cc2a3` | `src/app/settings/page.tsx` |
| Customizable global hotkey (default ⌘⇧T; toggles translation mode) | 0.2.4 | `f3cc2a3` | `src/lib/client/hotkey.ts`, `src/components/hotkey-recorder.tsx`, `mode.ts`, `desktop/main.cjs` |
| Tray icon (idle/active + burst animation; resident app) | 0.2.4 | `f3cc2a3` | `desktop/tray-icons.cjs`, `desktop/main.cjs` |
| Plugins v1 (local loader + consent + hot reload + examples) | 0.2.5 | `34d13b5` | `src/lib/server/plugins.ts`, `src/app/api/plugins/`, `src/components/plugins-section.tsx`, `examples/plugins/` |
| Cost meter (usage capture, stats store, `/api/stats`, home status bar) | 0.2.5 | `34d13b5` | `src/lib/server/stats.ts`, `src/lib/server/pricing.ts`, `src/app/api/stats/`, `src/components/status-bar.tsx` |
| Encrypted config export/import (AES-GCM + PBKDF2) | 0.2.5 | `34d13b5` | `src/lib/client/config-transfer.ts`, `src/components/config-transfer.tsx` |
| Pin-on-interaction + lock (click/wheel pins; bottom-right lock) | 0.2.5 | `34d13b5` | `src/components/subtitle-overlay.tsx` |
| Plugin UI panels (`ui.panel`, panels manifest, iframe host + fetch relay) | 0.2.6 | `c4260d8` | `src/lib/server/plugins.ts`, `src/components/plugins-section.tsx`, `src/app/api/plugins/[id]/panel/` |
| Usage-stats plugin (bar chart + calendar heatmap) | 0.2.6 | `c4260d8` | `examples/plugins/usage-stats/`, daily buckets in `src/lib/server/stats.ts` |
| Plugin import/uninstall in Settings (zip upload, overwrite confirm, atomic swap) | 0.2.6 | `599c57a` | `src/app/api/plugins/import/`, DELETE in `src/app/api/plugins/[id]/route.ts`, `src/components/plugins-section.tsx` |
| Plugin home widgets + `location` split (settings vs home) | 0.2.6 | `44de54e` | `src/components/home-widgets.tsx`, `src/components/plugin-panel-frame.tsx`, `location`/`visiblePanels` in `src/lib/server/plugins.ts` |
| Settings shell refactor (grouped nav rail + row primitive + sticky pane) | 0.2.7 | `7fe1bf1` | `src/app/settings/page.tsx`, `src/components/settings-ui.tsx`, `DESIGN.md` |
| Base UI primitives adopted (Tabs/Switch/Slider/Select/Dialog/Collapsible) | 0.2.7 | `7fe1bf1` | `package.json`, `src/components/settings-ui.tsx` |
| Plugin home widgets below the reader (full width, collapsible) | 0.2.8 | `bfef0e6` | `src/components/home-widgets.tsx`, `src/components/subtr-app.tsx` |
| Settings scroll isolation (pane-only scroll, independent rail) | 0.2.8 | `bfef0e6` | `src/app/settings/page.tsx`, `DESIGN.md` |
| Position player responsive rows + breakpoints | 0.2.8 | `bfef0e6` | `src/components/position-player.tsx` |
| Plugin kit (`/plugin-kit/panel.css`) + panel preview (live theme) | 0.2.8 | `bfef0e6` | `public/plugin-kit/panel.css`, `src/app/panel-preview/`, `src/components/panel-preview.tsx` |
| Usage-stats panel redesign on the kit | 0.2.8 | `bfef0e6` | `examples/plugins/usage-stats/panel.html` |
| Tray usage menu + 838×556 default window | 0.2.8 | `bfef0e6` | `desktop/main.cjs` |
| Voice→subtitles Beta phase 1 (loopback capture + whisper.cpp + 2-pass commit + overlay) | 0.2.8 | `bfef0e6` | `desktop/voice-*.cjs`, `src/lib/client/voice/`, `desktop/main.cjs` |
| Tray template icons + Usage submenu | 0.2.9 | `7f5c4e5` | `desktop/tray-icons.cjs`, `desktop/main.cjs` |
| Settings overflow elimination + row wrap + tooltip clamp/flip | 0.2.9 | `7f5c4e5` | `src/components/settings-ui.tsx`, `src/components/tooltip.tsx`, `src/app/settings/page.tsx` |
| Navigation PageFade + stable scrollbar gutters | 0.2.9 | `7f5c4e5` | `src/components/page-fade.tsx`, `src/components/subtr-app.tsx` |
| Pace log-symmetric slider + 1-decimal px/s readout | 0.2.9 | `7f5c4e5` | `src/components/position-player.tsx`, `src/lib/client/position-preview.ts` |
| About section (version/runtime/paths/licenses/links) | 0.2.9 | `7f5c4e5` | `src/app/settings/page.tsx`, i18n |
| Voice (Beta) phase 2: settings section, model downloads, VAD, crash-restart | 0.2.9 | `7f5c4e5` | `src/components/voice-settings.tsx`, `desktop/main.cjs` |
| 0.2.9 follow-up: pace = speed factor, tooltip/description rewrite, voice remount state, scrub retarget | 0.2.9 | `9713277` | `src/components/subtitle-overlay.tsx`, `src/components/voice-settings.tsx`, `src/components/position-player.tsx`, `desktop/preload.cjs` |
| 0.2.9 follow-up 2: SCK loopback forced on macOS (Core Audio tap returns a dead track) | 0.2.9 | `0b88a24` | `desktop/main.cjs` |
| 0.2.9 follow-up 2: settings rows full-width result slot (test connection) | 0.2.9 | `0b88a24` | `src/components/settings-ui.tsx`, `src/app/settings/page.tsx` |
| 0.2.9 follow-up 3: continuous voice captions (growing utterance buffer + in-place overlay updates) | 0.2.9 | `8538ddd` | `desktop/voice-pipeline.cjs`, `desktop/main.cjs`, `src/app/overlay/page.tsx`, `src/components/subtitle-overlay.tsx` |
| 0.2.9 follow-up 4: rolling voice transcript (never-dismiss lines, stop signal) | 0.2.9 | `80dcf6d` | `desktop/main.cjs`, `src/app/overlay/page.tsx`, `src/components/subtitle-overlay.tsx` |
| 0.2.9 follow-up 5: two-zone stable captions (append-only transcript + frozen/tentative translations) | 0.2.9 | `ec07ebb` | `src/app/overlay/page.tsx`, `src/components/subtitle-overlay.tsx` |
| Plugin API v2: host bridge + capture.region / overlay.regions / overlay.subtitle / translate.text / hotkey.register | 0.2.10 | `2204fb8` | `desktop/main.cjs`, `desktop/host-*.html`, `desktop/host-preload.cjs`, `src/lib/server/plugins.ts`, `src/app/api/plugin-events/` |
| Image-translate plugin project P0 (spec + skeleton + plan) | 0.2.10 | `2204fb8` | `examples/plugins/image-translate/`, `docs/image-translate-plugin.md` |
| Image-translate result card: contain-fit sizing, Esc/click-away/✕ dismiss (global Esc), Live-Text highlights, subtitle above card | 0.2.10 | `4322702` | `desktop/host-regions.html`, `desktop/main.cjs` |
| App icon (SVG source + sips/iconutil pipeline wired into electron-builder) | 0.2.10 | `4322702` | `build/icon.svg`, `scripts/build-icon.mjs`, `electron-builder.yml` |
| Update check in About + `docs/UPDATES.md` plan | 0.2.10 | `4322702` | `src/app/settings/page.tsx`, `src/lib/version.ts`, `docs/UPDATES.md` |
| Image-translate batch translate via streaming route + visible degrade (no stuck “Translating…”) | 0.2.10 | `19cb728` | `desktop/main.cjs`, `examples/plugins/image-translate/index.cjs` |
| Highlight numbers off by default + config migration (`configVersion: 2`) | 0.2.10 | `19cb728` | `examples/plugins/image-translate/index.cjs`, `examples/plugins/image-translate/README.md` |
| Auto update notifications (24 h check + dismissible banner) | 0.2.10 | *(release)* | `src/components/update-banner.tsx`, `src/lib/client/updates.ts` |
| MIT LICENSE + package metadata + dev Dock icon | 0.2.10 | *(release)* | `LICENSE`, `package.json`, `desktop/main.cjs` |

---

## Version details

### pre-0.1.0 → web app (`23b595e`)
- Reader; selection-triggered translation; subtitle card at bottom-center; `/api/translate` (streaming) + `/api/test`; 15 provider presets; localStorage settings; README.
- Fixes: Edit-button overlap (`8219072`), retry-friendly selection dedup (`a2598c4`).

### 0.1.x dev → desktop (`46feadf`)
- Electron shell: Next standalone via `utilityProcess`, full-screen transparent overlay, `selection-hook` system capture + `⌘/Ctrl+Shift+D` fallback, macOS accessibility flow; OpenCode Go preset.

### 0.2.0 (`032dbf4`) — fast mode · auto language · teleprompter
- Fast mode for short text (per-preset `fastModeParams`; server retry-without-overrides); thinking defaults (OpenCode Go/DeepSeek `thinking: disabled`).
- Auto target language; overlay respects the Translate toggle.
- Teleprompter: 5s hold → reading-speed scroll (float accumulator) → final hold; wheel interrupt + Esc chip; reduced-motion static.
- Fix rounds: phase reset on stream end, rAF stop on interrupt, desktop Esc guard, wheel double-scroll.

### 0.2.1 (`66af67f`) — settings page · profiles · thinking · customization
- Settings modal → routed page (`/settings`); profiles v2 + v1 migration; Thinking control (preset/off/low/medium/high + per-provider capability table); subtitle timing knobs; style + drag-position; markdown; Thinking indicator.
- Fix rounds: client-nav crash, `/settings` migration, i18n RSC boundary, player scroll viewport, style snapshot stability, fixed-position break.

### 0.2.2 (`4c10810`) — theme · language · compact · player
- Theme (system/light/dark, no flash) + themed scrollbars; UI language (zh-CN/en, instant switch); default window 714×480; `captureDesktopThumbnail`; reading-pace slider; responsive layout; help tooltips; position player (play/scrub/test text/metrics); page transition.

### 0.2.3 (`cb855ca`) — native theme · preview rework · test · robustness
- Title bar follows theme (`setNativeTheme`); canvas = real display aspect + double-click enlarge; drag without text selection; appearance row responsive; base pace 220 wpm / 400 cpm with 0.2–5.0× slider; **Test** button (real-screen playback with live style); fade-out on every dismissal; caps raised (10000/12000); capture delivery handshake + latest-wins pending queue; dismissal aborts in-flight translation.

### 0.2.10 — plugin API v2 (host capabilities) · image-translate P0 · voice long-run fix
- **Plugin API v2** (backward compatible with v1): loopback RPC bridge (127.0.0.1, ephemeral port + bearer token) between the server-hosted plugins and the Electron host, plus an event channel (`POST /api/plugin-events/<id>`, token-authenticated) for host→plugin events.
- New host capabilities:
  - **`capture.region`** — freeze-first region selection (per-display transparent overlay at `display.bounds`, dim + drag, Enter/double-click confirm, Esc cancel), device-pixel crop (`round(x·sf)`) returning a PNG data URL + rect + scaleFactor. Verified crop math exact (200×120 == rect×sf).
  - **`overlay.regions`** — host-rendered image with normalized highlight boxes (`glow|box|underline`, accent, numbered) and hover/select/dismiss events (Esc/click-away/keys 1–9) delivered to the plugin. Verified hover reaches the plugin.
  - **`overlay.subtitle`** — plugin text rendered **verbatim** (no translation, no translate-mode gate), `tone: "normal"|"muted"`, optional `stickyMs`, clean `clear()`; teardown is a hard cut (1 mount per show, ≤210 ms fade, no fallback flash).
  - **`translate.text`** — batch translation through the **active profile** (keys never leave the app); clean `no-profile` / `upstream` errors, time-boxed profile reads (never hangs, works with the window minimized). Verified live incl. 401/502 paths.
  - **`hotkey.register`** — plugin-level global shortcuts with `reserved`/`conflict`/`invalid` detection, `when:"translation-mode"` gating, unregister/isRegistered. Verified incl. gating (0 triggers OFF / 1 ON).
- Plugin-local dependencies documented (`createRequire(pluginDir)`); the packer honors **`.zipignore`** (excludes node_modules/models, reports sizes) and skips `_`-prefixed fixtures.
- Hardening: plugin-activation re-entrancy guard (capabilities are called post-activation — documented); overlay teardown hard cuts for both voice and plugin text (no re-created card, no fallback flash); `translate.text`/profile reads can never hang.
- **Image-translate plugin project P0**: spec + skeleton under `examples/plugins/image-translate/` (capability shapes, engine matrix incl. Apple Vision + PP-OCRv6 Apache-2.0 licensing, settings panel shell on the kit) and the phased plan in `docs/image-translate-plugin.md` — a separate, independently versioned plugin.
- Also carries the **voice long-run stall fix** (details in the 0.2.9 notes, follow-up 6): 150 s continuous audio → deliveries in every 10 s window.
- Verified: bridge auth 401/200; capture crop math; regions hover delivery; hotkey reserved/success/conflict/gating; `translate.text` live (mock, minimized window, error paths); plugin-text overlay 8/8; full chain hotkey→capture→regions→subtitle. Caveats (manual): a real human drag/Esc on the capture overlay, and Retina/multi-display runs.
- **Follow-up (same 0.2.10):** added the **`http.route`** capability — plugins can serve their own endpoints under `/api/plugin-api/<pluginId>/…` (loopback-only, enabled+granted+method matched, handler errors become 500s) — and the panel fetch relay now carries an optional method + JSON body so sandboxed panels can POST (URL guards unchanged). The **image-translate plugin core** (P2) now works end to end: settings-owned config at `<pluginDir>/.config.json`, macOS **Vision OCR** via a Swift helper that **builds on first use** (source-hash stamped), `⌘⇧P` gated to translation mode, capture → OCR → chunked batch translation through the **active profile** (per-text cache) → highlight regions → hover/select → subtitle, dismiss clears everything. Live-verified on a real screenshot: 3 blocks recognized (English + Chinese), 3/3 translated, hover→subtitle, dismiss, unknown-plugin 404. The plugin ships as a 23 KB zip (`examples/plugin-zips/image-translate.zip`); PP-OCRv6 remains the documented cross-platform fallback (later phase).
- **Follow-up 2 (same 0.2.10) — image-translate result card fixed (user report) + icon + update prep:**
  - The captured-image card no longer fills the screen stretched or clips its bottom: the window is sized from the image (≤90 % of the work area, centered, contain-fit), the image is rendered undistorted with letterboxing, and the card gets a header hint + ✕. **Esc now dismisses app-wide** (global Esc armed while the card is open — works without keyboard focus — plus a focused-input hook; forwarded as `region.dismiss` with no double-fire), and click-away/✕ do the same. The subtitle overlay is asserted **above** the card (`floating` < `screen-saver` levels, re-asserted on every show). Highlights are Live-Text style (outline/underline, contrast ring), and **numbers are now opt-in** (20 px badges) — the tiny numeral noise is gone. Headless page checks 14/14.
  - **App icon**: new `build/icon.svg` (subtitle-bars + translate badge) with a `icon:build` pipeline (SVG → PNGs → `.icns` via `sips`/`iconutil`) wired into electron-builder for macOS/Windows/Linux; the dmg now ships the icon (previously the default Electron icon).
  - **Update feature prepared**: Settings → About now has **Check for updates** (configurable manifest URL, semver compare against `APP_VERSION`, states: up-to-date / update available + Open download page / quiet failure) and `docs/UPDATES.md` documents the full plan — including why unsigned macOS builds cannot auto-install (signing/notarization via Squirrel/electron-updater) and the staged path to signed auto-updates.
  - The previous 0.3.0 release was **renumbered to 0.2.10** (user's numbering preference).
- **Follow-up 3 (same 0.2.10):** fixed the image-translate **“Translating…” stuck** bug — the host batch client requested the non-streaming branch of `/api/translate`, which requires the upstream to answer JSON; streaming-only providers return SSE, the translation parsed empty (502), and the plugin left its placeholder up forever. The batch path now uses the **streaming route** (same as selection translation) with a JSON fallback and surfaced upstream errors, and every hover now degrades visibly instead of hanging: translated text → “Translating…” only while genuinely pending → **“<source> · 翻译暂不可用 · Translation unavailable”** on failure (`GET status` exposes `lastTranslateError`). Also: highlight **numbers are off by default** again (opt-in), with a config migration that flips the legacy default but respects explicit user values (`configVersion: 2`).
- **Follow-up 4 (same 0.2.10) — automatic update notifications + ship prep:** the app now silently checks the release manifest (GitHub Releases API for this repo) **at most once per 24 h** and, when a newer version exists, shows a slim dismissible banner under the top bar on both pages («新版本 X 可用 → 查看更新»); dismissed versions stay hidden, failures are silent, and the manual Check-for-updates row in About remains. Ship preparation: `package.json` gained description/author/license, an **MIT `LICENSE`** with third-party notices was added, and the **dev-mode Dock now shows the real app icon** (packaged builds already do).

### 0.2.9 — tray polish · navigation silk · pace scale · About · voice phase 2
- **Tray**: every menu item now carries a 16 px template icon (eye/bubble/mic/gear/chart/download/power, generated in pure JS); usage moved into a hover-opened **Usage submenu** (Today / All time lines; "No usage data yet" fallback); the menu is still rebuilt on every click.
- **Settings**: all unnecessary horizontal scrollbars removed (shell/rail/pane/surfaces — the real culprit was a wide control column forcing overflow); rows now **wrap** instead of crushing — below ~420 px container width the control drops under the title/description (Subtitle at 400 px was rendered as a vertical sliver before).
- **Navigation silkiness**: a content-only 140 ms opacity fade (`PageFade`) with stable scrollbar gutters — the top bar never animates or shifts, and the home↔settings width jump (which read as a web page load) is gone.
- **Profiles**: Export/Import config is now a normal right-aligned setting row; help tooltips are viewport **and pane** clamped and flip above the anchor near the bottom edge (the Thinking tooltip at 838×556 used to be clipped by ~37 px).
- **Subtitle**: scroll-speed readout shows **one decimal** (0.6 / 3.0 / 15.0 px/s — no more "0px/s") and the pace slider is **log-symmetric** (0.20× far left, 1.00× dead center, 5.00× far right, ticks at 0.2/0.5/1/2/5) while the multiplier semantics stay identical.
- New **About** section: version, platform/runtime, real data locations on desktop (plugins dir, whisper assets, stats file), licenses (ECDICT / whisper.cpp / Base UI / PaddleOCR) and links.
- **Voice (Beta) phase 2**: settings **Voice** section with an interactive master toggle (wired to the tray state and idempotent), live status, **model list with per-model download + progress** (sha256 + size verified, resume-safe atomic installs), setup hints, and a desktop-only note on web; **Silero VAD** layered over the energy gate; whisper-server **crash auto-restart** (bounded, then an explicit error state). Fixed an ON→OFF race that could leave the tray label claiming "Listening" — 6/6 convergence + a negative control confirming the probe.
- i18n: 272 keys in parity (en/zh).
- Verified: browser 23/23; Electron 13/14 → race fixed → 6/6 cycles.
- **Follow-up (same 0.2.9):** the reading-pace multiplier is now a **speed factor** — durations are `base ÷ pace`, so **5.00× scrolls 5× faster** and 0.20× is 5× slower (the direction was inverted before; the initial/final holds stay fixed by design and the tooltip now says so explicitly). The row description and the "?" tooltip were rewritten (no longer duplicates; the tooltip documents the scale endpoints, the scroll-phase scope, and what the px/s figure means). The Voice master toggle now reads the live state on remount via the new `voiceGetState()` bridge — it no longer resets when you switch settings sections or pages. The position player's scrub total now tracks the current timeline whenever a run isn't in flight, so the Total row and the scrubber can no longer disagree after a pace change.
- **Follow-up 2 (same 0.2.9):** macOS 26 voice-loopback silence **root-caused** — the default **Core Audio tap** backend (Electron 39+) returns an audio track that is already `ended` when `getDisplayMedia()` resolves, so the pipeline faithfully streamed constant zeros (why rms stayed 0.00000 while frames flowed). SubTr now forces the working **ScreenCaptureKit** loopback backend (`MacCatapLoopbackAudioForScreenShare` merged into `disable-features`; opt back into the tap experiment with `SUBTR_VOICE_CORE_AUDIO_TAP=1`). Verified layer by layer: track `live`, source peak 1.003, real transcripts → commits → overlay hand-offs while an audible clip played. Also fixed the **Test connection row layout**: the result (latency + flavor + errors) now renders in a full-width block **below** the row line — the title can no longer collapse into character-per-line stacking, the button stays aligned, and the stray edge marker is gone.
- **Follow-up 3 (same 0.2.9):** voice captions are now **continuous** — the pipeline transcribes a **growing utterance buffer** (1 s hop, ≤15 s cap; the old sliding 5 s window let the transcript start drift and stalled commits mid-sentence) and delivers every committed growth as an in-place `{voice, utteranceId}` payload, so the subtitle keeps updating instead of dismissing between sentences; silent passes close the utterance with one final delivery and the caption fades only ~2.5 s after the last update. The overlay **coalesces translations** (800 ms trailing debounce, stale results dropped by sequence number), keeps the previous text visible while a new translation is pending, and voice dismissal is a clean hard cut (single mount, no fallback-text flash). Measured: chunk→caption ≈ 1.0–1.4 s; 8 payloads @1 s → 8 translations, 0 gaps, hide = last + 2.55 s; 27 payloads @300 ms → 1 translation; real-audio E2E — 16 deliveries across 2 utterances, strictly growing text, 0 duplicates, final close at silence.
- Verified additions: pace direction/readout measured (scroll phase 52.8s → 15.2s at 5×, 240.8s at 0.2× — exact 1/scale), preset direction, copy diffs en/zh, voice remount across rail/section/page switches (still Listening), scrub retarget (52.8 ↔ 39.4 s) + real seek in the new range, snapshot/resume rules intact; test-connection row 9/9 (1440/714/400, en/zh); continuous captions 13/13 (1 mount, 0 gaps, hide = last + 2.55 s, no fallback flash).
- **Follow-up 4 (same 0.2.9):** voice captions became a **rolling transcript** — while voice mode is on the caption never disappears: each finished sentence stays as a line, the current sentence fills in live at the bottom, and older lines scroll up smoothly (scroller pinned to the bottom; reduced-motion repositions instantly). Silence no longer dismisses anything (`close` only finalizes the line); only turning voice OFF sends `stop`, fading the card out in ≤300 ms. Translation **streams into the live line** (≤150 ms throttled updates, 800 ms trailing coalescing, stale results dropped per line by sequence) and finalized lines keep their final translation. Pin is a no-op while voice is active; Esc/✕ dismiss locally and the next payload reopens. Verified: browser suite → stop-teardown fix → 6/6 (1 mount per session, 0 fallback flashes, ≤205 ms stop); Electron **live audio** — captions grew continuously across two utterances with 0 absent samples (10 growth states, lines 1→2) and cleared on voice OFF.
- **Follow-up 5 (same 0.2.9):** voice captions moved to a **two-zone, stability-first layout** — the top zone shows the live English transcript (**append-only**: regressive payloads are ignored, capped at ~2 lines, grows upward) and the bottom zone shows the translation: finalized sentences become **frozen lines** (never rewritten; older lines scroll out), while the live sentence gets a **tentative** translation refreshed at most once per 2 s and only after ≥20 new characters, replaced in place (never blank, no animation). The card is **bottom-anchored**, so growth moves nothing (0.00 px steady-state movement); scrolling happens only on discrete line appends. Verified with measured metrics: 0 transcript regressions (regressive payload ignored), card-bottom spread 0.00 px, finalized lines hash-stable, tentative cadence honored, one mount per session including the stop (209 ms fade), no fallback flashes; live `afplay` run — both zones present in 120/120 samples, 21 monotonic transcript states across two utterances and a 3 s gap with no disappearance.
- **Follow-up 6 (same 0.2.9):** fixed a **permanent voice stall after ~40 s** of continuous speech — the 15 s utterance force-close was checked only on passes that produced new text (so it could never fire once growth stopped), and the ring was sized exactly to the cap so it slid before the close and dropped the utterance start, making the two-pass gate permanently unagreeable. The ring now carries 6 s slack, the cap check runs on every pass, and all close paths share one `closeUtterance()` restart. Verified with 150 s of real continuous audio: deliveries continue in **every** 10 s window (was frozen after ~40 s), 10 utterance rollovers, crash-restart and stop semantics intact. (Remaining sub-6 s update gaps come from ASR re-decodes on the growing buffer and cap restarts — bounded, self-recovering, and left in place to preserve recognition quality.)

### 0.2.8 — plugin DX · home widgets · scroll/layout fixes · voice (Beta) phase 1
- Home: plugin panels with `location:"home"` now render **directly below the reader** at full reader width as collapsible cards (default collapsed, lazy mount, zero footprint when none) — moved from the bottom strip; the same plugins no longer render inline in Settings (only the show-on-home toggle).
- Settings **scroll isolation**: the pane is the only scroll region, the nav rail scrolls independently, the wheel never leaks between sides, the document never scrolls.
- Subtitle → Position **responsive rework**: preview text, Play and the scrubber are full-width rows under the board; metrics get their own row; presets sit adjacent to the board (container-query breakpoints <560 / ≥560 / ≥720 px).
- Plugin DX: **`/plugin-kit/panel.css`** — theme-aware component kit (surfaces, stats, badges, segmented, buttons, table, bars, heatmap, tooltip, states, themed scrollbars), empirically verified to apply inside the sandboxed panel iframe; **panel preview** at `/panel-preview/<id>/<panelId>` with live preview theme (Follow app / Light / Dark), width switcher (always reachable), reload and identity metadata (no popups); the usage-stats example panel was fully redesigned on the kit (axis ticks, gridlines, date labels, hover tooltips, weekday/month labels, loading/empty/error states).
- Desktop: default window **838×556**; the **tray menu now shows usage** (Today / All time · cost · calls · translations, `~` when estimated; "No usage data yet" fallback) above the existing items; the menu rebuilds on every click.
- **Voice → translated subtitles (Beta, phase 1)**: tray toggle (Off / Starting / Listening / Setup needed); macOS **system-audio loopback** capture (`electron-audio-loopback` flags, no virtual device), 16 kHz PCM → rolling-window transcription via a local **whisper.cpp `whisper-server`** (Metal; model stays loaded) → two-pass stable-prefix commit → existing overlay → existing `/api/translate` (your configured profile; no extra key). Assets live in `~/Library/Application Support/subtr/whisper/` (`bin/whisper-server`, `models/ggml-base.en.bin`; missing → "Setup needed"). Verified: real-clip transcription returns the exact expected sentence (~0.5 s warm inference, M3 Metal) and the commit→overlay hand-off fires. **Known limitation:** live loopback audio was silent on the dev machine (audio routing; both macOS backends), so live audio→subtitle was not observed there — to test manually: grant Screen Recording, play audio, toggle Voice from the tray, watch `[voice] pass#` logs.
- Also: preview theme control + always-reachable width switcher, tooltip date/value split (was “…20260 Calls”), 229 i18n keys in parity. Verified: browser 53/55 (1 fixed + 1 accepted design) → micro-pass verified; Electron 16/16.

### 0.2.7 — settings page normative refactor
- Settings rebuilt as a **modern settings shell**: grouped **vertical nav rail + single pane** (Translate / Subtitle / Plugins / App), 48 px icon-only below 700 px, labels at ≥ 700 px (the default 714×480 window shows labels; the rail stays usable down to 400 px), remembered active section, sticky pane header with a gradient fade.
- Every setting is now a **row** (`title + description + right-aligned control`) on one soft surface per section with hairline separators — no more card-per-setting; long controls span under their row; destructive actions sit at their section's bottom; rarely-used knobs fold into **Advanced** disclosures.
- **Base UI** adopted as the only new dependency (Tabs, Switch, Slider, Select, Dialog, Collapsible), restyled with the existing theme tokens — no token-system swap; selects now show human labels while storing raw values.
- Profiles / Provider / Subtitle fully converted to the row primitive; config export/import dialogs migrated to the shared dialog; behavior unchanged (atomic import, live refresh, wrong-passphrase errors).
- Version strings unified in `src/lib/version.ts` (rail footer + exported config).
- `DESIGN.md` added at the repo root (type scale, spacing, radii, roles, row/nav specs) so future UI work reuses the contract.
- Verified: full browser pass 44/45 → fixed → rail re-check 18/18.

### 0.2.6 — usage-stats plugin · panel capability · settings polish
- **Play snapshot fully re-syncs**: reading pace / initial hold / min display / final hold AND text are compared to the session snapshot — any change starts a fresh run; unchanged resumes.
- Config **export/import moved into the Profiles section** (配置文件).
- Position board mini box: 2px accent border + shadow (board only; the real overlay card unchanged).
- Settings layout: centered stable column with robust shrink (714×480, ~400px) and wide-window centering; controls no longer squeeze.
- Navigation stability: enter animation removed, deterministic scroll reset — the header/title no longer flickers or shifts.
- **Plugin system v1.1**: `ui.panel` capability + `panels` manifest entries + traversal-safe panel HTML route + sandboxed iframe host (`sandbox="allow-scripts"`) with a postMessage fetch relay (allow-listed to same-origin `/api/`, GET-only; forged messages are dropped).
- **First real plugin**: `examples/plugins/usage-stats` — totals, 30-day bar chart, GitHub-style calendar heatmap, metric switcher, theme/language aware; `/api/stats` now returns per-day `daily` buckets (stats store v2, lossless migration).
- **Plugin management in Settings** (same 0.2.6): **Import plugin…** (.zip built from a plugin folder; duplicate → overwrite confirm; invalid/too-large errors shown inline) and per-plugin **Uninstall** (removes folder + consent). Server: fflate-based extraction with traversal + zip-bomb guards, 20 MB cap, atomic swap-in.
- **Plugin panels, split by purpose** (same 0.2.6): panels declare `location: "settings"` (parameter controls, rendered inside Settings) or `"home"` (the plugin's own display, rendered on `/` as **collapsible lazy-mounted widget cards** with a zero-footprint empty state). Themed thin scrollbars + auto-height reporting fix the white native scrollbar and bottom clipping; a per-panel **Show on home page** toggle lives in Settings. `usage-stats` now ships as a home widget.

### 0.2.5 — plugins v1 · cost meter · encrypted config transfer · player polish
- **Player polish**: longer default preview text (with gentle migration); editing the preview text applies on the next Play (unchanged text still resumes); short/dictionary cards reserve space so ✕/Esc never overlap the word.
- **Pin-on-interaction**: clicking or wheeling the subtitle pins it (no auto-hide) — the bottom-right slot shows a lock instead of the progress bar; Esc/✕ dismiss; test-mode ✅ never pins.
- **Plugins v1** (approved design): local plugins under `<userData>/plugins` (dev `.subtr-plugins/`) — manifest (`apiVersion`, `minAppVersion`, `capabilities`, `contributes`), capability-scoped API (`translate.transformInput` / `transformOutput` / `dictionary.source` + declarative provider presets), per-capability consent dialog, 2 s hook timeout with auto-disable after two consecutive failures, dev hot reload, `GET /api/plugins` + `POST /api/plugins/:id` + `GET /api/dictionary`; sample plugins in `examples/plugins/` (uppercase pre/post-processor, declarative Acme provider).
- **Cost meter**: token-usage capture (`stream_options.include_usage` + extended retry chain + chars/4 estimate fallback), `~/.subtr/stats.json` store, `/api/stats`, and a bottom **status bar** on the home page (cost / calls / translations / tokens, `~` estimate marker); per-preset pricing from models.dev (Moonshot default → `kimi-k3`; OpenCode Go carries a subscription note).
- **Config export/import**: passphrase-protected file `subtr-config-<date>.json`; API keys encrypted (AES-GCM 256, PBKDF2-SHA256 310k iterations, per-value IV) and never in plaintext; import is atomic and refreshes the settings UI live; legacy bare-envelope files remain importable.
- Also: the client dictionary falls back to plugin dictionary sources (`/api/dictionary`) on a bundled-dictionary miss.

### 0.2.4 — dictionary · player rework · hotkey · tray
- **Single-word dictionary**: ECDICT (MIT) top-30k bundled offline (`public/dict/`, ~3.9 MB, buildable via `npm run dict:build`); single Latin-word selections resolve locally with phonetics + senses — no LLM, works without an API key; misses fall through to the LLM flow.
- **Hold-phase progress bar** at the card's bottom-right during the initial hold and the final hold.
- **Title bar follow-system fix**: switching dark→Follow system now updates the macOS title bar (`setNativeTheme("system")` reaches the bridge).
- **Test-connection flavor text**: <500 ms "Fast as lightning ⚡" / 500–1000 ms "traversing the worldwide web 🌐" / >1000 ms "geostationary space 🛰️" (en + zh).
- **Position board rework**: canvas is position-only (no text in the box) with six presets and center-snap guides (vertical/horizontal) during drag; the separate Test button is gone — one **Play** drives a REAL subtitle on the overlay screen with play/pause/seek, live state readout and metrics; dragging the real card pauses playback, moves it with the same guides/snap, and a ✅ button locks the position and resumes playback; browser fallback plays in-window. Play after Pause resumes (no restart).
- **Customizable global hotkey** (default `⌘⇧T`, macOS glyph display, `event.code` recording, reserved-combo blocklist, conflict handling with fallback suggestions, reset to default): toggles translation mode everywhere.
- **Tray icon**: macOS template icon, idle/active states with a short burst animation on change; menu (Show / Toggle translation [checkbox] / Settings ⌘, / Quit); the app stays resident when all windows close.
- Fixes: Esc-dismiss no longer re-triggers the selection lookup (Escape keyup ignored); reader empty-state hydration mismatch (mount-gated).
