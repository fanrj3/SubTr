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
2. Open **Settings**, pick a provider, paste your API key, and hit **Test connection** to verify it works. The endpoint (**Base URL**), **Model**, and key are all editable; presets fill sensible defaults. **Fast mode for short text** requests reduced reasoning for short selections on providers that support it (e.g. OpenCode Go's `deepseek-v4.1-flash`), making short translations noticeably quicker.
3. Toggle **Translate** on in the top bar.
4. Select any passage in the reader — the translation streams into a subtitle card at the bottom center. Long translations scroll like a teleprompter: a short hold at the top, then a scroll paced to the text length and reading speed, then a brief hold before auto-hiding. Scroll with the wheel to interrupt — the subtitle then stays until you press **Esc**.

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

The same app runs as a desktop app (macOS / Windows / Linux). It opens the reader window and additionally monitors text selections system-wide: select text in **any** app and the translation appears as a subtitle at the bottom of your screen in a transparent, click-through overlay. Long translations scroll like a teleprompter; hovering over the subtitle makes it interactive (wheel to interrupt auto-scroll), and while it is waiting for dismissal the overlay arms a global **Esc**. `⌘/Ctrl+Shift+D` re-triggers a capture manually (useful when selection monitoring is unavailable).

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

Built with Next.js (App Router) · React · TypeScript · Tailwind CSS.
