// Image Translate — plugin entry (phase P2).
//
// Capture a frozen screen region → Apple Vision OCR → pre-translate every block
// through the app's active profile → draw Live Text-style highlights → show the
// translation of the hovered/selected box in the subtitle line.
//
// All heavy work is host-brokered (api.capture / api.overlay / api.translate /
// api.hotkey). The image never leaves the machine; only recognised text is sent
// for translation, through the app's own profile.
/* eslint-disable @typescript-eslint/no-require-imports -- plugin entry points are CommonJS by contract */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const PLUGIN_DIR = __dirname;
const CONFIG_PATH = path.join(PLUGIN_DIR, ".config.json");
const VISION_SRC = path.join(PLUGIN_DIR, "vision-ocr.swift");
const VISION_BIN = path.join(PLUGIN_DIR, "bin", "vision-ocr");
const VISION_STAMP = path.join(PLUGIN_DIR, "bin", ".build.json");

const CONFIG_VERSION = 2;
const DEFAULT_CONFIG = {
  engine: "auto", // "auto" | "vision" (PP-OCRv6 is a later phase)
  accelerator: "CommandOrControl+Shift+P",
  when: "translation-mode",
  targetLang: "auto",
  highlight: "glow", // "glow" | "box" | "underline"
  numbered: false, // numbers are OPT-IN (badges off by default)
  autoTranslate: true,
};

// --- config (plugin owns its folder) ---------------------------------------

function loadConfig() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION };
  }
  const merged = { ...DEFAULT_CONFIG, ...raw, configVersion: CONFIG_VERSION };
  // Migrate pre-v2 files: `numbered:true` was the OLD default (badges on for
  // everyone). Only files without a version stamp are treated that way, so an
  // explicit value written after this migration is respected.
  if (raw.configVersion === undefined && raw.numbered === true) {
    merged.numbered = false;
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
    } catch {
      // ignore
    }
  }
  return merged;
}

function saveConfig(next) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(next && typeof next === "object" ? next : {}),
    configVersion: CONFIG_VERSION,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// --- Vision OCR helper (build on first use, source-hash cached) ------------

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

let visionCache = null;
/** Timestamp of the last failed build, so a capture storm does not respawn swiftc. */
let visionLastFailureAt = 0;

/** Run `<bin> --version` and return its trimmed stdout (null when unusable). */
function helperVersion(bin) {
  try {
    if (!fs.existsSync(bin)) return null;
    const res = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    return res.status === 0 ? String(res.stdout || "").trim() || "unknown" : null;
  } catch {
    return null;
  }
}

/** Resolve a Swift compiler (xcrun is the most reliable under Finder launch). */
function findSwiftc() {
  const candidates = [];
  if (process.env.SUBTR_SWIFTC) candidates.push(process.env.SUBTR_SWIFTC);
  candidates.push("/usr/bin/swiftc", "swiftc");
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10000 });
      if (probe.status === 0) return candidate;
    } catch {
      // try next
    }
  }
  try {
    const found = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8", timeout: 10000 });
    const pathText = String(found.stdout || "").trim();
    if (found.status === 0 && pathText) return pathText;
  } catch {
    // ignore
  }
  return null;
}

