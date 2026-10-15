// SubTr tray icon generator — pure JS (node:zlib only), no native deps.
//
// Rasterizes a simple menubar glyph pair:
//   off/idle : hollow rounded square with two "caption" bars (translate idle)
//   on/active: filled rounded square with the bars knocked out (translating)
// and a short 5-frame burst for each transition (used as a ~400ms animation).
//
// Exported for in-memory use by desktop/main.cjs; run directly to dump PNGs:
//   node desktop/tray-icons.cjs [outDir]
"use strict";

const zlib = require("node:zlib");
const path = require("node:path");
const fs = require("node:fs");

const SIZES = [16, 32]; // 16px base + 32px @2x
const SS = 4; // supersample factor for antialiasing

/** Coverage test for a rounded rectangle. */
function inRoundRect(px, py, rect) {
  const { x, y, w, h, r } = rect;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Two short stacked bars (caption lines) centered in a `size` square. */
function inBars(px, py, size) {
  const bar1 = { x: size * 0.30, y: size * 0.375, w: size * 0.40, h: size * 0.09, r: size * 0.045 };
  const bar2 = { x: size * 0.30, y: size * 0.545, w: size * 0.26, h: size * 0.09, r: size * 0.045 };
  return inRoundRect(px, py, bar1) || inRoundRect(px, py, bar2);
}

/**
 * Rasterize one frame to RGBA (black + alpha; suitable for a macOS template image).
 * @param {number} size
 * @param {{ filled: number, scale: number }} spec
 * @returns {Uint8Array}
 */
function rasterize(size, { filled, scale }) {
  const W = size * SS;
  const ring = new Float32Array(size * size);
  const interior = new Float32Array(size * size);
  const bars = new Float32Array(size * size);

  const outer = { x: size * 0.11, y: size * 0.11, w: size * 0.78, h: size * 0.78, r: size * 0.26 };
  const thickness = size * 0.11;
  const inner = {
    x: outer.x + thickness,
    y: outer.y + thickness,
    w: outer.w - 2 * thickness,
    h: outer.h - 2 * thickness,
    r: Math.max(outer.r - thickness, 0),
  };

  const c = size / 2;
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const px = (X + 0.5) / SS;
      const py = (Y + 0.5) / SS;
      // Scale about the centre.
      const ux = (px - c) / scale + c;
      const uy = (py - c) / scale + c;
      if (!inRoundRect(ux, uy, outer)) continue;
      const i = ((Y / SS) | 0) * size + ((X / SS) | 0);
      if (inRoundRect(ux, uy, inner)) {
        if (inBars(ux, uy, size)) bars[i] += 1;
        else interior[i] += 1;
      } else {
        ring[i] += 1;
      }
    }
  }

  const per = SS * SS;
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a =
      ring[i] / per +
      (interior[i] / per) * filled +
      (bars[i] / per) * (1 - filled);
    rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return rgba;
}

