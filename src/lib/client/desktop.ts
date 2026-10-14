export type DesktopBridge = {
  isDesktop: true;
  onCapture(cb: (payload: { text: string; source?: string }) => void): () => void;
  setOverlayInteractive?(on: boolean): void;
  setEscArmed?(on: boolean): void;
  setNativeTheme?(theme: string): void;
  showTestSubtitle?(text: string): void;
  setToggleHotkey?(accel: string): Promise<{ ok: boolean; error?: string }>;
  onToggleMode?(cb: () => void): () => void;
  setTrayState?(enabled: boolean): void;
  controlTestPlay?(payload: { action: "play" | "pause" | "seek"; timeMs?: number }): void;
  reportTestPlayState?(state: { playing: boolean; timeMs: number; totalMs: number }): void;
  onTestPlayControl?(
    cb: (payload: { action: "play" | "pause" | "seek"; timeMs?: number }) => void
  ): () => void;
  onTestPlayState?(
    cb: (state: { playing: boolean; timeMs: number; totalMs: number }) => void
  ): () => void;
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
