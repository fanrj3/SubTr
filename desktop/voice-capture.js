/* eslint-disable @typescript-eslint/no-unused-expressions -- injected renderer shim: bare expressions are the audio-worklet/bridge protocol, not dead code */
// SubTr voice capture shim (Phase 1 prototype).
//
// Injected into the main (reader) window by desktop/main.cjs via
// webContents.executeJavaScript when the "Voice translation (Beta)" trigger is
// used. It is plain JS on purpose: the reader window is context-isolated and
// sandboxed (no nodeIntegration), so it cannot `require` the TypeScript module
// in src/lib/client/voice/ — the canonical source of that logic is capture.ts,
// and this file is its runnable, injection-safe equivalent.
//
// Responsibilities:
//   - Ask the main process to install the macOS loopback display-media handler
//     (electron-audio-loopback: enable-loopback-audio).
//   - getDisplayMedia({video,audio}) and drop the video track.
//   - Resample system audio to 16 kHz mono via AudioContext({sampleRate:16000})
//     and an AudioWorklet (48 kHz device → 16 kHz context is resampled by
//     Chromium), emitting Int16 PCM frames to the main process.
//
// The main process owns whisper-server, rolling-window chunking, commit and the
// overlay hand-off (see desktop/voice-pipeline.cjs + desktop/main.cjs).

(function () {
  if (window.__subtrVoiceCapture) return;
  const bridge = window.subtrDesktop;
  if (!bridge) return;

  const SAMPLE_RATE = 16000;
  const FLUSH_SAMPLES = 1600; // ~100 ms of 16 kHz audio per IPC message
  const MODE_KEY = "subtr.mode.v1";

  // Keep this in sync with desktop/voice-pipeline.cjs (VOICE_SAMPLE_RATE).
  const WORKLET_SRC = `
    class SubtrPcmProcessor extends AudioWorkletProcessor {
      constructor() { super(); this._acc = new Float32Array(0); }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch && ch.length) {
          const merged = new Float32Array(this._acc.length + ch.length);
          merged.set(this._acc, 0);
          merged.set(ch, this._acc.length);
          let off = 0;
          const FLUSH = ${FLUSH_SAMPLES};
          while (merged.length - off >= FLUSH) {
            const out = new Int16Array(FLUSH);
            for (let i = 0; i < FLUSH; i++) {
              const s = Math.max(-1, Math.min(1, merged[off + i]));
              out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            this.port.postMessage(out.buffer, [out.buffer]);
            off += FLUSH;
          }
          this._acc = merged.slice(off);
        }
        return true;
      }
    }
    registerProcessor('subtr-pcm', SubtrPcmProcessor);
  `;

  const state = {
    active: false,
    ctx: null,
    stream: null,
    node: null,
    source: null,
    sink: null,
    moduleUrl: null,
    savedModeRaw: null,
    modeTouched: false,
  };

  function log(message) {
    try {
      bridge.voiceLog && bridge.voiceLog(String(message));
    } catch {
      /* ignore */
    }
  }

  function status(value) {
    try {
      bridge.voiceStatus && bridge.voiceStatus(value);
    } catch {
      /* ignore */
    }
  }

  // The overlay only renders captured text when Translate mode is on. Voice mode
  // implies "show subtitles", so we flip the shared localStorage flag (which the
  // overlay observes via its `storage` listener) and restore it on stop.
  function enableModeForVoice() {
    try {
      state.savedModeRaw = window.localStorage.getItem(MODE_KEY);
      const already = state.savedModeRaw === "true";
      if (!already) {
        window.localStorage.setItem(MODE_KEY, "true");
        state.modeTouched = true;
        log("translate mode enabled for voice");
      }
    } catch (err) {
      log("mode enable failed: " + (err && err.message ? err.message : String(err)));
    }
  }

  function restoreMode() {
    if (!state.modeTouched) return;
    try {
      if (state.savedModeRaw === null) window.localStorage.removeItem(MODE_KEY);
      else window.localStorage.setItem(MODE_KEY, state.savedModeRaw);
    } catch {
      /* ignore */
    }
    state.modeTouched = false;
  }

  async function start() {
    if (state.active) return;
    state.active = true;
    status("starting");
    enableModeForVoice();

    let stream = null;
    try {
      if (!bridge.voiceEnableLoopback) {
        throw new Error("loopback bridge unavailable (preload not loaded?)");
      }
      await bridge.voiceEnableLoopback();
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // Chromium's screen-share video is not used; drop it immediately.
      for (const track of stream.getVideoTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
        stream.removeTrack(track);
      }
      if (!stream.getAudioTracks().length) {
        throw new Error("no loopback audio track returned");
      }
      const loopTrack = stream.getAudioTracks()[0];
      try {
        const settings = loopTrack.getSettings ? loopTrack.getSettings() : {};
        log("loopback track: " + JSON.stringify({ label: loopTrack.label, ...settings }));
      } catch {
        /* ignore */
      }
    } catch (err) {
      log("capture start failed: " + (err && err.message ? err.message : String(err)));
      try {
        stream && stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      await stop({ keepStatus: false, error: true });
      return;
    } finally {
      try {
        bridge.voiceDisableLoopback && (await bridge.voiceDisableLoopback());
      } catch {
        /* ignore */
      }
    }

    try {
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      const moduleUrl = URL.createObjectURL(
        new Blob([WORKLET_SRC], { type: "application/javascript" }),
      );
      await ctx.audioWorklet.addModule(moduleUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "subtr-pcm");
      node.port.onmessage = (event) => {
        try {
          bridge.voiceAudio && bridge.voiceAudio(event.data);
        } catch {
          /* ignore */
        }
      };
      // A muted sink keeps the graph pulling without echoing system audio.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      state.ctx = ctx;
      state.stream = stream;
      state.node = node;
      state.source = source;
      state.sink = sink;
      state.moduleUrl = moduleUrl;

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) audioTrack.onended = () => void stop({});

      status("listening");
      log("capture running at " + ctx.sampleRate + " Hz");
    } catch (err) {
      log("audio graph failed: " + (err && err.message ? err.message : String(err)));
      await stop({ error: true });
    }
  }

  async function stop(options) {
    const opts = options || {};
    state.active = false;
    try {
      if (state.node) state.node.port.onmessage = null;
    } catch {
      /* ignore */
    }
    try {
      state.source && state.source.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.node && state.node.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.sink && state.sink.disconnect();
    } catch {
      /* ignore */
    }
    try {
      state.stream && state.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      if (state.ctx) await state.ctx.close();
    } catch {
      /* ignore */
    }
    try {
      if (state.moduleUrl) URL.revokeObjectURL(state.moduleUrl);
    } catch {
      /* ignore */
    }
    state.ctx = state.stream = state.node = state.source = state.sink = state.moduleUrl = null;
    restoreMode();
    if (!opts.keepStatus) status(opts.error ? "error" : "off");
  }

  function toggle(on) {
    if (on) void start();
    else void stop({});
  }

  try {
    bridge.onVoiceToggle && bridge.onVoiceToggle(toggle);
  } catch (err) {
    log("failed to subscribe to voice toggle: " + (err && err.message ? err.message : String(err)));
  }

  window.__subtrVoiceCapture = {
    start: () => start(),
    stop: () => stop({}),
    toggle,
    get active() {
      return state.active;
    },
  };

  // Tell the main process the shim is live so it can flush a queued toggle
  // (the tray trigger may fire before this script finishes injecting).
  try {
    bridge.voiceShimReady && bridge.voiceShimReady();
  } catch {
    /* ignore */
  }
  log("voice capture shim installed");
})();