/** RGBA → BGRA (Electron's nativeImage raw bitmap order). */
function toBGRA(rgba) {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encode a square RGBA buffer as a PNG (color type 6, 8-bit). */
function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Transition bursts: [filled, scale] — a quick outward pulse while the fill morphs.
const BURST_ON = [
  [0.18, 0.92],
  [0.55, 1.07],
  [0.85, 0.99],
  [1, 1.05],
  [1, 1],
];
const BURST_OFF = [
  [0.82, 0.92],
  [0.45, 1.07],
  [0.15, 0.99],
  [0, 1.05],
  [0, 1],
];

function buildFrame(spec) {
  const frame = {};
  for (const size of SIZES) {
    const rgba = rasterize(size, spec);
    frame[size] = { png: encodePNG(size, rgba), bgra: toBGRA(rgba) };
  }
  return frame;
}

/** Build every frame (resting + burst) for both states. */
function buildFrames() {
  return {
    sizes: SIZES,
    off: buildFrame({ filled: 0, scale: 1 }),
    on: buildFrame({ filled: 1, scale: 1 }),
    burstOn: BURST_ON.map(([filled, scale]) => buildFrame({ filled, scale })),
    burstOff: BURST_OFF.map(([filled, scale]) => buildFrame({ filled, scale })),
  };
}

// ---------------------------------------------------------------------------
// Menu-item glyphs — 16×16 (+@2x) macOS *template* PNGs for MenuItem.icon.
// Black + alpha only, so they adapt to light/dark menu bars automatically.
// ---------------------------------------------------------------------------

const MENU_SIZES = [16, 32];

/** Point helpers used by the glyph definitions (all in logical px). */
function dist(px, py, cx, cy) {
  return Math.hypot(px - cx, py - cy);
}
function disc(px, py, cx, cy, r) {
  return dist(px, py, cx, cy) <= r;
}
function ringAt(px, py, cx, cy, r, t) {
  return Math.abs(dist(px, py, cx, cy) - r) <= t / 2;
}
function ellipseRing(px, py, cx, cy, rx, ry, t) {
  const e = Math.hypot((px - cx) / rx, (py - cy) / ry);
  return Math.abs(e - 1) <= (t / 2) / Math.min(rx, ry);
}
function roundRectPx(px, py, x, y, w, h, r) {
  return inRoundRect(px, py, { x, y, w, h, r });
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function seg(px, py, x1, y1, x2, y2, t) {
  return segDist(px, py, x1, y1, x2, y2) <= t / 2;
}
function triangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
function angleAt(px, py, cx, cy) {
  return Math.atan2(py - cy, px - cx);
}

/** Glyph draw functions: inside(px, py, size) → boolean, in a size×size box. */

/** Eye — "Show SubTr". */
function glyphShow(px, py, s) {
  const cx = s * 0.5;
  const cy = s * 0.5;
  return ellipseRing(px, py, cx, cy, s * 0.42, s * 0.26, s * 0.09) || disc(px, py, cx, cy, s * 0.115);
}

/** Speech bubble — "Toggle translation". */
function glyphTranslate(px, py, s) {
  const x = s * 0.12;
  const y = s * 0.15;
  const w = s * 0.76;
  const h = s * 0.52;
  const r = s * 0.13;
  const t = s * 0.085;
  const bubble =
    roundRectPx(px, py, x, y, w, h, r) &&
    !roundRectPx(px, py, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(r - t, 0));
  const tail = triangle(px, py, s * 0.3, s * 0.66, s * 0.3, s * 0.87, s * 0.49, s * 0.66);
  const line1 = roundRectPx(px, py, s * 0.26, s * 0.3, s * 0.3, s * 0.075, s * 0.037);
  const line2 = roundRectPx(px, py, s * 0.26, s * 0.45, s * 0.2, s * 0.075, s * 0.037);
  return bubble || tail || line1 || line2;
}

/** Microphone — voice (Beta). */
function glyphMic(px, py, s) {
  const cx = s * 0.5;
  const capsule = roundRectPx(px, py, s * 0.375, s * 0.12, s * 0.25, s * 0.42, s * 0.125);
  const a = angleAt(px, py, cx, s * 0.48);
  const uArc = a > 0.12 && a < Math.PI - 0.12 && ringAt(px, py, cx, s * 0.48, s * 0.24, s * 0.085);
  const stem = seg(px, py, cx, s * 0.72, cx, s * 0.82, s * 0.085);
  const base = roundRectPx(px, py, s * 0.33, s * 0.82, s * 0.34, s * 0.08, s * 0.04);
  return capsule || uArc || stem || base;
}

/** Cog — settings / setup. */
function glyphGear(px, py, s) {
  const cx = s * 0.5;
  const cy = s * 0.52;
  if (ringAt(px, py, cx, cy, s * 0.22, s * 0.1)) return true;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (disc(px, py, cx + Math.cos(a) * s * 0.34, cy + Math.sin(a) * s * 0.34, s * 0.075)) return true;
  }
  return false;
}

/** Bar chart — Usage submenu parent. */
function glyphUsage(px, py, s) {
  return (
    roundRectPx(px, py, s * 0.16, s * 0.52, s * 0.14, s * 0.34, s * 0.05) ||
    roundRectPx(px, py, s * 0.38, s * 0.34, s * 0.14, s * 0.52, s * 0.05) ||
    roundRectPx(px, py, s * 0.6, s * 0.2, s * 0.14, s * 0.66, s * 0.05)
  );
}

/** Downward arrow — download model. */
function glyphDownload(px, py, s) {
  const shaft = seg(px, py, s * 0.5, s * 0.14, s * 0.5, s * 0.56, s * 0.1);
  const head = triangle(px, py, s * 0.33, s * 0.5, s * 0.67, s * 0.5, s * 0.5, s * 0.72);
  const base = roundRectPx(px, py, s * 0.24, s * 0.8, s * 0.52, s * 0.09, s * 0.045);
  return shaft || head || base;
}

/** Power symbol — quit. */
function glyphPower(px, py, s) {
  const cx = s * 0.5;
  const cy = s * 0.55;
  const a = angleAt(px, py, cx, cy);
  const gapAtTop = !(a > -0.62 * Math.PI && a < -0.38 * Math.PI);
  const arc = gapAtTop && ringAt(px, py, cx, cy, s * 0.3, s * 0.1);
  const stem = seg(px, py, cx, s * 0.13, cx, s * 0.5, s * 0.1);
  return arc || stem;
}

const MENU_GLYPHS = {
  show: glyphShow,
  translate: glyphTranslate,
  mic: glyphMic,
  gear: glyphGear,
  usage: glyphUsage,
  download: glyphDownload,
  power: glyphPower,
};

/** Rasterize a boolean glyph to a black+alpha RGBA buffer at `size`. */
function rasterizeGlyph(size, inside) {
  const W = size * SS;
  const cov = new Float32Array(size * size);
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const px = (X + 0.5) / SS;
      const py = (Y + 0.5) / SS;
      if (inside(px, py, size)) cov[((Y / SS) | 0) * size + ((X / SS) | 0)] += 1;
    }
  }
  const per = SS * SS;
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4 + 3] = Math.round(Math.min(1, cov[i] / per) * 255);
  }
  return rgba;
}

