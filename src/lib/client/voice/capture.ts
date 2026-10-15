"use client";

// Voice → translated subtitles (Beta, phase 1) — canonical renderer capture.
//
// This is the typed, canonical implementation of the loopback capture layer:
// enable the macOS loopback display-media handler, getDisplayMedia({audio}),
// drop the video track, and resample to 16 kHz mono via
// `new AudioContext({ sampleRate: 16000 })` + an AudioWorklet that emits Int16
// PCM frames to the main process over the preload bridge.
//
// NOTE: for phase 1 the reader window is context-isolated/sandboxed and this
// lane does not own the renderer files, so the *running* capture is the plain-JS
// equivalent injected by desktop/main.cjs (desktop/voice-capture.js). This
// module is the source of truth for the logic; once a renderer file can import
// it, wiring is `getVoiceBridge()?.onVoiceToggle(toggleVoiceCapture)`.

import {
  VOICE_FLUSH_SAMPLES,
  VOICE_MODE_KEY,
  VOICE_SAMPLE_RATE,
  type DesktopVoiceBridge,
} from "./protocol";

export function getVoiceBridge(): DesktopVoiceBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { subtrDesktop?: DesktopVoiceBridge }).subtrDesktop;
  return bridge && bridge.isDesktop === true ? bridge : null;
}

const WORKLET_SOURCE = `
class SubtrPcmProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._acc = new Float32Array(0); }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const merged = new Float32Array(this._acc.length + channel.length);
      merged.set(this._acc, 0);
      merged.set(channel, this._acc.length);
      let offset = 0;
      const flush = ${VOICE_FLUSH_SAMPLES};
      while (merged.length - offset >= flush) {
        const out = new Int16Array(flush);
        for (let i = 0; i < flush; i++) {
          const s = Math.max(-1, Math.min(1, merged[offset + i]));
          out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        offset += flush;
      }
      this._acc = merged.slice(offset);
    }
    return true;
  }
}
registerProcessor('subtr-pcm', SubtrPcmProcessor);
`;

type VoiceSession = {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  sink: GainNode;
  moduleUrl: string;
  savedModeRaw: string | null;
  modeTouched: boolean;
};

let session: VoiceSession | null = null;

function log(message: string): void {
  getVoiceBridge()?.voiceLog?.(message);
}

/** Set the shared Translate-mode flag and report whether we changed it. */
function enableModeForVoice(): { savedModeRaw: string | null; modeTouched: boolean } {
  try {
    const savedModeRaw = window.localStorage.getItem(VOICE_MODE_KEY);
    if (savedModeRaw !== "true") {
      window.localStorage.setItem(VOICE_MODE_KEY, "true");
      return { savedModeRaw, modeTouched: true };
    }
    return { savedModeRaw, modeTouched: false };
  } catch {
    return { savedModeRaw: null, modeTouched: false };
  }
}

function writeMode(raw: string | null): void {
  try {
    if (raw === null) window.localStorage.removeItem(VOICE_MODE_KEY);
    else window.localStorage.setItem(VOICE_MODE_KEY, raw);
  } catch {
    // ignore
  }
}

export function isVoiceCapturing(): boolean {
  return session !== null;
}

export async function startVoiceCapture(): Promise<void> {
  if (session) return;
  const bridge = getVoiceBridge();
  if (!bridge?.voiceEnableLoopback) throw new Error("loopback bridge unavailable");

  bridge.voiceStatus?.("starting");
  const mode = enableModeForVoice();

  let stream: MediaStream | null = null;
  try {
    await bridge.voiceEnableLoopback();
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    for (const track of stream.getVideoTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    if (stream.getAudioTracks().length === 0) throw new Error("no loopback audio track returned");
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    if (mode.modeTouched) writeMode(mode.savedModeRaw);
    bridge.voiceStatus?.("error");
    throw error;
  } finally {
    try {
      await bridge.voiceDisableLoopback?.();
    } catch {
      // ignore
    }
  }

  const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  const moduleUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  );
  await ctx.audioWorklet.addModule(moduleUrl);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "subtr-pcm");
  node.port.onmessage = (event: MessageEvent) => {
    bridge.voiceAudio?.(event.data as ArrayBuffer);
  };
  const sink = ctx.createGain();
  sink.gain.value = 0; // muted sink keeps the graph pulling without echoing
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  session = {
    ctx,
    stream,
    node,
    source,
    sink,
    moduleUrl,
    savedModeRaw: mode.savedModeRaw,
    modeTouched: mode.modeTouched,
  };
  stream.getAudioTracks()[0]?.addEventListener("ended", () => void stopVoiceCapture());
  bridge.voiceStatus?.("listening");
  log(`capture running at ${ctx.sampleRate} Hz`);
}

export async function stopVoiceCapture(): Promise<void> {
  const current = session;
  if (!current) return;
  session = null;
  try {
    current.node.port.onmessage = null;
  } catch {
    // ignore
  }
  try {
    current.source.disconnect();
  } catch {
    // ignore
  }
  try {
    current.node.disconnect();
  } catch {
    // ignore
  }
  try {
    current.sink.disconnect();
  } catch {
    // ignore
  }
  try {
    current.stream.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore
  }
  try {
    await current.ctx.close();
  } catch {
    // ignore
  }
  try {
    URL.revokeObjectURL(current.moduleUrl);
  } catch {
    // ignore
  }
  if (current.modeTouched) writeMode(current.savedModeRaw);
  getVoiceBridge()?.voiceStatus?.("off");
}

/** Toggle helper suitable for `onVoiceToggle`. */
export function toggleVoiceCapture(on: boolean): void {
  if (on) void startVoiceCapture().catch((error) => log(String(error)));
  else void stopVoiceCapture();
}
