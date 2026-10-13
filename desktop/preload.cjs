// SubTr preload (CommonJS — sandboxed preloads cannot be ESM).
// Exposes a minimal, frozen bridge on both the reader and overlay windows.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("subtrDesktop", {
  isDesktop: true,
  /**
   * Subscribe to captured text selections pushed from the main process.
   * @param {(payload: { text: string }) => void} callback
   * @returns {() => void} unsubscribe
   */
  onCapture(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error("[subtrDesktop] onCapture callback failed", error);
      }
    };
    ipcRenderer.on("subtr:capture", listener);
    return () => ipcRenderer.removeListener("subtr:capture", listener);
  },

  /**
   * Overlay window only: toggle between click-through and interactive
   * (pointer over the card).
   * @param {boolean} on
   */
  setOverlayInteractive(on) {
    if (typeof on !== "boolean") return;
    ipcRenderer.send("subtr:overlay-interactive", on);
  },

  /**
   * Overlay window only: temporarily arm a one-shot global Escape.
   * @param {boolean} on
   */
  setEscArmed(on) {
    if (typeof on !== "boolean") return;
    ipcRenderer.send("subtr:esc-armed", on);
  },

  /**
   * Overlay window only: notified when the armed global Escape fired.
   * @param {() => void} callback
   * @returns {() => void} unsubscribe
   */
  onEsc(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => {
      try {
        callback();
      } catch (error) {
        console.error("[subtrDesktop] onEsc callback failed", error);
      }
    };
    ipcRenderer.on("subtr:esc", listener);
    return () => ipcRenderer.removeListener("subtr:esc", listener);
  },
});
