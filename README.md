# SubTr

Subtitle-style translation for anything you read in the browser. Paste text, turn translation mode on, select a passage, and the translation appears at the bottom of the screen like a video subtitle.

Simple, light, cross-platform: runs anywhere Node.js runs (macOS, Windows, Linux, or any server). No build tools beyond npm.

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
2. Open **Settings**, pick a provider, paste your API key, and hit **Test connection** to verify it works. The endpoint (**Base URL**), **Model**, and key are all editable; presets fill sensible defaults.
3. Toggle **Translate** on in the top bar.
4. Select any passage in the reader — the translation streams into a subtitle card at the bottom center. Press **×** or wait 20 seconds to dismiss it.

The target language is chosen in the top bar (default: English).

## Built-in providers

All presets are OpenAI-compatible endpoints (models verified Oct 2026):

OpenAI, Anthropic (Claude), Google Gemini, DeepSeek, OpenRouter, Groq, xAI (Grok), Mistral, Moonshot (Kimi), Zhipu (GLM), Alibaba Qwen (DashScope), SiliconFlow — plus local **Ollama** (`http://localhost:11434/v1`) and **LM Studio** (`http://localhost:1234/v1`), which need no API key. **Custom** accepts any OpenAI-compatible endpoint.

Notes:

- Moonshot: CN keys use `api.moonshot.cn`, international keys use `api.moonshot.ai`.
- DashScope: CN keys use `dashscope.aliyuncs.com`, international keys use `dashscope-intl.aliyuncs.com`.
- Local servers: pull the model first (Ollama); LM Studio accepts any model id string for the loaded model.

## How it works

```
browser ── POST /api/translate ──▶ local Next.js route ──▶ your LLM endpoint
```

The API key you enter stays in your browser (localStorage) and is sent only with the request you configure, forwarded through the app's own server route (which also avoids CORS and mixed-content limits, including for `http://localhost` LLM servers).

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
