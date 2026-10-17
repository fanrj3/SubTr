export type VoiceSetup = {
  ready: boolean;
  server: string;
  model: string;
  silero: string;
  serverPresent: boolean;
  modelPresent: boolean;
  vadPresent: boolean;
  missing: string[];
};

export type VoiceModel = {
  id: string;
  kind: string;
  label: string;
  file: string;
  bytes: number;
  sha256: string;
  path: string;
  present: boolean;
};

export type VoiceDownloadProgress = {
  active: boolean;
  id: string | null;
  percent: number;
  received: number;
  total: number;
  error: string | null;
};

export type VoiceSnapshot = {
  status: string;
  active: boolean;
  wanted: boolean;
  shimReady: boolean;
  serverReady: boolean;
  serverPort: number;
  serverPid: number;
  serverRestarts: number;
  setup: VoiceSetup;
  error?: string;
};

export type DesktopBridge = {
  isDesktop: true;
  onCapture(
    cb: (payload: {
      text: string;
      source?: string;
      voice?: boolean;
      utteranceId?: string;
      close?: boolean;
      stop?: boolean;
      pluginText?: boolean;
      tone?: "normal" | "muted";
      stickyMs?: number;
      pluginOverlay?: "clear";
    }) => void
  ): () => void;
  setOverlayInteractive?(on: boolean): void;
  overlayActions?(payload: {
    pinned: boolean;
    hovered: boolean;
    menuOpen: boolean;
    canInsert: boolean;
    text: string;
  }): void;
  onOverlayActionResult?(
    cb: (payload: { action: string; ok?: boolean }) => void
  ): () => void;
  overlayAction?(action: "copy" | "insert"): void;
  openMainWindow?(): void;
  setEscArmed?(on: boolean): void;
  setNativeTheme?(theme: string): void;
  showTestSubtitle?(text: string): void;
  setToggleHotkey?(
    accel: string,
    options?: { allowFallback?: boolean }
  ): Promise<{ ok: boolean; accelerator?: string; fallback?: boolean; error?: string }>;
  onToggleMode?(cb: (payload: { enabled?: boolean }) => void): () => void;
  syncMode?(enabled: boolean): void;
  setMode?(enabled: boolean): void;
  requestToggleMode?(): void;
  setTrayState?(enabled: boolean): void;
  controlTestPlay?(payload: { action: "play" | "pause" | "seek"; timeMs?: number }): void;
  reportTestPlayState?(state: { playing: boolean; timeMs: number; totalMs: number }): void;
  onTestPlayControl?(
    cb: (payload: { action: "play" | "pause" | "seek"; timeMs?: number }) => void
  ): () => void;
  onTestPlayState?(
    cb: (state: { playing: boolean; timeMs: number; totalMs: number }) => void
  ): () => void;
  voiceSetup?(): Promise<VoiceSetup>;
  voiceGetState?(): Promise<VoiceSnapshot>;
  voiceSetEnabled?(enabled: boolean): Promise<VoiceSnapshot>;
  voiceModels?(): Promise<VoiceModel[]>;
  downloadVoiceModel?(
    id: string
  ): Promise<{ ok: boolean; id?: string; bytes?: number; sha256?: string; error?: string }>;
  onVoiceDownloadProgress?(cb: (progress: VoiceDownloadProgress) => void): () => void;
  onVoiceToggle?(cb: (on: boolean) => void): () => void;
  onEsc?(cb: () => void): () => void;
  captureDesktopThumbnail?: () => Promise<string | null>;
};

declare global {
  interface Window {
    subtrDesktop?: DesktopBridge;
  }
}

export function isDesktopMode(): boolean {
  return typeof window !== "undefined" && window.subtrDesktop?.isDesktop === true;
}
