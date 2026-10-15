// Voice → translated subtitles (Beta, phase 1) — client module barrel.
//
// See protocol.ts for the shared vocabulary and capture.ts for the canonical
// renderer capture. The runnable spine (loopback flags, whisper-server,
// rolling-window chunking/commit, overlay hand-off, tray Beta trigger) lives in
// desktop/main.cjs + desktop/voice-pipeline.cjs.

export {
  VOICE_SAMPLE_RATE,
  VOICE_FLUSH_SAMPLES,
  VOICE_WINDOW_MS,
  VOICE_HOP_MS,
  VOICE_MODE_KEY,
} from "./protocol";
export type {
  VoiceStatus,
  VoiceSetupStatus,
  VoiceSnapshot,
  DesktopVoiceBridge,
} from "./protocol";
export {
  getVoiceBridge,
  isVoiceCapturing,
  startVoiceCapture,
  stopVoiceCapture,
  toggleVoiceCapture,
} from "./capture";
