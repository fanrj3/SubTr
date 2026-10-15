# SubTr

Subtitle-style translation for anything you read in the browser — and on your whole desktop. Paste text, turn translation mode on, select a passage, and the translation appears at the bottom of the screen like a video subtitle.

Simple, light, cross-platform: runs anywhere Node.js runs (macOS, Windows, Linux, or any server), as a web app or as an Electron desktop app. No build tools beyond npm.

## Requirements

- Node.js 20.9+ (tested on Node 26)
- npm

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Usage

1. Paste or type text into the reader (click the empty area, or use **Edit** later).
2. Open **Settings** (a full page with a section nav rail: **Translate / Subtitle / Plugins / App**). **Translate** holds **Profiles** — multiple API setups you can switch between without losing the others, with **Export / Import config** to move them between machines (API keys are encrypted with a passphrase, AES-GCM, never exported in plaintext) — plus the provider picker, key, model and a **Test connection** button; **Thinking** controls the model's reasoning per profile (Preset default / Off / Low / Medium / High) — translation usually wants **Off**. **Subtitle** tunes timing (initial hold, minimum display, reading pace from 0.2× to 5×, final hold) and appearance (drag the box on the mini display to reposition; font, size, text/background color, opacity) — with a **Play** that plays the subtitle on your real screen (desktop: the system overlay) with live style updates, plus a scrubber, editable test text and live metrics. **App** switches the **theme** and the **UI language** and records the **global hotkey** (under Advanced). The home page shows a bottom **status bar** with your estimated LLM spend (cost, calls, translations, tokens) and any **plugin widgets** (collapsible plugin panels) you enable.
3. Toggle **Translate** on in the top bar.
4. Select any passage in the reader — the translation streams into a subtitle card. Long translations scroll like a teleprompter: a short hold at the top, then a scroll paced to the text length and reading speed, then a brief hold before auto-hiding. Scroll with the wheel to interrupt — the subtitle then stays until you press **Esc**. Translations render Markdown (lists, bold, code) when the model outputs it.

The target language is chosen in the top bar — default **Auto**: mostly-CJK text is translated to English, everything else to 中文（简体）. Pick a specific language to override. `⌘/Ctrl+Shift+D` on desktop re-triggers a capture manually.

## Built-in providers

All presets are OpenAI-compatible endpoints (models verified Oct 2026):

OpenAI, OpenCode Go, Anthropic (Claude), Google Gemini, DeepSeek, OpenRouter, Groq, xAI (Grok), Mistral, Moonshot (Kimi), Zhipu (GLM), Alibaba Qwen (DashScope), SiliconFlow — plus local **Ollama** (`http://localhost:11434/v1`) and **LM Studio** (`http://localhost:1234/v1`), which need no API key. **Custom** accepts any OpenAI-compatible endpoint.

Notes:

- OpenCode Go: uses your OpenCode Go subscription key; the required `x-opencode-session` header and an app User-Agent are sent automatically.
- Moonshot: CN keys use `api.moonshot.cn`, international keys use `api.moonshot.ai`.
- DashScope: CN keys use `dashscope.aliyuncs.com`, international keys use `dashscope-intl.aliyuncs.com`.
- Local servers: pull the model first (Ollama); LM Studio accepts any model id string for the loaded model.

## How it works

```
browser ── POST /api/translate ──▶ local Next.js route ──▶ your LLM endpoint
```

The API key you enter stays in your browser (localStorage) and is sent only with the request you configure, forwarded through the app's own server route (which also avoids CORS and mixed-content limits, including for `http://localhost` LLM servers).

## Desktop app (Electron)

The same app runs as a desktop app (macOS / Windows / Linux). It opens the reader window and additionally monitors text selections system-wide: select text in **any** app and the translation appears as a subtitle at the bottom of your screen in a transparent, click-through overlay. Long translations scroll like a teleprompter; hovering over the subtitle makes it interactive (wheel to interrupt auto-scroll), and while it is waiting for dismissal the overlay arms a global **Esc**. `⌘/Ctrl+Shift+D` re-triggers a capture manually (useful when selection monitoring is unavailable). The tray icon opens a quick menu — translation toggle, **Voice translation (Beta)** and a **Usage** submenu with today's and all-time cost/calls/translations.

