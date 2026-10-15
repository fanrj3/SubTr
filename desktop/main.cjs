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
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const { Readable } = require("node:stream");
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
  net: electronNet,
} = require("electron");

const { buildFrames, buildMenuIcons } = require("./tray-icons.cjs");
const voicePipeline = require("./voice-pipeline.cjs");
const { initMain: initLoopbackAudio } = require("electron-audio-loopback");

// Enable macOS system-audio loopback (electron-audio-loopback). Appends the
// Chromium feature flags (PulseaudioLoopbackForScreenShare,
// MacLoopbackAudioForScreenShare, MacSckSystemAudioLoopbackOverride) and
// registers the "enable-loopback-audio" / "disable-loopback-audio" IPC that
// installs a setDisplayMediaRequestHandler returning audio:'loopback'.
//
// SUBTR_VOICE_CORE_AUDIO_TAP=1 switches to the Core Audio tap backend
// (MacCatapSystemAudioLoopbackCapture) — an experiment for macOS versions where
// the default ScreenCaptureKit loopback yields silence.
initLoopbackAudio({
  forceCoreAudioTap: process.env.SUBTR_VOICE_CORE_AUDIO_TAP === "1",
});

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
/** Menu-item template glyph frames (built once with the tray). */
let menuIcons = null;
/** Cache of nativeImage menu icons, keyed by glyph name. */
const menuImages = new Map();
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

/**
 * Template nativeImage for a menu glyph (16px + @2x), cached. Falls back to
 * undefined so a missing glyph never breaks menu construction.
 * @param {string} name
 */
function menuIcon(name) {
  if (menuImages.has(name)) return menuImages.get(name);
  let image;
  try {
    const frame = menuIcons && menuIcons[name];
    image = frame ? buildTrayImage(frame) : undefined;
  } catch {
    image = undefined;
  }
  menuImages.set(name, image);
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

// --- Usage stats (read straight from ~/.subtr/stats.json, v2 shape) ---------

/** Path to the server-side cost meter store (mirrors src/lib/server/stats.ts). */
function statsFilePath() {
  return path.join(os.homedir(), ".subtr", "stats.json");
}

/** Coerce an untrusted value to a finite number (0 fallback). */
function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Local calendar date as YYYY-MM-DD (matches the server's daily bucket keys). */
function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Read ~/.subtr/stats.json synchronously. Returns the parsed object or null when
 * the file is missing/unreadable/malformed (tray falls back to a "no data" row).
 * The file is tiny (recent capped at 200) so a sync read is cheap and lets the
 * menu be built synchronously inside the tray click handler.
 * @returns {Record<string, unknown> | null}
 */
function readStatsFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(statsFilePath(), "utf8"));
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Format the cost line shown in the tray header, mirroring the home status bar
 * (`~$0.0123 · 12 calls · 9 translations`) but as plain disabled menu labels.
 * Uses compact "Today" / "All time" wording (the main process has no i18n
 * system; the rest of the tray menu is English too).
 * @returns {Array<Record<string, unknown>>} disabled header menu items
 */
function buildStatsMenuItems() {
  const stats = readStatsFile();
  if (!stats) return [{ label: "No usage data yet", enabled: false }];

  const totalsRaw =
    stats.totals && typeof stats.totals === "object"
      ? /** @type {Record<string, unknown>} */ (stats.totals)
      : {};
  const totals = {
    costUsd: toFiniteNumber(totalsRaw.costUsd),
    calls: toFiniteNumber(totalsRaw.calls),
    translations: toFiniteNumber(totalsRaw.translations),
    estimatedCount: toFiniteNumber(totalsRaw.estimatedCount),
  };

  const dailyRaw =
    stats.daily && typeof stats.daily === "object"
      ? /** @type {Record<string, unknown>} */ (stats.daily)
      : {};
  const todayRaw = dailyRaw[localDateKey()];
  const today =
    todayRaw && typeof todayRaw === "object"
      ? /** @type {Record<string, unknown>} */ (todayRaw)
      : {};
  const todayCost = toFiniteNumber(today.costUsd);
  const todayCalls = toFiniteNumber(today.calls);
  const todayTranslations = toFiniteNumber(today.translations);

  // `~` marks estimated costs — the file only tracks this globally via totals.
  const prefix = totals.estimatedCount > 0 ? "~" : "";

  const todayLine = `Today · ${prefix}$${todayCost.toFixed(4)} · ${todayCalls} calls · ${todayTranslations} translations`;
  const allTimeLine = `All time · ${prefix}$${totals.costUsd.toFixed(4)} · ${totals.calls} calls · ${totals.translations} translations`;

  return [
    { label: todayLine, enabled: false },
    { label: allTimeLine, enabled: false },
  ];
}

/**
 * Build the tray context-menu template fresh: actions (with template icons),
 * the Usage submenu (live stats) and the voice Beta items. Rebuilt on every
 * click so numbers/state are current.
 * @returns {Array<Record<string, unknown>>}
 */
function buildTrayMenuTemplate() {
  return [
    { label: "Show SubTr", icon: menuIcon("show"), click: showMainWindow },
    {
      label: "Toggle translation",
      type: "checkbox",
      checked: currentTrayMode,
      icon: menuIcon("translate"),
      click: sendToggleMode,
    },
    ...buildVoiceMenuItems(),
    { label: "Usage", icon: menuIcon("usage"), submenu: buildStatsMenuItems() },
    { label: "Settings…", accelerator: "CmdOrCtrl+,", icon: menuIcon("gear"), click: openSettingsWindow },
    { type: "separator" },
    { role: "quit", icon: menuIcon("power") },
  ];
}

/**
 * Labels-only view of the tray menu (SUBTR_TEST introspection). Submenu children
 * are enumerated inline, indented by two spaces per level; separators show "—".
 */
function trayMenuLabels(template = buildTrayMenuTemplate(), depth = 0) {
  const out = [];
  for (const item of template) {
    if (item.type === "separator") {
      out.push("—");
      continue;
    }
    out.push(`${"  ".repeat(depth)}${String(item.label ?? "")}`);
    if (Array.isArray(item.submenu)) {
      out.push(...trayMenuLabels(item.submenu, depth + 1));
    }
  }
  return out;
}

/** Timestamp guard so a duplicated click/right-click doesn't pop twice. */
let lastTrayMenuAt = 0;

/**
 * Rebuild the tray menu from current stats + state and pop it up. Both the
 * left-click and right-click handlers call this, so the menu is always fresh
 * (macOS: popUpContextMenu; Windows/Linux: same, no persistent context menu).
 */
function showTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const now = Date.now();
  if (now - lastTrayMenuAt < 200) return;
  lastTrayMenuAt = now;

  let menu;
  try {
    menu = Menu.buildFromTemplate(buildTrayMenuTemplate());
  } catch (error) {
    console.warn("[tray] failed to build menu:", error && error.message ? error.message : error);
    return;
  }
  try {
    tray.popUpContextMenu(menu);
  } catch (error) {
    console.warn("[tray] failed to pop up menu:", error && error.message ? error.message : error);
  }
}

