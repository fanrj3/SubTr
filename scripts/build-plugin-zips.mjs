// Build importable plugin .zip packages from examples/plugins/<id>/ folders.
// Usage: npm run plugins:zip  ->  examples/plugin-zips/<id>.zip
//
// A plugin folder may ship a `.zipignore` (gitignore-style, one pattern per
// line, `#` comments) to exclude heavy/irrelevant paths such as `node_modules/`
// or model weights from the distributable zip. Excluded bytes are reported.
// Folders whose name starts with `_` are test fixtures and are never packaged
// (unless ZIPS_INCLUDE_FIXTURES=1).
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "examples", "plugins");
const outDir = join(root, "examples", "plugin-zips");
const includeFixtures = process.env.ZIPS_INCLUDE_FIXTURES === "1";

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

/** Parse a `.zipignore` file into matcher regexes (gitignore-lite). */
function loadZipignore(pluginDir) {
  const file = join(pluginDir, ".zipignore");
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const matchers = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const dirOnly = line.endsWith("/");
    const body = dirOnly ? line.slice(0, -1) : line;
    const escaped = body
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    // Match either at the root or anywhere below it; dir patterns match contents.
    const re = dirOnly
      ? new RegExp(`(^|/)${escaped}(/|$)`)
      : new RegExp(`(^|/)${escaped}$`);
    matchers.push(re);
  }
  return matchers;
}

mkdirSync(outDir, { recursive: true });
let built = 0;
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name.startsWith("_") && !includeFixtures) {
    console.log(`skip ${entry.name} (fixture; set ZIPS_INCLUDE_FIXTURES=1 to include)`);
    continue;
  }
  const pluginDir = join(srcDir, entry.name);
  const manifestPath = join(pluginDir, "manifest.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const id = manifest.id;
  const ignore = loadZipignore(pluginDir);

  const files = {};
  let excludedBytes = 0;
  let excludedCount = 0;
  for (const file of collectFiles(pluginDir)) {
    const rel = relative(pluginDir, file).split("\\").join("/");
    // `.zipignore` is a build input, never shipped.
    if (rel === ".zipignore" || ignore.some((re) => re.test(rel))) {
      try {
        excludedBytes += statSync(file).size;
      } catch {
        // ignore
      }
      excludedCount += 1;
      continue;
    }
    files[`${id}/${rel}`] = new Uint8Array(readFileSync(file));
  }

  const zip = zipSync(files, { level: 9 });
  const outPath = join(outDir, `${id}.zip`);
  writeFileSync(outPath, zip);
  const excl = excludedCount
    ? `, excluded ${excludedCount} file(s) / ${(excludedBytes / 1024 / 1024).toFixed(1)} MB`
    : "";
  console.log(
    `packed ${entry.name} -> examples/plugin-zips/${id}.zip (${(zip.length / 1024).toFixed(1)} KB${excl})`,
  );
  built += 1;
}
console.log(`done: ${built} plugin zip(s) in examples/plugin-zips/`);
