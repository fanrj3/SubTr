// Build importable plugin .zip packages from examples/plugins/<id>/ folders.
// Usage: npm run plugins:zip  ->  examples/plugin-zips/<id>.zip
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "examples", "plugins");
const outDir = join(root, "examples", "plugin-zips");

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
let built = 0;
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pluginDir = join(srcDir, entry.name);
  const manifestPath = join(pluginDir, "manifest.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const id = manifest.id;
  const files = {};
  for (const file of collectFiles(pluginDir)) {
    const rel = relative(pluginDir, file).split("\\").join("/");
    files[`${id}/${rel}`] = new Uint8Array(readFileSync(file));
  }
  const zip = zipSync(files, { level: 9 });
  const outPath = join(outDir, `${id}.zip`);
  writeFileSync(outPath, zip);
  console.log(`packed ${entry.name} -> examples/plugin-zips/${id}.zip (${(zip.length / 1024).toFixed(1)} KB)`);
  built += 1;
}
console.log(`done: ${built} plugin zip(s) in examples/plugin-zips/`);
