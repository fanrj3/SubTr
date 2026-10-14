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
    // Ready handshake: main will flush any capture held while we were not subscribed.
    try {
      ipcRenderer.send("subtr:capture-listener-ready");
    } catch (error) {
      console.error("[subtrDesktop] capture-listener-ready failed", error);
    }
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

  /**
   * Capture a thumbnail of the primary desktop screen as a PNG data URL.
   * Resolves to null when unavailable (e.g. no Screen Recording permission).
   * @returns {Promise<string | null>}
   */
  captureDesktopThumbnail() {
    return ipcRenderer.invoke("subtr:capture-desktop");
  },

  /**
   * Sync the OS/native window chrome to the app theme.
   * @param {"system" | "light" | "dark"} theme
   */
  setNativeTheme(theme) {
    if (theme !== "system" && theme !== "light" && theme !== "dark") return;
    ipcRenderer.send("subtr:set-native-theme", theme);
  },

  /**
   * Play a subtitle on the real screen (overlay window). For the "Test" button.
   * @param {string} text
   */
  showTestSubtitle(text) {
    if (typeof text !== "string") return;
    if (!text.trim()) return;
    ipcRenderer.send("subtr:test-subtitle", { text });
  },
});
