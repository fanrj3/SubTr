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
});