function ensureVisionBuilt() {
  if (visionCache) return visionCache;
  if (visionLastFailureAt && Date.now() - visionLastFailureAt < 15000) {
    return {
      ok: false,
      reason: "build-failed",
      message: "Vision helper build failed recently; retry shortly.",
    };
  }

  // 1) Prebuilt helper (shipped in the plugin zip for arm64+x86_64). This is
  //    the normal path and needs no Xcode / Command Line Tools. Zip extraction
  //    can drop the executable bit, so restore it before probing.
  if (fs.existsSync(VISION_BIN)) {
    try {
      fs.chmodSync(VISION_BIN, 0o755);
    } catch {
      // ignore — helperVersion will report whether it can run
    }
  }
  const prebuiltVersion = helperVersion(VISION_BIN);
  if (prebuiltVersion) {
    visionCache = { ok: true, bin: VISION_BIN, version: prebuiltVersion, cached: true };
    return visionCache;
  }

  // 2) Compile-on-first-use fallback for source-only installs.
  let hash;
  try {
    hash = sha256(fs.readFileSync(VISION_SRC));
  } catch (error) {
    visionLastFailureAt = Date.now();
    return { ok: false, reason: "no-source", message: String(error) };
  }

  try {
    fs.mkdirSync(path.dirname(VISION_BIN), { recursive: true });
  } catch {
    // ignore
  }

  const swiftc = findSwiftc();
  if (!swiftc) {
    visionLastFailureAt = Date.now();
    return {
      ok: false,
      reason: "no-compiler",
      message: "No Swift compiler found (install Xcode Command Line Tools).",
    };
  }

  // Keep the module cache inside the plugin folder: Finder-launched apps do not
  // always have a writable default clang module cache.
  const cacheDir = path.join(path.dirname(VISION_BIN), ".swift-module-cache");
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    // ignore
  }

  const built = spawnSync(swiftc, ["-O", "-module-cache-path", cacheDir, "-o", VISION_BIN, VISION_SRC], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env },
  });
  if (built.status !== 0 || !fs.existsSync(VISION_BIN)) {
    visionLastFailureAt = Date.now();
    return {
      ok: false,
      reason: "build-failed",
      message: String(built.stderr || built.error || "swiftc failed").slice(0, 500),
    };
  }
  let version = "unknown";
  const v = spawnSync(VISION_BIN, ["--version"], { encoding: "utf8", timeout: 5000 });
  if (v.status === 0) version = String(v.stdout || "").trim();
  try {
    fs.writeFileSync(VISION_STAMP, JSON.stringify({ hash, version, builtAt: new Date().toISOString() }, null, 2));
  } catch {
    // ignore
  }
  visionCache = { ok: true, bin: VISION_BIN, version, cached: false, rebuilt: true };
  return visionCache;
}

function parseVisionOutput(stdout, version) {
  try {
    const parsed = JSON.parse(stdout);
    return { ok: true, blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [], version };
  } catch {
    return { ok: false, reason: "ocr-failed", message: "invalid helper output" };
  }
}

function runVision(imagePath) {
  const built = ensureVisionBuilt();
  if (!built.ok) return { ok: false, reason: "no-engine", message: built.message };

  const res = spawnSync(built.bin, [imagePath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30000,
  });
  if (res.status === 0) return parseVisionOutput(res.stdout, built.version);

  // The prebuilt helper should always run. If it does not (e.g. an exotic
  // architecture), fall back to the Swift interpreter before giving up.
  if (process.platform === "darwin") {
    const fallback = spawnSync("swift", [VISION_SRC, imagePath], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60000,
    });
    if (fallback.status === 0) {
      const parsed = parseVisionOutput(fallback.stdout, "swift-interpreter");
      if (parsed.ok) return parsed;
    }
  }

  return {
    ok: false,
    reason: "ocr-failed",
    message: String(res.stderr || res.error || "").slice(0, 300) || "Vision helper exited with an error",
  };
}

// --- helpers ---------------------------------------------------------------

