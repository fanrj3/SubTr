// Voice E2E driver (SUBTR_TEST).
//
// Boots the real app (desktop/main.cjs) with SUBTR_TEST=1, then drives the
// main-process automation hooks exposed by main.cjs:
//   __subtrVoiceSetup / __subtrTrayMenuLabels / __subtrVoiceTranscribe /
//   __subtrVoiceFeed / __subtrVoiceDeliveries / __subtrVoiceStart /
//   __subtrVoiceStop / __subtrVoice
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
const { app, BrowserWindow } = require("electron");

require("./main.cjs");

const WAV = process.env.SUBTR_VOICE_WAV || "/tmp/subtr-voice-long-16k.wav";
const LIVE = process.env.SUBTR_VOICE_LIVE === "1";

function log(...args) {
  console.log("[e2e]", ...args);
}

/** Summarise a delivery log: in-place growth, dedupe, closes, stops, gaps. */
function analyzeDeliveries(list) {
  const content = list.filter((d) => !d.stop);
  const stops = list.filter((d) => d.stop);
  const byUtterance = new Map();
  let adjacentIdentical = 0;
  let prevText = null;
  for (const d of content) {
    if (prevText !== null && d.text === prevText) adjacentIdentical += 1;
    prevText = d.text;
    if (!byUtterance.has(d.utteranceId)) {
      byUtterance.set(d.utteranceId, { id: d.utteranceId, count: 0, closes: 0, first: d.at, last: d.at, texts: [] });
    }
    const u = byUtterance.get(d.utteranceId);
    u.count += 1;
    if (d.close) u.closes += 1;
    u.last = d.at;
    u.texts.push(d.text);
  }
  const utt = [...byUtterance.values()].sort((a, b) => a.first - b.first);
  let growthViolations = 0;
  for (const u of utt) {
    for (let i = 1; i < u.texts.length; i++) {
      if (!u.texts[i].startsWith(u.texts[i - 1])) growthViolations += 1;
    }
  }
  const gaps = [];
  for (let i = 1; i < utt.length; i++) gaps.push(utt[i].first - utt[i - 1].last);
  // Ordered signal summary: "grow" | "close" | "stop".
  const signals = list.map((d) => (d.stop ? "stop" : d.close ? "close" : "grow"));
  return {
    deliveryCount: list.length,
    contentCount: content.length,
    closeCount: content.filter((d) => d.close).length,
    stopCount: stops.length,
    utteranceCount: utt.length,
    adjacentIdentical,
    growthViolations,
    interUtteranceGapsMs: gaps,
    signals,
    utterances: utt.map((u) => ({ id: u.id, deliveries: u.count, closes: u.closes, firstText: u.texts[0], lastText: u.texts[u.texts.length - 1] })),
  };
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

    // 2) Continuous in-place delivery through the real committer + delivery path
    //    (growth deliveries share one utteranceId; close delivery at silence).
    const feedSeq = [
      "the quick brown fox jumps",
      "the quick brown fox jumps over the lazy dog",
      "the quick brown fox jumps over the lazy dog it was very fast",
      "the quick brown fox jumps over the lazy dog it was very fast indeed",
      "", // first silence pass
      "", // second silence pass → close
    ];
    results.continuousFeed = {
      results: feedSeq.map((t) => globalThis.__subtrVoiceFeed(t)),
      deliveries: globalThis.__subtrVoiceDeliveries(),
    };
    results.continuousFeed.analysis = analyzeDeliveries(results.continuousFeed.deliveries);

    // 3) Model catalog + download flow (tiny Silero VAD exercises progress+sha256).
    results.models = globalThis.__subtrVoiceModels();
    results.download = await globalThis.__subtrVoiceDownload("silero-v6.2.0");
    results.modelsAfterDownload = globalThis.__subtrVoiceModels();

    // 4) Optional live loopback capture (permission/audio-routing gated).
    if (LIVE) {
      log("starting live loopback capture …");
      await globalThis.__subtrVoiceStart();

      // Play the long multi-sentence passage, let silence close the utterance,
      // then speak again → a second utterance (exercises continuity + close).
      const playOnce = () =>
        new Promise((resolve) => {
          const p = spawn("afplay", [WAV]);
          p.on("exit", resolve);
          p.on("error", resolve);
        });
      await playOnce();
      await sleep(5000); // trailing silence → close utterance 1
      await playOnce();
      await sleep(4000); // trailing silence → close utterance 2

      const deliveries1 = globalThis.__subtrVoiceDeliveries();
      results.live = {
        after: globalThis.__subtrVoice(),
        analysis: analyzeDeliveries(deliveries1),
        deliveries: deliveries1,
      };

      // Hardening: kill whisper-server mid-session → expect a bounded auto-restart.
      results.live.killedPid = globalThis.__subtrVoiceKillServer();
      await sleep(4000);
      results.live.afterKill = globalThis.__subtrVoice();

      // Session 1 OFF (tray/stop hook): exactly one stop, then no further deliveries.
      globalThis.__subtrVoiceStop();
      await sleep(1000);
      const afterStop1 = globalThis.__subtrVoiceDeliveries();
      await sleep(800);
      const afterStop1b = globalThis.__subtrVoiceDeliveries();
      results.live.stop1 = {
        stopCount: afterStop1.filter((d) => d.stop).length,
        stoppedAt: (globalThis.__subtrVoice() || {}).stoppedAt || 0,
        stableAfterStop: afterStop1.length === afterStop1b.length,
      };

      // Session 2 via the renderer bridge (voiceSetEnabled): clean re-enable with
      // no stale stop, then enable→disable emits exactly one stop.
      let win = null;
      for (let i = 0; i < 100 && !win; i++) {
        win = BrowserWindow.getAllWindows().find((w) => {
          if (w.isDestroyed()) return false;
          const u = w.webContents.getURL();
          return u.includes("127.0.0.1") && !u.includes("/overlay");
        });
        if (!win) await sleep(100);
      }
      const callSet = (v) =>
        win.webContents
          .executeJavaScript("window.subtrDesktop.voiceSetEnabled(" + v + ").then((s)=>JSON.stringify(s))")
          .then(JSON.parse);
      await callSet(true);
      await sleep(1500);
      const midSession2 = globalThis.__subtrVoiceDeliveries();
      await callSet(false);
      await sleep(700);
      const deliveries2 = globalThis.__subtrVoiceDeliveries();
      results.live.session2 = {
        stopsBeforeOff: midSession2.filter((d) => d.stop).length,
        stopCount: deliveries2.filter((d) => d.stop).length,
        deliveries: deliveries2.length,
      };
      results.live.status = globalThis.__subtrVoice().status;
    }
  } catch (error) {
    results.error = error && error.stack ? error.stack : String(error);
  }

  console.log("E2E_RESULTS=" + JSON.stringify(results, null, 2));
  setTimeout(() => app.quit(), 300);
});

app.on("window-all-closed", () => {});