function buildMenuIcon(name) {
  const inside = MENU_GLYPHS[name];
  if (!inside) throw new Error(`unknown menu glyph: ${name}`);
  const frame = {};
  for (const size of MENU_SIZES) {
    const rgba = rasterizeGlyph(size, inside);
    frame[size] = { png: encodePNG(size, rgba), bgra: toBGRA(rgba) };
  }
  return frame;
}

/** Build every menu glyph (16px base + 32px @2x). */
function buildMenuIcons() {
  const out = {};
  for (const name of Object.keys(MENU_GLYPHS)) out[name] = buildMenuIcon(name);
  return out;
}

module.exports = { buildFrames, buildMenuIcons, encodePNG, rasterize, MENU_SIZES, MENU_GLYPHS };

if (require.main === module) {
  const outDir = process.argv[2] || path.join(__dirname, "tray-icons");
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, frame) => {
    fs.writeFileSync(path.join(outDir, `${name}.png`), frame[16].png);
    fs.writeFileSync(path.join(outDir, `${name}@2x.png`), frame[32].png);
  };
  const frames = buildFrames();
  write("trayTemplate", frames.off);
  write("trayTemplateActive", frames.on);
  frames.burstOn.forEach((f, i) => write(`trayBurstOn-${i}`, f));
  frames.burstOff.forEach((f, i) => write(`trayBurstOff-${i}`, f));
  for (const name of Object.keys(MENU_GLYPHS)) write(`menu-${name}`, buildMenuIcon(name));
  console.log(`wrote tray + menu PNGs to ${outDir}`);
}
