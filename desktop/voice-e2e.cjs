// Phase-1 voice E2E driver (SUBTR_TEST).
//
// Boots the real app (desktop/main.cjs) with SUBTR_TEST=1, then drives the
// main-process automation hooks exposed by main.cjs:
//   __subtrVoiceSetup / __subtrTrayMenuLabels / __subtrVoiceTranscribe /
//   __subtrVoiceFeed / __subtrVoiceStart / __subtrVoiceStop / __subtrVoice
//
// Usage (from the repo root):
//   npx electron desktop/voice-e2e.cjs
//   SUBTR_VOICE_LIVE=1 npx electron desktop/voice-e2e.cjs   # also try loopback
//
// Prints a single JSON line prefixed with "E2E_RESULTS=" then quits.
//
// IMPORTANT: this harness is a dev tool. It is included in packaged builds only
// because desktop/** is globbed; it does nothing unless executed directly.

process.env.SUBTR_TEST = "1";
process.env.SUBTR_SELECTION_HOOK = "0"; // avoid the native hook during automation

const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app } = require("electron");

require("./main.cjs");

const WAV = process.env.SUBTR_VOICE_WAV || "/tmp/subtr-voice-16k.wav";
const LIVE = process.env.SUBTR_VOICE_LIVE === "1";

function log(...args) {
  console.log("[e2e]", ...args);
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      if (fn()) return true;
    } catch {
      // keep waiting
    }
    if (Date.now() - start > timeoutMs) {
      log(`timeout waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const results = { startedAt: new Date().toISOString() };
  try {
    // Hooks are installed synchronously at the top of start().
    await waitFor(() => typeof globalThis.__subtrVoice === "function", 20000, "voice hooks");

    results.setup = globalThis.__subtrVoiceSetup();
    await waitFor(() => (globalThis.__subtrTrayMenuLabels?.() || []).length > 0, 20000, "tray");
    results.trayMenu = globalThis.__subtrTrayMenuLabels();

    // 1) whisper-server STT of a real 16 kHz reference clip.
    if (fs.existsSync(WAV)) {
      const base64 = fs.readFileSync(WAV).toString("base64");
      const started = Date.now();
      results.transcribe = await globalThis.__subtrVoiceTranscribe(base64);
      results.transcribeMs = Date.now() - started;
    } else {
      results.transcribe = { ok: false, error: `missing ${WAV}` };
    }

    // 2) Commit + overlay hand-off using the real committer.
    const feeds = [
      "hello world this",
      "hello world this is a voice",
      "hello world this is a voice translation",
      "hello world this is a voice translation test",
    ];
    results.feeds = feeds.map((t) => ({ input: t, result: globalThis.__subtrVoiceFeed(t) }));

    // 3) Optional live loopback capture (permission-gated by macOS TCC).
    if (LIVE) {
      log("starting live loopback capture …");
      const before = globalThis.__subtrVoice();
      await globalThis.__subtrVoiceStart();

      // Play the reference clip through the system output several times.
      let player = null;
      const playOnce = () =>
        new Promise((resolve) => {
          player = spawn("afplay", [WAV]);
          player.on("exit", resolve);
          player.on("error", resolve);
        });
      for (let i = 0; i < 3; i++) {
        await playOnce();
        await sleep(500);
      }

      await sleep(2000);
      results.live = { before, after: globalThis.__subtrVoice() };
      globalThis.__subtrVoiceStop();
      await sleep(500);
      results.live.status = globalThis.__subtrVoice().status;
    }
  } catch (error) {
    results.error = error && error.stack ? error.stack : String(error);
  }

  console.log("E2E_RESULTS=" + JSON.stringify(results, null, 2));
  setTimeout(() => app.quit(), 300);
});

app.on("window-all-closed", () => {});