/**
 * Update the tray to reflect translate mode, playing a short ~400ms burst.
 * @param {boolean} enabled
 */
function setTrayState(enabled) {
  currentTrayMode = !!enabled;
  // The menu is rebuilt on every click, so the fresh checkbox state is picked up
  // automatically — no need to re-set a persistent context menu here.
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
    menuIcons = buildMenuIcons();
    tray = new Tray(restingTrayImage(), TRAY_GUID);
    tray.setToolTip("SubTr");
    if (process.platform === "darwin") {
      try {
        tray.setIgnoreDoubleClickEvents(true);
      } catch {
        // ignore — not critical
      }
    }
    // No persistent context menu: click/right-click rebuild + pop it fresh so
    // usage numbers are always current.
    tray.on("click", showTrayMenu);
    tray.on("right-click", showTrayMenu);
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
// Voice → translated subtitles (Beta, phase 1 prototype)
// ---------------------------------------------------------------------------
//
// Spine: renderer loopback capture (desktop/voice-capture.js) → 16 kHz mono PCM
// over IPC → rolling window (desktop/voice-pipeline.cjs) → whisper-server
// /inference → stable-prefix commit → forward committed text to the existing
// overlay capture channel, which renders it through the normal /api/translate
// path (the overlay translates with the active profile from localStorage).

/** @typedef {"off"|"starting"|"listening"|"needs-setup"|"error"|"server-error"} VoiceStatus */

/** @type {VoiceStatus} */
let voiceStatus = "off";
let voiceActive = false;
let voiceWanted = false;

/** @type {InstanceType<typeof voicePipeline.PcmRingBuffer> | null} */
let voiceRing = null;
/** @type {InstanceType<typeof voicePipeline.VoiceCommitter> | null} */
let voiceCommitter = null;
/** @type {ReturnType<typeof setInterval> | null} */
let voiceHopTimer = null;
let voicePassBusy = false;
let voicePassCount = 0;
let voiceCommitCount = 0;
let voicePcmSeen = 0;
let voiceLastTranscript = "";
let voiceLastCommit = "";
let voiceLastCommitAt = 0;
/** Peak RMS of the most recent analysis window (silence diagnostics). */
let voiceLastRms = 0;
/** Whether the injected capture shim has subscribed to toggle events. */
let voiceShimReady = false;
/** Toggle queued while the shim was not ready yet (true/false) or null. */
let voiceTogglePending = null;

/** whisper-server process state (kept warm between voice sessions). */
const whisper = {
  proc: null,
  port: 0,
  pid: 0,
  ready: false,
  starting: null,
  /** Consecutive crash restarts in the current session (bounded). */
  restarts: 0,
  /** True while an intentional stop is in flight (suppresses auto-restart). */
  stopping: false,
};
const WHISPER_MAX_RESTARTS = 3;

/**
 * Local GGML model catalog. `kind: "whisper"` models are ASR models; `kind: "vad"`
 * is the Silero VAD model. Structure allows listing/selecting more later.
 */
const WHISPER_MODELS = [
  {
    id: "base.en",
    kind: "whisper",
    file: "ggml-base.en.bin",
    bytes: 147964211,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    label: "Whisper base.en (≈142 MB)",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  },
  {
    id: "silero-v6.2.0",
    kind: "vad",
    file: "ggml-silero-v6.2.0.bin",
    bytes: 885098,
    sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
    label: "Silero VAD v6.2.0 (≈0.9 MB)",
    url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin",
  },
];

const DEFAULT_MODEL_ID = "base.en";
const VAD_MODEL_ID = "silero-v6.2.0";

/** Resolve the whisper.cpp install dirs under the app's userData/appData root. */
function voicePaths() {
  const root = path.join(app.getPath("appData"), "subtr", "whisper");
  const modelsDir = path.join(root, "models");
  return {
    root,
    modelsDir,
    bin: path.join(root, "bin", "whisper-server"),
    model: path.join(modelsDir, "ggml-base.en.bin"),
    silero: path.join(modelsDir, "ggml-silero-v6.2.0.bin"),
  };
}

function findModel(id) {
  return WHISPER_MODELS.find((m) => m.id === id) || null;
}

function modelFilePath(model) {
  return path.join(voicePaths().modelsDir, model.file);
}

/** A model counts as present when the file exists at the exact expected size. */
function modelPresent(model) {
  try {
    return fs.statSync(modelFilePath(model)).size === model.bytes;
  } catch {
    return false;
  }
}

/** Whether the whisper-server binary + ASR model (+ optional VAD) are on disk. */
function voiceSetupStatus() {
  const p = voicePaths();
  const serverPresent = fs.existsSync(p.bin);
  const basePresent = modelPresent(findModel(DEFAULT_MODEL_ID));
  const vadPresent = modelPresent(findModel(VAD_MODEL_ID));
  const missing = [];
  if (!serverPresent) missing.push("whisper-server binary");
  if (!basePresent) missing.push("ggml-base.en.bin model");
  return {
    ready: serverPresent && basePresent,
    server: p.bin,
    model: p.model,
    silero: p.silero,
    serverPresent,
    modelPresent: basePresent,
    vadPresent,
    missing,
    download: voiceDownload.active ? { ...voiceDownload } : null,
  };
}

// --- Model download (streaming + progress + sha256 verify, restart-safe) -----

/** Current download state (single download at a time). */
const voiceDownload = {
  active: false,
  id: null,
  file: null,
  received: 0,
  total: 0,
  percent: 0,
  error: null,
  startedAt: 0,
};
/** @type {Promise<{ok:boolean}> | null} */
let voiceDownloadPromise = null;
let lastDownloadEmit = 0;

/** Stream a file through sha256 (hex digest). */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Push download progress to the renderer (throttled) for the settings UI. */
function emitVoiceDownloadProgress(force) {
  const now = Date.now();
  if (!force && now - lastDownloadEmit < 250) return;
  lastDownloadEmit = now;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("subtr:voice-download-progress", { ...voiceDownload });
  } catch {
    // ignore
  }
}

