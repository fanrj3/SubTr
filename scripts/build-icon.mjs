// Rasterize build/icon.svg → PNGs → build/icon.iconset → build/icon.icns.
//
// Usage:  npm run icon:build
//
// Rasterization uses Playwright's Chromium (a dev dependency) so we get crisp,
// transparent PNGs at every size; `sips`/`iconutil` then build the .icns. If
// build/icon.svg is missing, a temporary placeholder is used so the pipeline can
// still be validated end to end.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");
const svgPath = join(buildDir, "icon.svg");
const iconsetDir = join(buildDir, "icon.iconset");
const icnsPath = join(buildDir, "icon.icns");
const pngPath = join(buildDir, "icon.png");

const SIZES = [16, 32, 64, 128, 256, 512, 1024];

function placeholderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5aa9ff"/>
      <stop offset="1" stop-color="#2b6ef5"/>
    </linearGradient>
  </defs>
  <rect x="72" y="72" width="880" height="880" rx="208" fill="url(#g)"/>
  <text x="512" y="716" font-family="-apple-system, Helvetica, Arial, sans-serif"
        font-size="540" font-weight="700" fill="#ffffff" text-anchor="middle">S</text>
</svg>
`;
}

async function main() {
  mkdirSync(buildDir, { recursive: true });

  let usedPlaceholder = false;
  if (!existsSync(svgPath)) {
    writeFileSync(svgPath, placeholderSvg());
    usedPlaceholder = true;
    console.log("[icon] build/icon.svg missing → wrote a temporary placeholder");
  }
  const svg = readFileSync(svgPath, "utf8");

  // --- rasterize with Chromium ---------------------------------------------
  const require = createRequire(join(root, "package.json"));
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    console.error("[icon] playwright not available:", error && error.message ? error.message : error);
    process.exit(1);
  }

  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const rendered = {};
    for (const size of SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<!doctype html><style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
        { waitUntil: "load" },
      );
      const file = join(buildDir, `.icon-${size}.png`);
      await page.screenshot({ path: file, omitBackground: true });
      rendered[size] = file;
    }

    // icon.iconset naming (base + @2x pairs).
    const pairs = [
      [16, 16],
      [32, 32],
      [128, 128],
      [256, 256],
      [512, 512],
    ];
    for (const [base] of pairs) {
      copyFileSync(rendered[base], join(iconsetDir, `icon_${base}x${base}.png`));
      copyFileSync(rendered[base * 2], join(iconsetDir, `icon_${base}x${base}@2x.png`));
    }
    // Windows/Linux use a single 1024 PNG.
    copyFileSync(rendered[1024], pngPath);
    for (const size of SIZES) rmSync(rendered[size], { force: true });
  } finally {
    await browser.close();
  }

  // --- .icns ---------------------------------------------------------------
  const icns = spawnSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], { encoding: "utf8" });
  if (icns.status !== 0 || !existsSync(icnsPath)) {
    console.error("[icon] iconutil failed:", String(icns.stderr || icns.error || "").slice(0, 400));
    process.exit(1);
  }

  const icnsKb = (readFileSync(icnsPath).length / 1024).toFixed(1);
  console.log(
    `[icon] built build/icon.icns (${icnsKb} KB) + build/icon.png from ${usedPlaceholder ? "PLACEHOLDER" : "build/icon.svg"}`,
  );
}

main().catch((error) => {
  console.error("[icon] failed:", error && error.stack ? error.stack : String(error));
  process.exit(1);
});
