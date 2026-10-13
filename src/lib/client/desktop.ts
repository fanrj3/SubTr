export type DesktopBridge = {
  isDesktop: true;
  onCapture(cb: (payload: { text: string }) => void): () => void;
  setOverlayInteractive?(on: boolean): void;
  setEscArmed?(on: boolean): void;
  onEsc?(cb: () => void): () => void;
};

declare global {
  interface Window {
    subtrDesktop?: DesktopBridge;
  }
}

export function isDesktopMode(): boolean {
  return typeof window !== "undefined" && window.subtrDesktop?.isDesktop === true;
}
