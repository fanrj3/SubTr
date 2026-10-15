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

  /**
   * Set the translation-toggle global hotkey (Electron accelerator).
   * @param {string} accel
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  setToggleHotkey(accel) {
    return ipcRenderer.invoke("subtr:set-toggle-hotkey", accel);
  },

  /**
   * Subscribe to translation-mode toggle requests (hotkey / tray menu).
   * @param {() => void} callback
   * @returns {() => void} unsubscribe
   */
  onToggleMode(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = () => {
      try {
        callback();
      } catch (error) {
        console.error("[subtrDesktop] onToggleMode callback failed", error);
      }
    };
    ipcRenderer.on("subtr:toggle-mode", listener);
    return () => ipcRenderer.removeListener("subtr:toggle-mode", listener);
  },

  /**
   * Report the current translate-mode state so the tray can reflect it.
   * @param {boolean} enabled
   */
  setTrayState(enabled) {
    if (typeof enabled !== "boolean") return;
    ipcRenderer.send("subtr:set-tray-state", enabled);
  },

  /**
   * Main window → overlay: transport control for the real-screen test player.
   * @param {{ action: "play" | "pause" | "seek", timeMs?: number }} payload
   */
  controlTestPlay(payload) {
    if (!payload || typeof payload !== "object") return;
    ipcRenderer.send("subtr:test-play-control", payload);
  },

  /**
   * Overlay → main window: playback-state report for the real-screen test player.
   * @param {{ playing: boolean, timeMs: number, totalMs: number }} payload
   */
  reportTestPlayState(payload) {
    if (!payload || typeof payload !== "object") return;
    ipcRenderer.send("subtr:test-play-state", payload);
  },

  /**
   * Overlay window only: subscribe to test-play transport controls.
   * @param {(payload: { action: "play" | "pause" | "seek", timeMs?: number }) => void} callback
   * @returns {() => void} unsubscribe
   */
  onTestPlayControl(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error("[subtrDesktop] onTestPlayControl callback failed", error);
      }
    };
    ipcRenderer.on("subtr:test-play-control", listener);
    return () => ipcRenderer.removeListener("subtr:test-play-control", listener);
  },

  /**
   * Main window only: subscribe to test-play playback-state reports.
   * @param {(payload: { playing: boolean, timeMs: number, totalMs: number }) => void} callback
   * @returns {() => void} unsubscribe
   */
  onTestPlayState(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      try {
        callback(payload);
      } catch (error) {
        console.error("[subtrDesktop] onTestPlayState callback failed", error);
      }
    };
    ipcRenderer.on("subtr:test-play-state", listener);
    return () => ipcRenderer.removeListener("subtr:test-play-state", listener);
  },

  // --- Voice→subtitle (Beta, phase 1) -------------------------------------

  /**
   * Ask the main process to install the loopback display-media handler
   * (electron-audio-loopback). Call before getDisplayMedia({audio:true}).
   * @returns {Promise<void>}
   */
  voiceEnableLoopback() {
    return ipcRenderer.invoke("enable-loopback-audio");
  },

  /** Tear down the loopback display-media handler after getDisplayMedia. */
  voiceDisableLoopback() {
    return ipcRenderer.invoke("disable-loopback-audio");
  },

  /**
   * Forward a chunk of 16 kHz mono s16le PCM to the main process pipeline.
   * @param {ArrayBuffer} buffer
   */
  voiceAudio(buffer) {
    if (!(buffer instanceof ArrayBuffer)) return;
    ipcRenderer.send("subtr:voice-audio", buffer);
  },

  /**
   * Report voice-capture status: "starting" | "listening" | "off" | "error".
   * @param {string} value
   */
  voiceStatus(value) {
    if (typeof value !== "string") return;
    ipcRenderer.send("subtr:voice-status", value);
  },

  /** Forward a diagnostic line to the main process log. @param {string} message */
  voiceLog(message) {
    if (typeof message !== "string") return;
    ipcRenderer.send("subtr:voice-log", message);
  },

  /**
   * Subscribe to voice-toggle requests from the tray menu (Beta trigger).
   * @param {(on: boolean) => void} callback
   * @returns {() => void} unsubscribe
   */
  onVoiceToggle(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, on) => {
      try {
        callback(on === true);
      } catch (error) {
        console.error("[subtrDesktop] onVoiceToggle callback failed", error);
      }
    };
    ipcRenderer.on("subtr:voice-toggle", listener);
    return () => ipcRenderer.removeListener("subtr:voice-toggle", listener);
  },

  /** Query voice setup availability (whisper-server + model present). */
  voiceSetup() {
    return ipcRenderer.invoke("subtr:voice-setup");
  },

  /**
   * Master voice toggle (settings Voice section). Idempotent on the main side.
   * @param {boolean} enabled
   * @returns {Promise<Record<string, unknown>>} the fresh voice snapshot
   */
  voiceSetEnabled(enabled) {
    return ipcRenderer.invoke("subtr:voice-set-enabled", enabled === true);
  },

  /** List the downloadable voice models with presence info. */
  voiceModels() {
    return ipcRenderer.invoke("subtr:voice-models");
  },

  /**
   * Download a voice model by id (progress arrives via onVoiceDownloadProgress).
   * @param {string} id
   * @returns {Promise<{ ok: boolean, id?: string, bytes?: number, sha256?: string, error?: string }>}
   */
  downloadVoiceModel(id) {
    return ipcRenderer.invoke("subtr:voice-download-model", id);
  },

  /**
   * Subscribe to voice-model download progress.
   * @param {(progress: { active: boolean, id: string | null, percent: number, received: number, total: number, error: string | null }) => void} callback
   * @returns {() => void} unsubscribe
   */
  onVoiceDownloadProgress(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => {
      try {
        callback(progress);
      } catch (error) {
        console.error("[subtrDesktop] onVoiceDownloadProgress callback failed", error);
      }
    };
    ipcRenderer.on("subtr:voice-download-progress", listener);
    return () => ipcRenderer.removeListener("subtr:voice-download-progress", listener);
  },

  /**
   * Handshake: the injected capture shim is installed and listening for
   * voice-toggle events. Lets the main process flush a queued toggle.
   */
  voiceShimReady() {
    ipcRenderer.send("subtr:voice-shim-ready");
  },
});
