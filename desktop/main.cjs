// SubTr desktop main process (CommonJS).
//
// Responsibilities:
//   - Boot the Next.js standalone server (via utilityProcess, no `node` binary
//     required in packaged apps) or use SUBTR_DEV_URL in dev.
//   - Create the reader window and the transparent subtitle overlay window.
//   - Capture text selections system-wide (selection-hook) and forward them to
//     the overlay, plus a global hotkey + synthetic-copy fallback.
//
// The base URL / keys are user-supplied by design (local tool, no allowlist).

const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  systemPreferences,
  dialog,
  shell,
  screen,
  ipcMain,
  desktopCapturer,
  nativeTheme,
  nativeImage,
  Menu,
  Tray,
  utilityProcess,
} = require("electron");

const { buildFrames } = require("./tray-icons.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const DUPLICATE_WINDOW_MS = 1200;
const MANUAL_DEBOUNCE_MS = 400;
const CLIPBOARD_POLL_ATTEMPTS = 20;
const CLIPBOARD_POLL_INTERVAL_MS = 25;
const MAX_TEST_SUBTITLE_CHARS = 12000;
const MAX_HOTKEY_CHARS = 64;
const TRAY_FRAME_MS = 80;
const TRAY_GUID = "5a2e7c94-3f1b-4d6e-8a0c-2b7d9e4f1a35"; // stable tray identity (Electron requires UUID form)

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let overlayWindow = null;
/** @type {import("electron").UtilityProcess | null} */
let serverProcess = null;
/** @type {import("selection-hook") | null} */
let selectionHook = null;

let lastCapture = { text: "", at: 0 };
let lastManualAt = 0;
let manualBusy = false;
let quitting = false;
let escArmed = false;
/** True once the overlay renderer has subscribed via onCapture (ready handshake). */
let overlayListenerReady = false;
/** Latest capture that could not be delivered yet (single slot, latest wins). */
let pendingCapture = null;

/** @type {import("electron").Tray | null} */
let tray = null;
/** Lazily built tray frame set (resting + burst). */
let trayFrames = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let trayAnimTimer = null;
/** Currently registered translation-toggle hotkey (accelerator string). */
let toggleHotkeyAccel = null;
/** Latest translate-mode state reported by the renderer (tray idle vs active). */
let currentTrayMode = false;
/** Number of animation frames drawn (E2E introspection). */
let animateCount = 0;
/** Base URL of the running web app (for navigating the main window). */
let appBaseUrl = "";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pick a free TCP port by binding to 0 on the loopback interface. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Poll a URL until it responds 2xx (or throw on timeout). */
async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${url}`);
    }
    await delay(250);
  }
}

// ---------------------------------------------------------------------------
// Capture pipeline (main process)
// ---------------------------------------------------------------------------

/**
 * Trim + dedupe + forward a captured text selection to the overlay window.
 * Empty/whitespace payloads are ignored.
 * @param {{ text?: unknown }} payload
 */
function handleCapture(payload) {
  if (!payload || typeof payload.text !== "string") return;
  const text = payload.text.trim();
  if (!text) return;

  const now = Date.now();
  if (text === lastCapture.text && now - lastCapture.at < DUPLICATE_WINDOW_MS) {
    return;
  }
  lastCapture = { text, at: now };

  deliverOverlayCapture({ text });
}

/**
 * Send a capture to the overlay window, or hold it as the latest pending
 * capture when the overlay listener is not ready yet. Gated ONLY on the ready
 * handshake + a live window (never on webContents.isLoading(), which stays true
 * under next dev's persistent HMR connection).
 * @param {Record<string, unknown>} payload
 */
function deliverOverlayCapture(payload) {
  const canSend =
    overlayListenerReady && !!overlayWindow && !overlayWindow.isDestroyed();
  if (canSend) {
    overlayWindow.webContents.send("subtr:capture", payload);
    return;
  }
  pendingCapture = payload;
}

/** Deliver a held capture once the overlay listener signals ready. */
function flushPendingCapture() {
  if (!pendingCapture) return;
  if (!overlayListenerReady || !overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }
  const payload = pendingCapture;
  pendingCapture = null;
  overlayWindow.webContents.send("subtr:capture", payload);
}

/** True when a hook event originates from this app (never translate our own UI). */
function isOwnAppCapture(data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return true;
  const programName = String(data?.programName || "").toLowerCase();
  if (!programName) return false;
  const ownNames = [
    app.getName(),
    path.basename(process.execPath),
    "subtr",
    "electron",
  ]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
  return ownNames.some((name) => programName.includes(name));
}

// ---------------------------------------------------------------------------
// System-wide selection monitoring (selection-hook)
// ---------------------------------------------------------------------------

function initSelectionHook() {
  if (process.env.SUBTR_SELECTION_HOOK === "0") {
    console.log("[selection-hook] disabled via SUBTR_SELECTION_HOOK=0");
    return;
  }
  try {
    // Lazy require so a broken native addon never crashes startup.
    const SelectionHook = require("selection-hook");
    selectionHook = new SelectionHook();

    selectionHook.on("text-selection", (data) => {
      if (!data || typeof data.text !== "string") return;
      if (!data.text.trim()) return;
      if (isOwnAppCapture(data)) return;
      handleCapture({ text: data.text });
    });
    selectionHook.on("error", (error) => {
      console.warn("[selection-hook] error:", error && error.message ? error.message : error);
    });

    const started = selectionHook.start({ enableClipboard: true });
    if (started) {
      console.log("[selection-hook] monitoring started");
    } else {
      console.warn("[selection-hook] failed to start monitoring");
    }
  } catch (error) {
    // Addon unavailable (e.g. missing permission or unsupported platform):
    // keep running, the global hotkey path still works.
    console.warn(
      "[selection-hook] init failed:",
      error && error.message ? error.message : error,
    );
  }
}

function releaseSelectionHook() {
  if (!selectionHook) return;
  try {
    selectionHook.cleanup();
  } catch {
    // ignore
  }
  selectionHook = null;
}

/** macOS requires Accessibility permission for the accessibility APIs. */
function ensureAccessibilityPermission() {
  if (process.platform !== "darwin") return;
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (process.env.SUBTR_TEST === "1") {
      console.log("[accessibility] trusted =", trusted);
      return;
    }
    if (trusted) return;

    // Prompt once (shows the system dialog).
    systemPreferences.isTrustedAccessibilityClient(true);
    void dialog
      .showMessageBox({
        type: "info",
        title: "Enable Accessibility for SubTr",
        message:
          "SubTr needs macOS Accessibility permission to read text selections from other apps.",
        detail:
          "Open System Settings → Privacy & Security → Accessibility and enable SubTr, then restart the app.",
        buttons: ["Open System Settings", "Not now"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          void shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          );
        }
      })
      .catch(() => {});
  } catch (error) {
    console.warn("[accessibility] check failed:", error && error.message ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Global hotkey + synthetic copy fallback
// ---------------------------------------------------------------------------

async function readClipboardSafe() {
  try {
    // Electron 44: main-process-only, promise-based.
    return await clipboard.readText();
  } catch {
    return "";
  }
}

function syntheticCopy() {
  return new Promise((resolve) => {
    let child = null;
    try {
      if (process.platform === "darwin") {
        child = spawn("osascript", [
          "-e",
          'tell application "System Events" to keystroke "c" using command down',
        ]);
      } else if (process.platform === "win32") {
        child = spawn("powershell", [
          "-NoProfile",
          "-Command",
          "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')",
        ]);
      } else {
        child = spawn("xdotool", ["key", "ctrl+c"]);
      }
    } catch {
      resolve();
      return;
    }
    if (!child) {
      resolve();
      return;
    }
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

/** Hotkey handler: recent hook selection, else synthetic copy + clipboard poll. */
async function manualCapture() {
  const now = Date.now();
  if (manualBusy || now - lastManualAt < MANUAL_DEBOUNCE_MS) return;
  lastManualAt = now;
  manualBusy = true;
  try {
    if (selectionHook) {
      try {
        const current = selectionHook.getCurrentSelection();
        if (current && typeof current.text === "string" && current.text.trim()) {
          handleCapture({ text: current.text });
          return;
        }
      } catch {
        // fall through to clipboard
      }
    }

    const before = await readClipboardSafe();
    await syntheticCopy();

    let current = before;
    for (let i = 0; i < CLIPBOARD_POLL_ATTEMPTS; i++) {
      await delay(CLIPBOARD_POLL_INTERVAL_MS);
      current = await readClipboardSafe();
      if (current && current !== before && current.trim()) break;
    }

    if (current && current.trim() && current !== before) {
      handleCapture({ text: current });
    } else {
      console.log("[manualCapture] no clipboard text captured");
    }
  } finally {
    manualBusy = false;
  }
}

function registerGlobalShortcut() {
  try {
    const ok = globalShortcut.register("CommandOrControl+Shift+D", manualCapture);
    if (!ok) {
      console.warn("[shortcut] failed to register CommandOrControl+Shift+D");
    }
  } catch (error) {
    console.warn("[shortcut] registration error:", error && error.message ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Translation-mode toggle hotkey (renderer-configurable via globalShortcut)
// ---------------------------------------------------------------------------

/** Tell the reader window to flip translate mode (hotkey / tray menu). */
function sendToggleMode() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("subtr:toggle-mode");
  }
}

/**
 * Register the translation-toggle hotkey, replacing any previous one.
 * Idempotent for the same accelerator; restores the previous binding when the
 * new accelerator is invalid/unavailable so a bad value never leaves us unbound.
 * @param {unknown} accel
 * @returns {{ ok: boolean, error?: string }}
 */
function setToggleHotkey(accel) {
  if (typeof accel !== "string") return { ok: false, error: "accelerator must be a string" };
  const next = accel.trim();
  if (!next) return { ok: false, error: "accelerator is empty" };
  if (next.length > MAX_HOTKEY_CHARS) return { ok: false, error: "accelerator too long" };

  if (next === toggleHotkeyAccel && globalShortcut.isRegistered(next)) {
    return { ok: true };
  }

  const previous = toggleHotkeyAccel;
  if (previous && globalShortcut.isRegistered(previous)) {
    try {
      globalShortcut.unregister(previous);
    } catch {
      // ignore
    }
  }

  let ok = false;
  let error;
  try {
    ok = globalShortcut.register(next, sendToggleMode);
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  if (!ok) {
    if (previous && !globalShortcut.isRegistered(previous)) {
      try {
        globalShortcut.register(previous, sendToggleMode);
      } catch {
        // ignore
      }
    }
    return { ok: false, error: error || "hotkey unavailable (already in use or invalid)" };
  }
  toggleHotkeyAccel = next;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// System tray (idle vs active + short state-change animation)
// ---------------------------------------------------------------------------

/** Create the reader window if it was closed (tray-resident app keeps running). */
function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  if (!appBaseUrl) return null;
  createMainWindow(appBaseUrl);
  return mainWindow;
}

/** Show and focus the reader window (recreating it when it was closed). */
function showMainWindow() {
  const win = ensureMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Open the settings page in the reader window and bring it forward. */
function openSettingsWindow() {
  const win = ensureMainWindow();
  if (!win || win.isDestroyed()) return;
  if (appBaseUrl) void win.loadURL(`${appBaseUrl}/settings`);
  showMainWindow();
}

/** Build a template nativeImage (16px base + 32px @2x) from a tray frame. */
function buildTrayImage(frame) {
  const image = nativeImage.createFromBitmap(frame[16].bgra, { width: 16, height: 16 });
  try {
    image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: frame[32].bgra });
  } catch {
    // ignore — 16px base still renders
  }
  try {
    image.setTemplateImage(true);
  } catch {
    // ignore
  }
  return image;
}

function restingTrayImage() {
  if (!trayFrames) return null;
  return buildTrayImage(currentTrayMode ? trayFrames.on : trayFrames.off);
}

function stopTrayAnimation() {
  if (trayAnimTimer) {
    clearTimeout(trayAnimTimer);
    trayAnimTimer = null;
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Show SubTr", click: showMainWindow },
    {
      label: "Toggle translation",
      type: "checkbox",
      checked: currentTrayMode,
      click: sendToggleMode,
    },
    { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettingsWindow },
    { type: "separator" },
    { role: "quit" },
  ]);
  tray.setContextMenu(menu);
}

/**
 * Update the tray to reflect translate mode, playing a short ~400ms burst.
 * @param {boolean} enabled
 */
function setTrayState(enabled) {
  currentTrayMode = !!enabled;
  if (tray && !tray.isDestroyed()) updateTrayMenu();
  if (!tray || tray.isDestroyed()) return;
  stopTrayAnimation();

  const burst = currentTrayMode ? trayFrames.burstOn : trayFrames.burstOff;
  let index = 0;
  const step = () => {
    if (!tray || tray.isDestroyed()) {
      trayAnimTimer = null;
      return;
    }
    try {
      tray.setImage(buildTrayImage(burst[index]));
    } catch {
      // ignore a single frame failure
    }
    try {
      tray.setToolTip(currentTrayMode ? "SubTr — translating" : "SubTr");
    } catch {
      // ignore
    }
    animateCount++;
    index++;
    if (index < burst.length) {
      trayAnimTimer = setTimeout(step, TRAY_FRAME_MS);
    } else {
      trayAnimTimer = null;
    }
  };
  step();
}

function createTray() {
  if (tray) return;
  try {
    trayFrames = buildFrames();
    tray = new Tray(restingTrayImage(), TRAY_GUID);
    tray.setToolTip("SubTr");
    if (process.platform === "darwin") {
      try {
        tray.setIgnoreDoubleClickEvents(true);
      } catch {
        // ignore — not critical
      }
    }
    updateTrayMenu();
    tray.on("click", showMainWindow);
  } catch (error) {
    console.warn("[tray] init failed:", error && error.message ? error.message : error);
    tray = null;
  }
}

function destroyTray() {
  stopTrayAnimation();
  if (tray) {
    try {
      tray.destroy();
    } catch {
      // ignore
    }
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// Overlay interaction bridge (click-through toggle + one-shot global Escape)
// ---------------------------------------------------------------------------

/** True when an IPC event came from the overlay window. */
function isFromOverlay(event) {
  return (
    !!overlayWindow &&
    !overlayWindow.isDestroyed() &&
    event.sender === overlayWindow.webContents
  );
}

/** True when an IPC event came from either of our windows (reader or overlay). */
function isFromOurWindow(event) {
  const fromMain =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents;
  return fromMain || isFromOverlay(event);
}

/** True when an IPC event came from the main (reader) window. */
function isFromMainWindow(event) {
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents
  );
}

/**
 * Validate a test-play transport control sent from the main window.
 * action must be play|pause|seek; timeMs (optional) must be a finite number >= 0.
 * @param {unknown} payload
 * @returns {{ action: "play" | "pause" | "seek", timeMs?: number } | null}
 */
function validateTestPlayControl(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { action, timeMs } = /** @type {{ action?: unknown, timeMs?: unknown }} */ (payload);
  if (action !== "play" && action !== "pause" && action !== "seek") return null;
  /** @type {{ action: "play" | "pause" | "seek", timeMs?: number }} */
  const control = { action };
  if (timeMs !== undefined) {
    if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) return null;
    control.timeMs = timeMs;
  }
  return control;
}

/** Clamp a value to a finite number >= 0, or null when not a number. */
function toNonNegativeMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/**
 * Validate a playback-state report sent from the overlay window.
 * Requires a boolean `playing` and finite, non-negative `timeMs`/`totalMs`.
 * @param {unknown} payload
 * @returns {{ playing: boolean, timeMs: number, totalMs: number } | null}
 */
function validateTestPlayState(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { playing, timeMs, totalMs } = /** @type {{ playing?: unknown, timeMs?: unknown, totalMs?: unknown }} */ (payload);
  if (typeof playing !== "boolean") return null;
  const ms = toNonNegativeMs(timeMs);
  const total = toNonNegativeMs(totalMs);
  if (ms === null || total === null) return null;
  return { playing, timeMs: ms, totalMs: total };
}

/** Toggle the overlay between click-through (default) and interactive. */
function setOverlayInteractive(on) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(!on, { forward: true });
}

/** One-shot global Escape handler fired while armed. */
function onEscFired() {
  disarmEsc();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("subtr:esc");
  }
}

/** Register a global Escape (idempotent). */
function armEsc() {
  if (escArmed) return;
  try {
    const ok = globalShortcut.register("Escape", onEscFired);
    if (!ok) {
      console.warn("[esc] failed to register global Escape");
      return;
    }
    escArmed = true;
  } catch (error) {
    console.warn("[esc] registration error:", error && error.message ? error.message : error);
  }
}

/** Unregister the global Escape. */
function disarmEsc() {
  if (!escArmed) return;
  try {
    globalShortcut.unregister("Escape");
  } catch {
    // ignore
  }
  escArmed = false;
}

/** Reset transient overlay state (used on overlay reload/close). */
function resetOverlayState() {
  disarmEsc();
  // The renderer's onCapture subscription is gone after a reload; wait for the
  // ready handshake again (any pending capture is kept and flushed on ready).
  overlayListenerReady = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }
}

/**
 * Match the (full-screen transparent) overlay window to the primary display's
 * work area and restore click-through. The overlay page positions its own card.
 */
function applyOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(screen.getPrimaryDisplay().workArea);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
}

/** Re-apply overlay bounds whenever the display layout changes. */
function registerDisplayListeners() {
  const onChange = () => applyOverlayBounds();
  screen.on("display-metrics-changed", onChange);
  screen.on("display-added", onChange);
  screen.on("display-removed", onChange);
}

function registerOverlayIpc() {
  ipcMain.on("subtr:overlay-interactive", (event, on) => {
    if (!isFromOverlay(event)) return;
    if (typeof on !== "boolean") return;
    setOverlayInteractive(on);
  });

  ipcMain.on("subtr:esc-armed", (event, on) => {
    if (!isFromOverlay(event)) return;
    if (typeof on !== "boolean") return;
    if (on) {
      armEsc();
    } else {
      disarmEsc();
    }
  });

  // The overlay renderer subscribes to captures → mark ready and flush any held capture.
  ipcMain.on("subtr:capture-listener-ready", (event) => {
    if (!isFromOverlay(event)) return;
    overlayListenerReady = true;
    console.log("[capture] overlay listener ready");
    flushPendingCapture();
  });

  // Native window chrome (macOS title bar) follows the app theme.
  ipcMain.on("subtr:set-native-theme", (event, theme) => {
    if (!isFromOurWindow(event)) return;
    if (theme !== "system" && theme !== "light" && theme !== "dark") return;
    nativeTheme.themeSource = theme;
  });

  // Play a subtitle on the real screen (overlay window) for the "Test" button.
  ipcMain.on("subtr:test-subtitle", (event, payload) => {
    if (!isFromOurWindow(event)) return;
    if (!payload || typeof payload.text !== "string") return;
    const text = payload.text;
    if (!text.trim()) return;
    if (text.length > MAX_TEST_SUBTITLE_CHARS) return;
    deliverOverlayCapture({ text, source: "test" });
  });

  // Main window → overlay: transport control for the real-screen test player.
  ipcMain.on("subtr:test-play-control", (event, payload) => {
    if (!isFromMainWindow(event)) return;
    const control = validateTestPlayControl(payload);
    if (!control) return;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("subtr:test-play-control", control);
    }
  });

  // Overlay → main window: playback-state report for the real-screen test player.
  ipcMain.on("subtr:test-play-state", (event, payload) => {
    if (!isFromOverlay(event)) return;
    const state = validateTestPlayState(payload);
    if (!state) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("subtr:test-play-state", state);
    }
  });

  // Renderer-configurable translation-toggle hotkey (main window only).
  ipcMain.handle("subtr:set-toggle-hotkey", (event, accel) => {
    const fromMain =
      !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
    if (!fromMain) return { ok: false, error: "unauthorized" };
    return setToggleHotkey(accel);
  });

  // Renderer reports translate-mode state so the tray reflects idle vs active.
  ipcMain.on("subtr:set-tray-state", (event, enabled) => {
    if (!isFromOurWindow(event)) return;
    if (typeof enabled !== "boolean") return;
    setTrayState(enabled);
  });

  // Settings-page position canvas backdrop: primary-screen thumbnail data URL.
  ipcMain.handle("subtr:capture-desktop", async () => captureDesktopThumbnail());
}

/**
 * Capture the primary screen as a PNG data URL (thumbnail ~1000px wide).
 * Returns null when unavailable: no Screen Recording permission (macOS),
 * empty thumbnail, or any error. Called lazily by the settings page.
 * @returns {Promise<string | null>}
 */
async function captureDesktopThumbnail() {
  try {
    if (process.platform === "darwin") {
      try {
        console.log(
          "[desktop-thumbnail] screen access:",
          systemPreferences.getMediaAccessStatus("screen"),
        );
      } catch {
        // ignore
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1000, height: 625 },
    });
    if (!sources || sources.length === 0) return null;

    // Best-effort match on the primary display; fall back to the first source.
    const primaryId = screen.getPrimaryDisplay().id;
    let source = null;
    if (primaryId != null) {
      source =
        sources.find(
          (s) =>
            s.display_id != null && String(s.display_id) === String(primaryId),
        ) ?? null;
    }
    if (!source) source = sources[0];

    const thumbnail = source.thumbnail;
    if (!thumbnail || thumbnail.isEmpty()) return null;
    const dataUrl = thumbnail.toDataURL();
    return dataUrl && dataUrl.length > 0 ? dataUrl : null;
  } catch (error) {
    console.warn(
      "[desktop-thumbnail] capture failed:",
      error && error.message ? error.message : error,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const preloadPath = path.join(__dirname, "preload.cjs");

function createMainWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 714,
    height: 480,
    minWidth: 640,
    minHeight: 420,
    center: true,
    show: false,
    title: "SubTr",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: preloadPath,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(`${baseUrl}/`);
}

function createOverlayWindow(baseUrl) {
  const workArea = screen.getPrimaryDisplay().workArea;

  overlayWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    roundedCorners: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: preloadPath,
    },
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.webContents.on("did-start-navigation", () => {
    // Overlay reloading: drop any armed Esc and restore click-through.
    resetOverlayState();
  });
  overlayWindow.webContents.on("did-finish-load", () => {
    // Belt-and-braces flush; the ready handshake (from preload onCapture) is the
    // primary trigger and the only thing that sets overlayListenerReady.
    flushPendingCapture();
  });
  overlayWindow.once("ready-to-show", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive();
  });
  overlayWindow.on("closed", () => {
    resetOverlayState();
    overlayWindow = null;
  });
  void overlayWindow.loadURL(`${baseUrl}/overlay`);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function resolveServerDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(APP_ROOT, ".next", "standalone");
}

async function resolveBaseUrl() {
  const devUrl = process.env.SUBTR_DEV_URL;
  if (devUrl) {
    return devUrl.replace(/\/+$/, "");
  }

  const serverDir = resolveServerDir();
  const serverEntry = path.join(serverDir, "server.js");
  const port = await getFreePort();

  // utilityProcess.fork: no `node` binary required in packaged apps.
  serverProcess = utilityProcess.fork(serverEntry, [], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: "pipe",
    serviceName: "subtr-web",
  });
  if (serverProcess.stdout) {
    serverProcess.stdout.on("data", (chunk) =>
      process.stdout.write(`[web] ${chunk}`),
    );
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.on("data", (chunk) =>
      process.stderr.write(`[web] ${chunk}`),
    );
  }
  serverProcess.on("exit", (code) => {
    console.log(`[web] server exited with code ${code}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${baseUrl}/`, 60000);
  return baseUrl;
}

function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
      // ignore
    }
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

async function start() {
  if (process.env.SUBTR_TEST === "1") {
    globalThis.__subtrTest = {
      capture: (text) => handleCapture({ text }),
    };
    globalThis.__subtrTrayState = () => ({ mode: currentTrayMode, frames: animateCount });
  }

  registerOverlayIpc();

  let baseUrl;
  try {
    baseUrl = await resolveBaseUrl();
  } catch (error) {
    console.error("[startup] failed to start web server:", error);
    await dialog.showMessageBox({
      type: "error",
      title: "SubTr failed to start",
      message: "The local web server could not be started.",
      detail: String(error && error.message ? error.message : error),
    });
    app.quit();
    return;
  }
  appBaseUrl = baseUrl;

  createMainWindow(baseUrl);
  createOverlayWindow(baseUrl);
  createTray();
  registerDisplayListeners();
  registerGlobalShortcut();
  ensureAccessibilityPermission();
  initSelectionHook();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(start).catch((error) => {
    console.error("[startup] fatal:", error);
    app.quit();
  });
}

// Tray-resident app: keep running when all windows are closed (quit via tray
// menu). Subscribing is required — without a listener Electron quits by default.
app.on("window-all-closed", () => {
  // Intentionally do nothing: the tray keeps the app alive on every platform.
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  destroyTray();
  releaseSelectionHook();
  stopServer();
});

// Keep the variable referenced so linters don't flag it; documents intent.
void quitting;
