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
| **0.2.4** | *(in progress)* | Dictionary, hold progress bar, tray, global hotkey, position rework |

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
| Single-word dictionary (ECDICT offline; phonetics + senses; no LLM) | 0.2.4 | *(release commit)* | `src/lib/client/dictionary.ts`, `public/dict/`, `scripts/build-dict.mjs` |
| Subtitle hold-phase progress bar | 0.2.4 | *(release commit)* | `src/components/subtitle-overlay.tsx` |
| Position board: presets + center-snap guides (position-only box) | 0.2.4 | *(release commit)* | `src/components/position-player.tsx` |
| Real-screen player (Play drives the overlay; drag-pause; ✅ lock; resume) | 0.2.4 | *(release commit)* | `position-player.tsx`, `subtitle-overlay.tsx`, `src/app/overlay/page.tsx`, `desktop/main.cjs` |
| Test-connection latency flavor text (tiers + emoji) | 0.2.4 | *(release commit)* | `src/app/settings/page.tsx` |
| Customizable global hotkey (default ⌘⇧T; toggles translation mode) | 0.2.4 | *(release commit)* | `src/lib/client/hotkey.ts`, `src/components/hotkey-recorder.tsx`, `mode.ts`, `desktop/main.cjs` |
| Tray icon (idle/active + burst animation; resident app) | 0.2.4 | *(release commit)* | `desktop/tray-icons.cjs`, `desktop/main.cjs` |

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

### 0.2.4 — dictionary · player rework · hotkey · tray
- **Single-word dictionary**: ECDICT (MIT) top-30k bundled offline (`public/dict/`, ~3.9 MB, buildable via `npm run dict:build`); single Latin-word selections resolve locally with phonetics + senses — no LLM, works without an API key; misses fall through to the LLM flow.
- **Hold-phase progress bar** at the card's bottom-right during the initial hold and the final hold.
- **Title bar follow-system fix**: switching dark→Follow system now updates the macOS title bar (`setNativeTheme("system")` reaches the bridge).
- **Test-connection flavor text**: <500 ms "Fast as lightning ⚡" / 500–1000 ms "traversing the worldwide web 🌐" / >1000 ms "geostationary space 🛰️" (en + zh).
- **Position board rework**: canvas is position-only (no text in the box) with six presets and center-snap guides (vertical/horizontal) during drag; the separate Test button is gone — one **Play** drives a REAL subtitle on the overlay screen with play/pause/seek, live state readout and metrics; dragging the real card pauses playback, moves it with the same guides/snap, and a ✅ button locks the position and resumes playback; browser fallback plays in-window. Play after Pause resumes (no restart).
- **Customizable global hotkey** (default `⌘⇧T`, macOS glyph display, `event.code` recording, reserved-combo blocklist, conflict handling with fallback suggestions, reset to default): toggles translation mode everywhere.
- **Tray icon**: macOS template icon, idle/active states with a short burst animation on change; menu (Show / Toggle translation [checkbox] / Settings ⌘, / Quit); the app stays resident when all windows close.
- Fixes: Esc-dismiss no longer re-triggers the selection lookup (Escape keyup ignored); reader empty-state hydration mismatch (mount-gated).