/** List the catalog with presence info (for the settings UI). */
function listModels() {
  return WHISPER_MODELS.map((m) => ({
    id: m.id,
    kind: m.kind,
    label: m.label,
    file: m.file,
    bytes: m.bytes,
    sha256: m.sha256,
    path: modelFilePath(m),
    present: modelPresent(m),
  }));
}

/**
 * Download a catalog model into the whisper models dir.
 *  - restart-safe: any partial `.download` file is discarded and restarted
 *  - verified: size + sha256 must match the catalog entry
 *  - atomic: verified temp file is renamed into place
 * @param {string} [id]
 * @returns {Promise<{ok:boolean, id?:string, bytes?:number, sha256?:string, error?:string}>}
 */
function downloadModel(id) {
  const model = findModel(id) || findModel(DEFAULT_MODEL_ID);
  if (!model) return Promise.resolve({ ok: false, error: "unknown model" });
  if (voiceDownloadPromise) return voiceDownloadPromise;

  voiceDownloadPromise = (async () => {
    const dir = voicePaths().modelsDir;
    fs.mkdirSync(dir, { recursive: true });
    const dest = modelFilePath(model);
    const tmp = `${dest}.download`;

    Object.assign(voiceDownload, {
      active: true,
      id: model.id,
      file: model.file,
      received: 0,
      total: model.bytes,
      percent: 0,
      error: null,
      startedAt: Date.now(),
    });
    emitVoiceDownloadProgress(true);
    console.log(`[voice] downloading ${model.file} from ${model.url}`);

    try {
      // Resume-safe: drop any partial temp file and restart cleanly.
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // ignore
      }
      // Electron's net.fetch uses the Chromium network stack, so it honours the
      // system proxy (Node's undici fetch does not).
      const fetchImpl = electronNet && electronNet.fetch ? electronNet.fetch.bind(electronNet) : fetch;
      const res = await fetchImpl(model.url, { headers: { "User-Agent": "SubTr" } });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || model.bytes;
      voiceDownload.total = total;

      const nodeStream = Readable.fromWeb(res.body);
      const out = fs.createWriteStream(tmp);
      await new Promise((resolve, reject) => {
        nodeStream.on("data", (chunk) => {
          voiceDownload.received += chunk.length;
          voiceDownload.percent = total
            ? Math.min(100, Math.floor((voiceDownload.received / total) * 100))
            : 0;
          emitVoiceDownloadProgress(false);
        });
        nodeStream.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        nodeStream.pipe(out);
      });

      const size = fs.statSync(tmp).size;
      const sha256 = await sha256File(tmp);
      if (size !== model.bytes || sha256 !== model.sha256) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          // ignore
        }
        throw new Error(`verification failed (size=${size}, sha256=${sha256.slice(0, 12)}…)`);
      }

      fs.renameSync(tmp, dest); // atomic within the same directory
      voiceDownload.active = false;
      voiceDownload.percent = 100;
      voiceDownload.error = null;
      emitVoiceDownloadProgress(true);
      console.log(`[voice] ${model.file} verified + installed (${size} bytes, sha256 ok)`);
      return { ok: true, id: model.id, bytes: size, sha256 };
    } catch (error) {
      voiceDownload.active = false;
      voiceDownload.error = error && error.message ? error.message : String(error);
      emitVoiceDownloadProgress(true);
      console.warn(`[voice] download ${model.id} failed:`, voiceDownload.error);
      return { ok: false, id: model.id, error: voiceDownload.error };
    } finally {
      voiceDownloadPromise = null;
    }
  })();

  return voiceDownloadPromise;
}

