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

module.exports = { buildFrames, encodePNG, rasterize };

if (require.main === module) {
  const outDir = process.argv[2] || path.join(__dirname, "tray-icons");
  fs.mkdirSync(outDir, { recursive: true });
  const frames = buildFrames();
  const write = (name, frame) => {
    fs.writeFileSync(path.join(outDir, `${name}.png`), frame[16].png);
    fs.writeFileSync(path.join(outDir, `${name}@2x.png`), frame[32].png);
  };
  write("trayTemplate", frames.off);
  write("trayTemplateActive", frames.on);
  frames.burstOn.forEach((f, i) => write(`trayBurstOn-${i}`, f));
  frames.burstOff.forEach((f, i) => write(`trayBurstOff-${i}`, f));
  console.log(`wrote tray PNGs to ${outDir}`);
}
