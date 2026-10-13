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
  utilityProcess,
} = require("electron");

const APP_ROOT = path.resolve(__dirname, "..");
const DUPLICATE_WINDOW_MS = 1200;
const MANUAL_DEBOUNCE_MS = 400;
const CLIPBOARD_POLL_ATTEMPTS = 20;
const CLIPBOARD_POLL_INTERVAL_MS = 25;

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

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("subtr:capture", { text });
  }
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
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const preloadPath = path.join(__dirname, "preload.cjs");

function createMainWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 660,
    minWidth: 640,
    minHeight: 480,
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

  createMainWindow(baseUrl);
  createOverlayWindow(baseUrl);
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start).catch((error) => {
    console.error("[startup] fatal:", error);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  releaseSelectionHook();
  stopServer();
});

// Keep the variable referenced so linters don't flag it; documents intent.
void quitting;