function setVoiceStatus(next) {
  if (next === "listening" && !voiceActive) next = "off";
  voiceStatus = next;
  console.log(`[voice] status=${voiceStatus}`);
}

/** Current voice state snapshot (shared by the IPC setter and the test hook). */
function voiceSnapshot() {
  return {
    status: voiceStatus,
    active: voiceActive,
    wanted: voiceWanted,
    shimReady: voiceShimReady,
    serverReady: whisper.ready,
    serverPort: whisper.port,
    serverPid: whisper.pid,
    serverRestarts: whisper.restarts,
    passes: voicePassCount,
    commits: voiceCommitCount,
    pcmSamples: voicePcmSeen,
    lastRms: voiceLastRms,
    lastTranscript: voiceLastTranscript,
    lastCommit: voiceLastCommit,
    lastCommitAt: voiceLastCommitAt,
    download: voiceDownload.active ? { ...voiceDownload } : null,
    setup: voiceSetupStatus(),
  };
}

/**
 * Renderer-driven master toggle (settings Voice section). Idempotent: enabling
 * while already starting/listening is a no-op, as is disabling while off.
 * Awaits startVoice() so the returned snapshot already reflects the settled
 * state ("listening" or "needs-setup"/"error"). The tray menu is rebuilt on the
 * next click and reads voiceStatus, so no push is required.
 * @param {boolean} enabled
 * @returns {Promise<ReturnType<typeof voiceSnapshot>>}
 */
async function setVoiceEnabled(enabled) {
  const want = enabled === true;
  const currentlyOn = voiceWanted || voiceActive;
  if (want && !currentlyOn) {
    await startVoice();
  } else if (!want && currentlyOn) {
    stopVoice();
  }
  return voiceSnapshot();
}

/** Tray label reflects the Beta feature's current state. */
function voiceMenuLabel() {
  switch (voiceStatus) {
    case "starting":
      return "Voice translation (Beta): Starting…";
    case "listening":
      return "Voice translation (Beta): Listening";
    case "needs-setup":
      return "Voice translation (Beta): Setup needed";
    case "server-error":
      return "Voice translation (Beta): Voice server error";
    case "error":
      return "Voice translation (Beta): Error";
    default:
      return "Voice translation (Beta): Off";
  }
}

/**
 * Tray items: the Beta trigger, a "Download model" action when the ASR model is
 * missing (with a live "Downloading… N%" label while in flight), and a setup
 * dialog entry when any component is missing.
 */
