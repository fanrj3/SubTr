export type DesktopBridge = {
  isDesktop: true;
  onCapture(cb: (payload: { text: string; source?: string }) => void): () => void;
  setOverlayInteractive?(on: boolean): void;
  setEscArmed?(on: boolean): void;
  setNativeTheme?(theme: string): void;
  showTestSubtitle?(text: string): void;
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