```bash
npm run desktop        # build + launch the desktop app
npm run desktop:dev    # dev mode (Next dev server + Electron)
npm run dist:mac       # package a macOS .dmg (arm64) → dist/
npm run dist:win       # Windows NSIS installer (build via Docker/Windows on Apple Silicon)
npm run dist:linux     # Linux AppImage (Docker recommended)
```

Notes:

- macOS: the first launch asks for **Accessibility** permission (System Settings → Privacy & Security → Accessibility) — required to read selections from other apps.
- The Windows installer and Linux AppImage are configured but not built/tested from this macOS machine; electron-builder's Wine path is unreliable on Apple Silicon — use Docker (`electronuserland/builder:wine`) or build on those platforms.
- Builds are unsigned. macOS: if Gatekeeper blocks the app, run `xattr -dr com.apple.quarantine /Applications/SubTr.app` or use System Settings → Privacy & Security → "Open Anyway". Windows: SmartScreen → "More info → Run anyway". Linux: `chmod +x SubTr-*.AppImage`.
- Linux: selection monitoring works on X11; Wayland support is limited (always-on-top and global shortcuts depend on the compositor).
- Closing the app window quits the app (v1 behavior).

**Voice → translated subtitles (Beta):** enable it from the **tray icon** or **Settings → Voice** (master toggle, live status, per-model **Download** with progress, setup hints) — SubTr captures system audio (no virtual device needed), transcribes it locally with whisper.cpp (Metal) and shows the translation through the same subtitle overlay, so an English video plays with subtitles in your language. Captions run as a **rolling transcript**: finished sentences stay on screen, the current one fills in live at the bottom, and older lines scroll up — nothing disappears until you turn voice mode off; translations stream into the live line and are coalesced so rapid updates don't spam the model. Models install into `~/Library/Application Support/subtr/whisper/` (sha256 + size verified, resume-safe); missing assets show **Setup needed** with a one-click download. Needs the Screen Recording permission. (On macOS 26 the default Core Audio tap loopback returns a dead track — SubTr forces the working ScreenCaptureKit backend automatically; verified end-to-end with real audible audio.)

## Plugins

SubTr loads local plugins from a folder (desktop: the app's data folder `plugins/`; development: `.subtr-plugins/`) — or install them right in **Settings → Plugins → Import plugin…** (pick a `.zip` built from a plugin folder), with enable/disable and uninstall per plugin. Panels declared `location: "home"` appear on the home page directly below the reader as collapsible cards (toggle them under Settings → Plugins); `location: "settings"` panels render inside Settings for parameter control. Each plugin is a folder with a `manifest.json` and optionally an `index.cjs` entry. Capabilities are granted per plugin at enable time in **Settings → Plugins**:

- **translate.transformInput / translate.transformOutput** — rewrite the selected text before translation, or the translation before it is shown
- **dictionary.source** — provide dictionary lookups (used when the bundled dictionary misses)
- **Provider presets** — a plugin can contribute a provider declaratively (no code)
- **Host capabilities (API v2)** — region-capture overlay (`capture.region`), highlight regions over an image with hover/select events (`overlay.regions`), verbatim subtitle text (`overlay.subtitle`), translation through your active profile (`translate.text`, keys never leave the app), and plugin-level global hotkeys (`hotkey.register`). See `examples/plugins/README.md`.

In progress: an **image translation** plugin project (⌘⇧P region capture → OCR → Live-Text-style highlights with hover-to-translate) — spec in `examples/plugins/image-translate/`, phased plan in `docs/image-translate-plugin.md`.

Plugins run as local Node code with full access to your machine — only enable plugins you trust. Panel authors get a theme-aware **component kit** at `/plugin-kit/panel.css` and a live **panel preview** (`/panel-preview/<id>/<panelId>`, with theme and width switchers reachable from the **Preview** action in Settings) — see `examples/plugins/README.md`. Ready-to-import packages live in **`examples/plugin-zips/`** (`usage-stats.zip`, `uppercase.zip`, `acme-translate.zip`); regenerate them with `npm run plugins:zip` after editing the examples.

## Security notes

- The key is stored in plaintext in localStorage. That is fine for a local/personal tool; don't use it on a shared machine or a public deployment you don't control.
- If you deploy this app publicly, `/api/translate` becomes an open proxy to arbitrary URLs (anyone could use it to reach internal services). Run it locally or behind auth.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
npx tsc --noEmit  # type check
```

Built with Next.js (App Router) · React · TypeScript · Tailwind CSS · Base UI. The UI follows the design contract in `DESIGN.md`.