function buildVoiceMenuItems() {
  const items = [
    {
      label: voiceMenuLabel(),
      type: "checkbox",
      checked: voiceActive,
      icon: menuIcon("mic"),
      click: toggleVoice,
    },
  ];
  const setup = voiceSetupStatus();
  if (!setup.ready) {
    if (!setup.modelPresent) {
      if (voiceDownload.active) {
        items.push({
          label: `Downloading… ${voiceDownload.percent}%`,
          enabled: false,
          icon: menuIcon("download"),
        });
      } else {
        items.push({
          label: "Download model (≈142 MB)",
          icon: menuIcon("download"),
          click: () => void downloadModel(DEFAULT_MODEL_ID),
        });
      }
    }
    items.push({ label: "Voice setup required…", icon: menuIcon("gear"), click: showVoiceSetupDialog });
  }
  return items;
}

/** Explain what to install (and offer the model download) when setup is missing. */
function showVoiceSetupDialog() {
  const p = voicePaths();
  const setup = voiceSetupStatus();
  const lines = [
    "Voice translation (Beta) needs whisper.cpp running locally.",
    "",
    `whisper-server binary:\n  ${p.bin}`,
    `ASR model (ggml-base.en.bin):\n  ${p.model}`,
    `Silero VAD model (optional, better silence handling):\n  ${p.silero}`,
    "",
    setup.missing.length ? `Missing: ${setup.missing.join(", ")}` : "All required components present.",
  ];
  const buttons = ["OK"];
  if (!setup.modelPresent) buttons.unshift("Download model (≈142 MB)");
  void dialog
    .showMessageBox({
      type: "info",
      title: "Voice translation — setup required",
      message: "whisper.cpp components not found.",
      detail: lines.join("\n"),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    })
    .then((result) => {
      if (String(buttons[result.response] || "").startsWith("Download")) {
        void downloadModel(DEFAULT_MODEL_ID);
      }
    })
    .catch(() => {});
}

/** CLI args for whisper-server (adds Silero VAD when its model is present). */
function whisperServerArgs(port) {
  const p = voicePaths();
  const args = ["-m", p.model, "--host", "127.0.0.1", "--port", String(port), "-l", "en", "-t", "4"];
  if (fs.existsSync(p.silero)) {
    args.push("--vad", "-vm", p.silero);
  }
  return args;
}

/** Spawn whisper-server and resolve true once it answers HTTP. */
async function spawnWhisperServer() {
  const p = voicePaths();
  const port = await getFreePort();
  const args = whisperServerArgs(port);
  const proc = spawn(p.bin, args, { stdio: "pipe" });
  whisper.proc = proc;
  whisper.port = port;
  whisper.pid = proc.pid || 0;
  console.log(
    `[voice] whisper-server pid=${whisper.pid} port=${port} vad=${args.includes("--vad")}`,
  );
  if (proc.stdout) proc.stdout.on("data", (c) => process.stdout.write(`[whisper] ${c}`));
  if (proc.stderr) proc.stderr.on("data", (c) => process.stderr.write(`[whisper] ${c}`));
  proc.on("exit", (code) => onWhisperExit(code));

  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("whisper-server did not become ready in 30s");
      if (!whisper.proc) throw new Error("whisper-server exited during startup");
      try {
        const res = await fetch(`${base}/`, { method: "GET" });
        if (res.ok) break;
      } catch {
        // not up yet
      }
      await delay(200);
    }
    whisper.ready = true;
    console.log(`[voice] whisper-server ready on ${base}`);
    return true;
  } catch (error) {
    console.warn(
      "[voice] whisper-server start failed:",
      error && error.message ? error.message : error,
    );
    whisper.ready = false;
    try {
      if (whisper.proc) whisper.proc.kill();
    } catch {
      // ignore
    }
    whisper.proc = null;
    whisper.pid = 0;
    whisper.port = 0;
    return false;
  }
}

/** Spawn (once) and warm whisper-server; resolves when it answers HTTP. */
function ensureWhisperServer() {
  if (whisper.ready && whisper.proc) return Promise.resolve(true);
  if (whisper.starting) return whisper.starting;
  const setup = voiceSetupStatus();
  if (!setup.ready) {
    setVoiceStatus("needs-setup");
    return Promise.resolve(false);
  }
  whisper.stopping = false;
  whisper.starting = spawnWhisperServer().finally(() => {
    whisper.starting = null;
  });
  return whisper.starting;
}

/** Handle an unexpected whisper-server exit: bounded auto-restart during a session. */
function onWhisperExit(code) {
  const wasReady = whisper.ready;
  whisper.ready = false;
  whisper.proc = null;
  whisper.pid = 0;
  whisper.port = 0;
  console.log(`[whisper] server exited (code=${code})`);
  if (whisper.stopping || quitting) return;
  if (!voiceWanted && !voiceActive) return;
  // Only auto-restart a server that had actually come up (i.e. crashed mid-session).
  if (wasReady) void restartWhisperServer();
}

