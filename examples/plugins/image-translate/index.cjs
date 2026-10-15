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

function ensureVisionBuilt() {
  if (visionCache && visionCache.ok) return visionCache;
  let hash;
  try {
    hash = sha256(fs.readFileSync(VISION_SRC));
  } catch (error) {
    return { ok: false, reason: "no-source", message: String(error) };
  }
  let stamp = null;
  try {
    stamp = JSON.parse(fs.readFileSync(VISION_STAMP, "utf8"));
  } catch {
    stamp = null;
  }
  if (stamp && stamp.hash === hash && fs.existsSync(VISION_BIN)) {
    visionCache = { ok: true, bin: VISION_BIN, version: stamp.version || "unknown", cached: true };
    return visionCache;
  }
  try {
    fs.mkdirSync(path.dirname(VISION_BIN), { recursive: true });
  } catch {
    // ignore
  }
  const built = spawnSync("swiftc", ["-O", "-o", VISION_BIN, VISION_SRC], { encoding: "utf8" });
  if (built.status !== 0 || !fs.existsSync(VISION_BIN)) {
    return {
      ok: false,
      reason: "build-failed",
      message: String(built.stderr || built.error || "swiftc failed").slice(0, 400),
    };
  }
  let version = "unknown";
  const v = spawnSync(VISION_BIN, ["--version"], { encoding: "utf8" });
  if (v.status === 0) version = String(v.stdout || "").trim();
  try {
    fs.writeFileSync(VISION_STAMP, JSON.stringify({ hash, version, builtAt: new Date().toISOString() }, null, 2));
  } catch {
    // ignore
  }
  visionCache = { ok: true, bin: VISION_BIN, version, cached: false, rebuilt: true };
  return visionCache;
}

function runVision(imagePath) {
  const built = ensureVisionBuilt();
  if (!built.ok) return { ok: false, reason: "no-engine", message: built.message };
  const res = spawnSync(built.bin, [imagePath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) {
    return { ok: false, reason: "ocr-failed", message: String(res.stderr || "").slice(0, 300) };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return { ok: true, blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [], version: built.version };
  } catch {
    return { ok: false, reason: "ocr-failed", message: "invalid helper output" };
  }
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
  const state = { sessionId: null, boxes: [], translations: new Map(), hovered: null, translateError: null };
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
    return "Capture failed.";
  }

  async function pretranslate(boxes) {
    state.translateError = null;
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
      const detail = state.translateError.reason === "no-profile" ? "" : " · Translation unavailable";
      return { text: `${src}翻译暂不可用${detail}`, tone: "muted" };
    }
    return { text: "Translating…", tone: "muted" };
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
        if (!shot || shot.reason !== "cancelled") await showError(reasonMessage(shot && shot.reason));
        return;
      }
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
        record({ type: "ocr", ok: false, reason: ocr.reason, message: ocr.message });
        await showError(
          ocr.reason === "no-engine"
            ? "Text engine unavailable (Vision helper could not build)."
            : "Text engine unavailable.",
        );
        return;
      }
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
        lastTranslateError: state.translateError || null,
        vision: {
          built: vision.ok === true,
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
