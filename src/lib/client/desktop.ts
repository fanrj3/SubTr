export type DesktopBridge = {
  isDesktop: true;
  onCapture(cb: (payload: { text: string }) => void): () => void;
};

declare global {
  interface Window {
    subtrDesktop?: DesktopBridge;
  }
}

export function isDesktopMode(): boolean {
  return typeof window !== "undefined" && window.subtrDesktop?.isDesktop === true;
}
