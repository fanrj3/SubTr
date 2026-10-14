// Build the bundled English→Chinese dictionary from ECDICT.
//
// Downloads the ECDICT CSV (~63 MB) into a temp dir, keeps rows carrying a
// corpus frequency (bnc or frq), ranks them by the better (smaller) of the two
// non-zero ranks, and emits the top 30000 as a compact JSON map.
//
//   node scripts/build-dict.mjs
//
// Output: public/dict/ecdict-top30k.json
// Data: ECDICT (MIT) — https://github.com/skywind3000/ECDICT

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const CSV_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
const TOP_N = 30000;
const SENSE_SEPARATOR = "\\n"; // literal backslash + n inside ECDICT translations

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "dict");
const OUT_FILE = path.join(OUT_DIR, "ecdict-top30k.json");

const FIELD_MAX = 40 * 1024 * 1024; // no single field should approach this

/**
 * Stream-parse RFC-4180-ish CSV into arrays of fields. Handles quoted fields,
 * escaped quotes ("") and CRLF, resolving quote lookahead across chunk edges.
 * @param {string} filePath
 */
async function* parseCsv(filePath) {
  const decoder = new StringDecoder("utf8");
  let buf = "";
  let field = "";
  let fields = [];
  let inQuotes = false;

  for await (const chunk of createReadStream(filePath)) {
    buf += decoder.write(chunk);
    let i = 0;
    while (i < buf.length) {
      const c = buf[i];
      if (inQuotes) {
        if (c === '"') {
          // Need the next char to tell a closing quote from an escaped one.
          if (i + 1 >= buf.length) break;
          if (buf[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += c;
        if (field.length > FIELD_MAX) throw new Error("CSV field too large");
        i += 1;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === ",") {
        fields.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (c === "\n") {
        fields.push(field);
        field = "";
        yield fields;
        fields = [];
        i += 1;
        continue;
      }
      if (c === "\r") {
        i += 1;
        continue;
      }
      field += c;
      i += 1;
    }
    buf = buf.slice(i);
  }
  buf += decoder.end();
  if (buf.length > 0 || field.length > 0 || fields.length > 0) {
    fields.push(field + buf);
    yield fields;
  }
}

function toInt(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function downloadCsv(destPath) {
  process.stdout.write(`Downloading ${CSV_URL}\n`);
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  const { size } = await stat(destPath);
  console.log(`Downloaded ${(size / 1e6).toFixed(1)} MB → ${destPath}`);
}

async function buildEntries(csvPath) {
  const candidates = [];
  let header = null;
  let index = null;
  let rows = 0;

  for await (const record of parseCsv(csvPath)) {
    if (!header) {
      header = record.map((h) => h.trim());
      index = {};
      header.forEach((name, k) => {
        index[name] = k;
      });
      continue;
    }
    rows += 1;
    const word = (record[index.word] ?? "").trim();
    if (!word) continue;

    const bnc = toInt(record[index.bnc]);
    const frq = toInt(record[index.frq]);
    if (!(frq > 0 || bnc > 0)) continue;

    const translation = record[index.translation] ?? "";
    if (!translation.trim()) continue;

    const rank = Math.min(bnc > 0 ? bnc : Infinity, frq > 0 ? frq : Infinity);
    candidates.push({
      word,
      rank,
      phonetic: (record[index.phonetic] ?? "").trim(),
      tag: (record[index.tag] ?? "").trim(),
      exchange: (record[index.exchange] ?? "").trim(),
      translation,
    });
  }

  if (!index || !("word" in index)) {
    throw new Error("unexpected CSV: missing header/word column");
  }

  candidates.sort((a, b) => (a.rank - b.rank) || a.word.localeCompare(b.word));

  const entries = {};
  let count = 0;
  for (const row of candidates) {
    const key = row.word.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(entries, key)) continue;

    const senses = row.translation
      .split(SENSE_SEPARATOR)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (senses.length === 0) continue;

    const entry = {};
    if (row.phonetic) entry.phonetic = row.phonetic;
    entry.senses = senses;
    if (row.tag) entry.tag = row.tag;
    if (row.exchange) entry.exchange = row.exchange;

    entries[key] = entry;
    count += 1;
    if (count >= TOP_N) break;
  }

  console.log(`Parsed ${rows} rows; ${candidates.length} frequency-ranked candidates`);
  return { entries, count };
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "subtr-dict-"));
  const csvPath = path.join(tmpDir, "ecdict.csv");
  try {
    if (!existsSync(csvPath)) await downloadCsv(csvPath);

    const { entries, count } = await buildEntries(csvPath);
    const payload = {
      version: 1,
      source: "ECDICT (MIT) — top 30000 by corpus frequency",
      generatedAt: new Date().toISOString(),
      entries,
    };

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify(payload), "utf8");
    const { size } = await stat(OUT_FILE);
    console.log(`Wrote ${count} entries → ${OUT_FILE} (${(size / 1e6).toFixed(2)} MB)`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error("[build-dict] failed:", error && error.stack ? error.stack : error);
  process.exit(1);
});