/** Restart the server after a crash, bounded by WHISPER_MAX_RESTARTS. */
async function restartWhisperServer() {
  if (whisper.restarts >= WHISPER_MAX_RESTARTS) {
    console.warn(`[voice] whisper-server crashed ${whisper.restarts}× — giving up`);
    voiceActive = false;
    if (voiceHopTimer) {
      clearInterval(voiceHopTimer);
      voiceHopTimer = null;
    }
    setVoiceStatus("server-error");
    return;
  }
  whisper.restarts += 1;
  setVoiceStatus("starting");
  console.log(
    `[voice] restarting whisper-server (attempt ${whisper.restarts}/${WHISPER_MAX_RESTARTS})`,
  );
  const ok = await ensureWhisperServer();
  if (ok) {
    if (voiceActive) setVoiceStatus("listening");
  } else {
    setVoiceStatus("server-error");
  }
}

function stopWhisperServer() {
  whisper.stopping = true;
  if (whisper.proc) {
    try {
      whisper.proc.kill();
    } catch {
      // ignore
    }
  }
  whisper.proc = null;
  whisper.ready = false;
  whisper.pid = 0;
  whisper.port = 0;
}

/** POST a 16 kHz mono PCM window to whisper-server /inference, return text. */
async function transcribeWindow(samples) {
  if (!whisper.ready || !whisper.port) return "";
  const wav = voicePipeline.encodeWav(samples, voicePipeline.VOICE_SAMPLE_RATE);
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "window.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("language", "en");
  const res = await fetch(`http://127.0.0.1:${whisper.port}/inference`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`whisper HTTP ${res.status}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return text;
  }
}

/** Forward one committed transcript to the overlay (translation happens there). */
function forwardVoiceCommit(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  // Existing overlay capture channel (no `source`): the overlay translates it
  // through the normal /api/translate path and renders a subtitle result.
  deliverOverlayCapture({ text: trimmed });
  console.log(`[voice] → overlay: "${trimmed}"`);
}

/** One rolling-window pass: whisper → commit → maybe forward. */
async function runVoicePass() {
  if (!voiceActive || voicePassBusy || !voiceRing || !voiceCommitter) return;
  if (voiceRing.size < voicePipeline.VOICE_SAMPLE_RATE * 0.5) return; // < ~0.5 s
  voicePassBusy = true;
  voicePassCount += 1;
  const pass = voicePassCount;
  const startedAt = Date.now();
  try {
    const wantSamples = Math.round(
      (voicePipeline.VOICE_SAMPLE_RATE * voicePipeline.VOICE_WINDOW_MS) / 1000,
    );
    const samples = voiceRing.takeLast(wantSamples);
    voiceLastRms = voicePipeline.rms(samples);

    // Energy gate (fast pre-filter): silent windows never reach whisper-server.
    // Silero VAD runs server-side too (--vad) when its model is present; silent
    // windows still feed "" so the 2-pass commit/utterance-end logic is intact.
    if (voiceLastRms < 0.002) {
      const result = voiceCommitter.feed("");
      console.log(
        `[voice] pass#${pass} silence (rms=${voiceLastRms.toFixed(5)})${result && result.ended ? ` → ended: "${result.ended}"` : ""}`,
      );
      return;
    }

    const raw = await transcribeWindow(samples);
    const sttMs = Date.now() - startedAt;
    voiceLastTranscript = voicePipeline.normalizeTranscript(raw);
    const result = voiceCommitter.feed(raw);
    if (!result) {
      console.log(`[voice] pass#${pass} stt=${sttMs}ms "${voiceLastTranscript}" (no commit)`);
      return;
    }
    if (result.ended) {
      console.log(`[voice] pass#${pass} stt=${sttMs}ms ended: "${result.ended}"`);
      return;
    }
    voiceCommitCount += 1;
    voiceLastCommit = result.committed;
    voiceLastCommitAt = Date.now();
    console.log(
      `[voice] pass#${pass} stt=${sttMs}ms commit="${result.committed}" (+${result.delta})`,
    );
    forwardVoiceCommit(result.committed);
  } catch (error) {
    console.warn(
      `[voice] pass#${pass} error:`,
      error && error.message ? error.message : error,
    );
  } finally {
    voicePassBusy = false;
  }
}

/** Ask the reader window to start/stop loopback capture (injects shim on load). */
function requestVoiceCapture(on) {
  const win = ensureMainWindow();
  if (!win || win.isDestroyed()) {
    console.warn("[voice] no reader window available for capture");
    return;
  }
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("subtr:voice-toggle", on);
    }
  };
  // If the shim has not signalled readiness yet, queue the toggle; it is flushed
  // from the voice-shim-ready handler once the shim subscribes.
  if (!voiceShimReady) {
    voiceTogglePending = on;
    return;
  }
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