function writeTempImage(imageDataUrl) {
  const comma = String(imageDataUrl).indexOf(",");
  const b64 = comma >= 0 ? imageDataUrl.slice(comma + 1) : imageDataUrl;
  const file = path.join(os.tmpdir(), `subtr-image-translate-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  return file;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

// --- TEST affordances (SUBTR_TEST only; no-ops in normal use) --------------

const TEST_LOG = process.env.SUBTR_IT_TEST_LOG || null;
function record(event) {
  if (!TEST_LOG) return;
  try {
    fs.appendFileSync(TEST_LOG, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
  } catch {
    // ignore
  }
}

/** Read a PNG's pixel size from its IHDR (test image path only). */
function pngSize(buf) {
  try {
    if (buf.length >= 24 && buf.toString("ascii", 12, 16) === "IHDR") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

function testImageShot() {
  const file = process.env.SUBTR_IT_TEST_IMAGE;
  if (!file) return null;
  try {
    const buf = fs.readFileSync(file);
    const size = pngSize(buf);
    return {
      ok: true,
      imageDataUrl: `data:image/png;base64,${buf.toString("base64")}`,
      widthPx: size.width,
      heightPx: size.height,
      scaleFactor: 1,
      rect: { x: 0, y: 0, w: size.width, h: size.height },
      displayId: 0,
      __test: true,
    };
  } catch (error) {
    record({ type: "error", where: "testImage", message: String(error) });
    return null;
  }
}

// --- activate --------------------------------------------------------------

async function activate(api) {
  let cfg = loadConfig();
  const state = {
    sessionId: null,
    boxes: [],
    translations: new Map(),
    hovered: null,
    translateError: null,
    translating: false,
    ocrError: null,
    captureError: null,
  };
  const translationCache = new Map(); // text → translation (across sessions)

  api.log.info(`image-translate ${api.plugin.version} activating`);

  async function showError(text) {
    try {
      await api.overlay.regions.hide();
    } catch {
      // ignore
    }
    try {
      await api.overlay.subtitle.show({ text, tone: "normal" });
    } catch {
      // ignore
    }
  }

  function reasonMessage(reason) {
    if (reason === "no-permission") {
      return "Screen recording is off — enable it in System Settings.";
    }
    if (reason === "no-display") return "Couldn't capture the screen.";
    return "Capture failed — try again.";
  }

  async function pretranslate(boxes) {
    state.translateError = null;
    state.translating = true;
    const pending = boxes.filter((b) => !translationCache.has(b.text));
    for (const group of chunk(pending, 8)) {
      let res;
      try {
        res = await api.translate.text({
          texts: group.map((b) => b.text),
          ...(cfg.targetLang && cfg.targetLang !== "auto" ? { targetLang: cfg.targetLang } : {}),
        });
      } catch (error) {
        res = { ok: false, reason: "error", message: String(error) };
      }
      if (res && res.ok && Array.isArray(res.translations)) {
        res.translations.forEach((t, i) => {
          const src = group[i];
          if (src && t && typeof t.text === "string") translationCache.set(src.text, t.text);
        });
        // Refresh the hovered line as soon as its translation is available —
        // otherwise a hover before the batch resolves stays stuck on
        // "Translating…" forever (the old 0.2.10 bug).
        for (const box of group) {
          const translated = translationCache.get(box.text);
          if (translated) state.translations.set(box.id, translated);
        }
        if (state.hovered) {
          void api.overlay.subtitle.show(subtitleForBox(state.hovered));
        }
      } else {
        // Record why so hover can degrade visibly and the status panel can show it.
        const reason = res && res.reason ? res.reason : "error";
        state.translateError = { reason, message: res && res.message ? res.message : undefined };
        record({ type: "translate.error", reason, message: state.translateError.message });
        if (reason === "no-profile") {
          await showError("Add a profile to translate.");
        }
        break;
      }
    }
    for (const b of boxes) {
      const t = translationCache.get(b.text);
      if (t) state.translations.set(b.id, t);
    }
    state.translating = false;
    if (state.hovered) {
      void api.overlay.subtitle.show(subtitleForBox(state.hovered));
    }
    record({
      type: "translated",
      ready: state.translations.size,
      total: boxes.length,
      error: state.translateError,
      translations: boxes.map((b) => translationCache.get(b.text) || null),
    });
  }

  /** The subtitle text/tone for a box, degrading visibly instead of stalling. */
  function subtitleForBox(boxId) {
    const t = state.translations.get(boxId);
    if (t) return { text: t, tone: "normal" };
    const box = state.boxes.find((b) => b.id === boxId);
    if (state.translateError) {
      const src = box && box.text ? `${box.text} · ` : "";
      const detail =
        state.translateError.reason === "no-profile"
          ? "Add a profile to translate."
          : "Translation unavailable";
      return { text: `${src}${detail}`, tone: "muted" };
    }
    const pending = box && box.text ? `${box.text} · ` : "";
    return { text: `${pending}Translating…`, tone: "muted" };
  }

  async function runCapture() {
    try {
      const testShot = testImageShot();
      const rectRaw = process.env.SUBTR_IT_TEST_RECT;
      const shot = testShot
        ? testShot
        : await api.capture.region(
            rectRaw ? { mode: "freeze", testRect: JSON.parse(rectRaw) } : { mode: "freeze" },
          );
      record({ type: "shot", source: testShot ? "test-image" : "capture", ok: !!(shot && shot.ok), reason: shot && shot.reason });
      if (!shot || !shot.ok) {
        if (!shot || shot.reason !== "cancelled") {
          state.captureError = (shot && shot.reason) || "error";
          await showError(reasonMessage(shot && shot.reason));
        }
        return;
      }
      state.captureError = null;
      let imagePath = null;
      let ocr;
      try {
        imagePath = writeTempImage(shot.imageDataUrl);
        ocr = runVision(imagePath);
      } finally {
        if (imagePath) {
          try {
            fs.unlinkSync(imagePath);
          } catch {
            // ignore
          }
        }
      }
      if (!ocr.ok) {
        state.ocrError = { reason: ocr.reason, message: ocr.message || null };
        record({ type: "ocr", ok: false, reason: ocr.reason, message: ocr.message });
        await showError(
          ocr.reason === "no-engine"
            ? "Text engine unavailable — the Vision helper could not load. See Image Translate settings."
            : "Text engine unavailable — the OCR helper failed. See Image Translate settings.",
        );
        return;
      }
      state.ocrError = null;
      record({ type: "ocr", ok: true, version: ocr.version, blocks: (ocr.blocks || []).length });
      const boxes = ocr.blocks
        .filter((b) => b && typeof b.text === "string" && b.text.trim().length > 0)
        .map((b, i) => ({
          id: `b${i}`,
          xPct: Number(b.xPct) || 0,
          yPct: Number(b.yPct) || 0,
          wPct: Number(b.wPct) || 0,
          hPct: Number(b.hPct) || 0,
          text: b.text.trim(),
        }));
      if (boxes.length === 0) {
        record({ type: "boxes", count: 0 });
        await showError("No text found in that area.");
        return;
      }
      record({ type: "boxes", count: boxes.length, texts: boxes.map((b) => b.text) });
      const shown = await api.overlay.regions.show({
        imageDataUrl: shot.imageDataUrl,
        widthPx: shot.widthPx,
        heightPx: shot.heightPx,
        boxes,
        style: { highlight: cfg.highlight, numbered: cfg.numbered },
        ...(process.env.SUBTR_IT_TEST_HOVER === "1" && boxes.length ? { testHoverId: boxes[0].id } : {}),
      });
      state.sessionId = shown && shown.ok ? shown.id : null;
      record({ type: "regionsShown", id: state.sessionId, boxes: boxes.length, ok: !!(shown && shown.ok) });
      state.boxes = boxes;
      state.translations = new Map();
      if (cfg.autoTranslate) void pretranslate(boxes);
    } catch (error) {
      api.log.error("capture flow failed:", String(error));
      await showError("Image translate failed.");
    }
  }

  // --- overlay interactions ------------------------------------------------
  api.overlay.regions.onRegionHover((e) => {
    if (!e || !e.boxId) {
      state.hovered = null;
      void api.overlay.subtitle.clear();
      return;
    }
    state.hovered = e.boxId;
    const s = subtitleForBox(e.boxId);
    record({ type: "hover", boxId: e.boxId, subtitle: s.text });
    void api.overlay.subtitle.show(s);
  });
  api.overlay.regions.onRegionSelect((e) => {
    if (!e || !e.boxId) return;
    const s = subtitleForBox(e.boxId);
    record({ type: "select", boxId: e.boxId, index: e.index, subtitle: s.text });
    void api.overlay.subtitle.show(s);
  });
  api.overlay.regions.onRegionDismiss((e) => {
    state.sessionId = null;
    state.hovered = null;
    record({ type: "dismiss", reason: e && e.reason });
    void api.overlay.regions.hide();
    void api.overlay.subtitle.clear();
  });

  // --- hotkey --------------------------------------------------------------
  async function registerHotkey(accel = cfg.accelerator, when = cfg.when) {
    const res = await api.hotkey.register({ accelerator: accel, when, onTrigger: () => void runCapture() });
    return res;
  }
  const hotkey = await registerHotkey();

  // --- plugin-owned HTTP namespace (settings panel bridge) -----------------
  api.http.serve({
    method: "GET",
    path: "status",
    handler: () => {
      const vision = ensureVisionBuilt();
      return {
        ok: true,
        version: api.plugin.version,
        config: cfg,
        engine: cfg.engine,
        hotkey: { accelerator: cfg.accelerator, when: cfg.when, registered: !!(hotkey && hotkey.ok) },
        // True when a capture is on screen; lastTranslateError explains a failed
        // pre-translation (surfaced instead of a stuck "Translating…").
        active: !!state.sessionId,
        translating: state.translating,
        readyTranslations: state.translations.size,
        totalBoxes: state.boxes.length,
        lastTranslateError: state.translateError || null,
        lastOcrError: state.ocrError || null,
        lastCaptureError: state.captureError || null,
        vision: {
          built: vision.ok === true,
          cached: vision.ok ? vision.cached === true : false,
          version: vision.ok ? vision.version : null,
          reason: vision.ok ? null : vision.reason,
          message: vision.ok ? null : vision.message,
        },
      };
    },
  });

  api.http.serve({
    method: "POST",
    path: "config",
    handler: async (ctx) => {
      cfg = saveConfig({ ...cfg, ...(ctx.body && typeof ctx.body === "object" ? ctx.body : {}) });
      let hotkeyResult = { ok: true, accelerator: cfg.accelerator };
      if (ctx.body && (ctx.body.accelerator || ctx.body.when)) {
        hotkeyResult = await registerHotkey(cfg.accelerator, cfg.when);
      }
      return { ok: true, config: cfg, hotkey: hotkeyResult };
    },
  });

  api.http.serve({
    method: "POST",
    path: "test-hotkey",
    handler: async () => {
      const res = await registerHotkey(cfg.accelerator, cfg.when);
      return { ok: !!(res && res.ok), result: res };
    },
  });

  api.http.serve({
    method: "POST",
    path: "ocr",
    handler: (ctx) => {
      const imageDataUrl = ctx.body && typeof ctx.body.imageDataUrl === "string" ? ctx.body.imageDataUrl : "";
      if (!imageDataUrl) return { ok: false, reason: "no-image" };
      let imagePath = null;
      try {
        imagePath = writeTempImage(imageDataUrl);
        const ocr = runVision(imagePath);
        if (!ocr.ok) return { ok: false, reason: ocr.reason, message: ocr.message };
        return { ok: true, version: ocr.version, blocks: ocr.blocks };
      } finally {
        if (imagePath) {
          try {
            fs.unlinkSync(imagePath);
          } catch {
            // ignore
          }
        }
      }
    },
  });

  api.log.info(`image-translate ready (hotkey ${cfg.accelerator}${hotkey && hotkey.ok ? "" : ` — ${hotkey && hotkey.reason}`})`);

  return {
    deactivate() {
      api.log.info("image-translate deactivated");
      try {
        api.overlay.regions.hide();
      } catch {
        // ignore
      }
    },
  };
}

module.exports = { activate };
