// Voice → translated subtitles (Beta, phase 1) — shared protocol.
//
// This module is the typed vocabulary for the renderer/desktop voice feature.
// The constants mirror `desktop/voice-pipeline.cjs` (keep them in sync); the
// runnable spine lives in the main process for phase 1 because the voice
// pipeline needs whisper-server + the overlay hand-off, both of which are
// main-process concerns.

/** PCM sample rate produced by the renderer capture (Hz). */
export const VOICE_SAMPLE_RATE = 16000;
/** Samples per IPC frame (~100 ms at 16 kHz). */
export const VOICE_FLUSH_SAMPLES = 1600;
/** Rolling analysis window length (ms). Mirrors VOICE_WINDOW_MS. */
export const VOICE_WINDOW_MS = 5000;
/** Time between rolling analysis passes (ms). Mirrors VOICE_HOP_MS. */
export const VOICE_HOP_MS = 1500;
/** localStorage key for the shared Translate-mode flag. */
export const VOICE_MODE_KEY = "subtr.mode.v1";

export type VoiceStatus = "off" | "starting" | "listening" | "needs-setup" | "error";

export type VoiceSetupStatus = {
  ready: boolean;
  server: string;
  model: string;
  missing: string[];
};

/** Snapshot of the main-process voice pipeline (SUBTR_TEST / diagnostics). */
export type VoiceSnapshot = {
  status: VoiceStatus;
  active: boolean;
  wanted: boolean;
  serverReady: boolean;
  serverPort: number;
  passes: number;
  commits: number;
  pcmSamples: number;
  lastTranscript: string;
  lastCommit: string;
  lastCommitAt: number;
  setup: VoiceSetupStatus;
};

/** The voice-related slice of the `window.subtrDesktop` preload bridge. */
export type DesktopVoiceBridge = {
  isDesktop: true;
  voiceEnableLoopback?: () => Promise<void>;
  voiceDisableLoopback?: () => Promise<void>;
  voiceAudio?: (buffer: ArrayBuffer) => void;
  voiceStatus?: (value: VoiceStatus) => void;
  voiceLog?: (message: string) => void;
  onVoiceToggle?: (callback: (on: boolean) => void) => () => void;
  voiceSetup?: () => Promise<VoiceSetupStatus>;
};