function sendPendingVoiceToggle() {
  if (voiceTogglePending === null) return;
  const on = voiceTogglePending;
  voiceTogglePending = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("subtr:voice-toggle", on);
    } catch {
      // ignore
    }
  }
}

async function startVoice() {
  const setup = voiceSetupStatus();
  if (!setup.ready) {
    setVoiceStatus("needs-setup");
    showVoiceSetupDialog();
    return;
  }
  if (voiceWanted && voiceActive) return;

  voiceWanted = true;
  whisper.restarts = 0;
  setVoiceStatus("starting");
  console.log("[voice] start requested");
  try {
    console.log("[voice] screen capture permission:", systemPreferences.getMediaAccessStatus("screen"));
  } catch {
    // ignore
  }

  const ok = await ensureWhisperServer();
  if (!ok) {
    voiceWanted = false;
    setVoiceStatus("error");
    return;
  }

  const maxSamples = Math.round(
    voicePipeline.VOICE_SAMPLE_RATE * (voicePipeline.VOICE_WINDOW_MS / 1000 + 1),
  );
  voiceRing = new voicePipeline.PcmRingBuffer(maxSamples);
  voiceCommitter = new voicePipeline.VoiceCommitter();
  voicePassCount = 0;
  voiceCommitCount = 0;
  voicePcmSeen = 0;
  voiceActive = true;

  requestVoiceCapture(true);
  if (!voiceHopTimer) {
    voiceHopTimer = setInterval(() => void runVoicePass(), voicePipeline.VOICE_HOP_MS);
  }
  setVoiceStatus("listening");
  console.log(
    `[voice] listening (window=${voicePipeline.VOICE_WINDOW_MS}ms hop=${voicePipeline.VOICE_HOP_MS}ms)`,
  );
}

function stopVoice() {
  if (!voiceWanted && !voiceActive) return;
  voiceWanted = false;
  voiceActive = false;
  if (voiceHopTimer) {
    clearInterval(voiceHopTimer);
    voiceHopTimer = null;
  }
  requestVoiceCapture(false);
  if (voiceRing) voiceRing.clear();
  voiceCommitter = null;
  setVoiceStatus("off");
  console.log("[voice] stopped");
}

/** Tray trigger: toggle voice mode (or explain setup). */
function toggleVoice() {
  const setup = voiceSetupStatus();
  if (!setup.ready) {
    setVoiceStatus("needs-setup");
    showVoiceSetupDialog();
    return;
  }
  if (voiceWanted || voiceActive) stopVoice();
  else void startVoice();
}

/** Renderer-reported status ("starting"/"listening"/"off"/"error"). */
function applyRendererVoiceStatus(value) {
  if (value !== "starting" && value !== "listening" && value !== "off" && value !== "error") {
    return;
  }
  if (value === "error") {
    if (voiceHopTimer) {
      clearInterval(voiceHopTimer);
      voiceHopTimer = null;
    }
    voiceActive = false;
    voiceWanted = false;
    voiceStatus = "error";
    console.warn("[voice] renderer reported error; stopping");
    return;
  }
  // Renderer statuses arrive asynchronously. Ignore progress states ("starting"/
  // "listening") once the session is no longer on, so a late shim report can't
  // resurrect a stale "listening" label after stop. (Symmetric counterpart to the
  // "off while active" guard below — the old code only guarded the "off" side.)
  if ((value === "starting" || value === "listening") && !voiceActive && !voiceWanted) {
    console.log(`[voice] renderer status=${value} (ignored; session inactive)`);
    return;
  }
  // Never regress an already-active session back to "starting".
  if (value === "starting" && voiceActive) {
    console.log("[voice] renderer status=starting (ignored; already active)");
    return;
  }
  voiceStatus = value === "off" && voiceActive ? voiceStatus : value;
  console.log(`[voice] renderer status=${value}`);
}

/** Coerce an IPC-arrived PCM payload to an Int16Array (or null). */
function toInt16View(buffer) {
  if (!buffer) return null;
  let bytes;
  if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
  else if (ArrayBuffer.isView(buffer)) {
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else return null;
  const count = Math.floor(bytes.byteLength / 2);
  if (count === 0) return null;
  const copy = bytes.slice(bytes.byteOffset, bytes.byteOffset + count * 2);
  return new Int16Array(copy.buffer, copy.byteOffset, count);
}

function registerVoiceIpc() {
  ipcMain.on("subtr:voice-audio", (event, buffer) => {
    if (!isFromMainWindow(event)) return;
    if (!voiceActive || !voiceRing) return;
    const view = toInt16View(buffer);
    if (!view) return;
    voiceRing.append(view);
    voicePcmSeen += view.length;
  });

  ipcMain.on("subtr:voice-status", (event, value) => {
    if (!isFromMainWindow(event)) return;
    if (typeof value !== "string") return;
    applyRendererVoiceStatus(value);
  });

  ipcMain.on("subtr:voice-log", (event, message) => {
    if (!isFromMainWindow(event)) return;
    console.log(`[voice:renderer] ${String(message).slice(0, 500)}`);
  });

  ipcMain.on("subtr:voice-shim-ready", (event) => {
    if (!isFromMainWindow(event)) return;
    voiceShimReady = true;
    console.log("[voice] capture shim ready");
    if (voiceTogglePending === null && voiceWanted) voiceTogglePending = true;
    sendPendingVoiceToggle();
  });

  ipcMain.handle("subtr:voice-setup", () => voiceSetupStatus());

  // Renderer-driven master toggle (settings Voice section). Same code path as
  // the tray item; returns the fresh voice snapshot for an immediate UI refresh.
  ipcMain.handle("subtr:voice-set-enabled", (event, enabled) => {
    if (!isFromOurWindow(event)) return { ...voiceSnapshot(), error: "unauthorized" };
    return setVoiceEnabled(enabled === true);
  });

  // Model catalog + download (driven by the settings UI lane).
  ipcMain.handle("subtr:voice-models", () => listModels());
  ipcMain.handle("subtr:voice-download-model", (event, id) => {
    if (!isFromMainWindow(event)) return { ok: false, error: "unauthorized" };
    return downloadModel(typeof id === "string" && id ? id : DEFAULT_MODEL_ID);
  });
}

/** Inject the loopback capture shim into the reader window (idempotent). */
async function injectVoiceCaptureShim() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  voiceShimReady = false;
  try {
    const source = fs.readFileSync(path.join(__dirname, "voice-capture.js"), "utf8");
    await mainWindow.webContents.executeJavaScript(source, true);
  } catch (error) {
    console.warn(
      "[voice] capture shim injection failed:",
      error && error.message ? error.message : error,
    );
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
    width: 838,
    height: 556,
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
  // The voice capture shim is injected on every load so a recreated reader
  // window can still be driven from the tray trigger. Readiness (and any queued
  // toggle) is handled via the voice-shim-ready handshake.
  mainWindow.webContents.on("did-finish-load", () => {
    void injectVoiceCaptureShim();
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
      // Server-side plugins live in the app's userData dir in packaged builds.
      SUBTR_PLUGINS_DIR: path.join(app.getPath("userData"), "plugins"),
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
    // Labels of the freshly built tray menu (stats header + actions), for E2E.
    globalThis.__subtrTrayMenuLabels = () => trayMenuLabels();

    // --- Voice (Beta) automation hooks -------------------------------------
    globalThis.__subtrVoice = () => voiceSnapshot();
    globalThis.__subtrVoiceSetup = () => voiceSetupStatus();
    globalThis.__subtrVoiceModels = () => listModels();
    globalThis.__subtrVoiceDownload = (id) => downloadModel(id);
    globalThis.__subtrVoiceEnsureServer = () => ensureWhisperServer();
    globalThis.__subtrVoiceKillServer = () => {
      if (!whisper.proc) return 0;
      const pid = whisper.pid;
      try {
        whisper.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      return pid;
    };
    globalThis.__subtrVoiceStart = () => startVoice();
    globalThis.__subtrVoiceStop = () => stopVoice();
    globalThis.__subtrVoiceToggle = () => toggleVoice();
    // Drive the real committer (and overlay hand-off) with a transcript, so the
    // commit + display spine can be verified without live loopback audio.
    globalThis.__subtrVoiceFeed = (transcript) => {
      if (!voiceCommitter) voiceCommitter = new voicePipeline.VoiceCommitter();
      const result = voiceCommitter.feed(transcript);
      if (result && result.committed) {
        voiceCommitCount += 1;
        voiceLastCommit = result.committed;
        voiceLastCommitAt = Date.now();
        forwardVoiceCommit(result.committed);
      }
      return result;
    };
    // Transcribe a base64 WAV directly via whisper-server (bypasses capture).
    globalThis.__subtrVoiceTranscribe = async (wavBase64) => {
      const ok = await ensureWhisperServer();
      if (!ok) return { ok: false, error: "whisper-server unavailable" };
      const bytes = Buffer.from(String(wavBase64), "base64");
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/wav" }), "test.wav");
      form.append("response_format", "json");
      form.append("temperature", "0");
      form.append("language", "en");
      const res = await fetch(`http://127.0.0.1:${whisper.port}/inference`, {
        method: "POST",
        body: form,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    };
  }

  registerOverlayIpc();
  registerVoiceIpc();

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
  stopWhisperServer();
  stopServer();
});

// Keep the variable referenced so linters don't flag it; documents intent.
void quitting;
