import { promises as fs, existsSync, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Server-side plugin system (v1).
 *
 * Plugins are folders in the plugins dir (see `getPluginsDir`) with a
 * `manifest.json`, optionally an `entry` module. Enabled + granted plugins are
 * dynamically imported in the server process and may contribute capability-scoped
 * hooks: input/output translation transforms and a dictionary source.
 *
 * Security note: plugins run as local code in the server process. Only install
 * plugins you trust.
 */

export const KNOWN_CAPABILITIES = [
  "translate.transformInput",
  "translate.transformOutput",
  "dictionary.source",
  "ui.panel",
] as const;

export type Capability = (typeof KNOWN_CAPABILITIES)[number];

const CAPABILITY_SET = new Set<string>(KNOWN_CAPABILITIES);
const API_VERSION = 1;
const HOOK_TIMEOUT_MS = 2000;
const STATE_TTL_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 2;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ID_RE = /^[a-z0-9-]+$/;

export type PluginStatus = "ok" | "disabled" | "error" | "incompatible";

/** One embeddable panel declared by a plugin (requires the `ui.panel` capability). */
export type PanelDecl = {
  id: string;
  title: string;
  /** Path to an HTML file inside the plugin folder. */
  entry: string;
};

/** Per-plugin entry shape returned by GET /api/plugins (frozen API). */
export type PluginInfo = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  minAppVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  entry?: string;
  capabilities: string[];
  streaming?: "per-chunk" | "buffered";
  contributes?: { providers?: unknown[] };
  /** Declared panels (empty when the plugin has none). */
  panels: PanelDecl[];
  enabled: boolean;
  grantedCapabilities: string[];
  status: PluginStatus;
  error?: string;
};

export type PluginsSnapshot = {
  revision: number;
  dir: string;
  plugins: PluginInfo[];
};

type Manifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  minAppVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  entry?: string;
  capabilities: string[];
  streaming?: "per-chunk" | "buffered";
  contributes?: { providers?: unknown[] };
  panels?: PanelDecl[];
};

/** Context passed to input transforms. Never contains keys/base URLs. */
export type InputTransformContext = {
  text: string;
  targetLang: string;
  profile: { id: string; presetId: string; model: string };
};

/** Context passed to output transforms. */
export type OutputTransformContext = {
  text: string;
  targetLang: string;
  stream: boolean;
};

export type DictionaryEntry = { phonetic?: string; senses: string[] };

type HookResult = { ok: boolean; value?: unknown };

type Runtime = {
  input: Array<(ctx: InputTransformContext) => unknown>;
  output: Array<(ctx: OutputTransformContext) => unknown>;
  lookup: Array<(term: string) => unknown>;
  deactivate?: () => void;
};

type PluginRecord = {
  folder: string;
  dir: string;
  info: PluginInfo;
  manifest: Manifest | null;
  entryPath: string | null;
  runtime: Runtime | null;
  /** Set when validation/load/runtime permanently fails (status "error"). */
  error?: string;
  /** Last hook error message (not surfaced until auto-disable). */
  lastError?: string;
  failures: number;
  incompatible: boolean;
};

type ConsentRecord = {
  enabled?: boolean;
  version?: string;
  grantedCapabilities?: string[];
  grantedAt?: string;
};

type ConsentFile = Record<string, ConsentRecord>;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let revision = 0;
const records = new Map<string, PluginRecord>();
let scanned = false;
let scanPromise: Promise<void> | null = null;
let consentCache: { at: number; value: ConsentFile } | null = null;
let watcher: FSWatcher | null = null;
let watchTimer: NodeJS.Timeout | null = null;

/** Resolve the plugins directory (env override, else ~/.subtr/plugins). */
export function getPluginsDir(): string {
  const override = process.env.SUBTR_PLUGINS_DIR;
  if (override && override.trim()) return path.resolve(/* turbopackIgnore: true */ override.trim());
  return path.join(/* turbopackIgnore: true */ os.homedir(), ".subtr", "plugins");
}

function statePath(): string {
  return path.join(/* turbopackIgnore: true */ getPluginsDir(), ".state.json");
}

// ---------------------------------------------------------------------------
// Consent (.state.json)
// ---------------------------------------------------------------------------

async function readConsent(force = false): Promise<ConsentFile> {
  const now = Date.now();
  if (!force && consentCache && now - consentCache.at < STATE_TTL_MS) {
    return consentCache.value;
  }
  let value: ConsentFile = {};
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ statePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      value = parsed as ConsentFile;
    }
  } catch {
    value = {};
  }
  consentCache = { at: now, value };
  return value;
}

async function writeConsent(next: ConsentFile): Promise<void> {
  const dir = getPluginsDir();
  const file = statePath();
  await fs.mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(/* turbopackIgnore: true */ tmp, file);
    consentCache = { at: Date.now(), value: next };
  } catch (error) {
    try {
      await fs.rm(/* turbopackIgnore: true */ tmp, { force: true });
    } catch {
      // ignore
    }
    throw error;
  }
}

function consentFor(consent: ConsentFile, id: string): ConsentRecord {
  const entry = consent[id];
  return entry && typeof entry === "object" ? entry : {};
}

function grantedFrom(consent: ConsentRecord, capabilities: string[]): string[] {
  const raw = Array.isArray(consent.grantedCapabilities) ? consent.grantedCapabilities : [];
  const granted = new Set(raw.filter((c): c is string => typeof c === "string"));
  return capabilities.filter((c) => granted.has(c));
}

// ---------------------------------------------------------------------------
// Scan + validate
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateManifest(
  raw: unknown,
  folder: string,
): { ok: true; manifest: Manifest } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "manifest.json must be an object" };
  const id = raw.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return { ok: false, error: "manifest id must match /^[a-z0-9-]+$/" };
  }
  if (id !== folder) {
    return { ok: false, error: `manifest id "${id}" must equal the folder name "${folder}"` };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, error: "manifest name must be a non-empty string" };
  }
  if (typeof raw.version !== "string" || !SEMVER_RE.test(raw.version)) {
    return { ok: false, error: "manifest version must be semver (x.y.z)" };
  }
  if (typeof raw.minAppVersion !== "string" || !SEMVER_RE.test(raw.minAppVersion)) {
    return { ok: false, error: "manifest minAppVersion must be semver (x.y.z)" };
  }
  if (typeof raw.apiVersion !== "number" || !Number.isInteger(raw.apiVersion)) {
    return { ok: false, error: "manifest apiVersion must be an integer" };
  }
  if (typeof raw.description !== "string") {
    return { ok: false, error: "manifest description must be a string" };
  }
  const capabilities = raw.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.some((c) => typeof c !== "string")) {
    return { ok: false, error: "manifest capabilities must be an array of strings" };
  }
  const unknown = capabilities.filter((c) => !CAPABILITY_SET.has(c as string));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown capabilities: ${unknown.join(", ")}` };
  }
  const entry = typeof raw.entry === "string" && raw.entry.trim() ? raw.entry.trim() : undefined;
  // `ui.panel` is declarative (HTML only); everything else registers code hooks.
  const needsEntry = capabilities.some((c) => c !== "ui.panel");
  if (needsEntry && !entry) {
    return { ok: false, error: "manifest entry is required when code capabilities are declared" };
  }
  const streaming = raw.streaming;
  if (streaming !== undefined && streaming !== "per-chunk" && streaming !== "buffered") {
    return { ok: false, error: 'manifest streaming must be "per-chunk" or "buffered"' };
  }
  let contributes: { providers?: unknown[] } | undefined;
  if (raw.contributes !== undefined) {
    if (!isRecord(raw.contributes)) return { ok: false, error: "manifest contributes must be an object" };
    const providers = raw.contributes.providers;
    if (providers !== undefined && !Array.isArray(providers)) {
      return { ok: false, error: "manifest contributes.providers must be an array" };
    }
    contributes = Array.isArray(providers) ? { providers } : {};
  }

  // Panels are embedded UI (HTML) and require the `ui.panel` capability.
  let panels: PanelDecl[] | undefined;
  if (raw.panels !== undefined) {
    if (!Array.isArray(raw.panels)) {
      return { ok: false, error: "manifest panels must be an array" };
    }
    if (!capabilities.includes("ui.panel")) {
      return { ok: false, error: 'manifest panels require the "ui.panel" capability' };
    }
    const parsed: PanelDecl[] = [];
    const seenIds = new Set<string>();
    for (const item of raw.panels) {
      if (!isRecord(item)) return { ok: false, error: "each panel must be an object" };
      const panelId = item.id;
      const title = item.title;
      const panelEntry = item.entry;
      if (typeof panelId !== "string" || !ID_RE.test(panelId)) {
        return { ok: false, error: 'panel id must match /^[a-z0-9-]+$/' };
      }
      if (seenIds.has(panelId)) {
        return { ok: false, error: `duplicate panel id: ${panelId}` };
      }
      seenIds.add(panelId);
      if (typeof title !== "string" || !title.trim()) {
        return { ok: false, error: "panel title must be a non-empty string" };
      }
      if (typeof panelEntry !== "string" || !panelEntry.trim()) {
        return { ok: false, error: "panel entry must be a non-empty string" };
      }
      parsed.push({ id: panelId, title: title.trim(), entry: panelEntry.trim() });
    }
    panels = parsed;
  }

  return {
    ok: true,
    manifest: {
      id,
      name: raw.name.trim(),
      version: raw.version,
      apiVersion: raw.apiVersion,
      minAppVersion: raw.minAppVersion,
      description: raw.description,
      ...(typeof raw.author === "string" ? { author: raw.author } : {}),
      ...(typeof raw.homepage === "string" ? { homepage: raw.homepage } : {}),
      ...(entry ? { entry } : {}),
      capabilities: capabilities as string[],
      ...(streaming ? { streaming: streaming as "per-chunk" | "buffered" } : {}),
      ...(contributes ? { contributes } : {}),
      ...(panels ? { panels } : {}),
    },
  };
}

/** Build a record for a folder that failed before a manifest was available. */
function errorRecord(folder: string, dir: string, message: string): PluginRecord {
  return {
    folder,
    dir,
    manifest: null,
    entryPath: null,
    runtime: null,
    error: message,
    failures: 0,
    incompatible: false,
    info: {
      id: folder,
      name: folder,
      version: "0.0.0",
      apiVersion: 0,
      minAppVersion: "0.0.0",
      description: "",
      capabilities: [],
      panels: [],
      enabled: false,
      grantedCapabilities: [],
      status: "error",
      error: message,
    },
  };
}

function recordFromManifest(
  folder: string,
  dir: string,
  manifest: Manifest,
): { ok: true; record: PluginRecord } | { ok: false; error: string } {
  const incompatible = manifest.apiVersion !== API_VERSION;
  let entryPath: string | null = null;
  if (manifest.entry) {
    entryPath = path.join(/* turbopackIgnore: true */ dir, manifest.entry);
    if (!existsSync(/* turbopackIgnore: true */ entryPath)) {
      return { ok: false, error: `entry file not found: ${manifest.entry}` };
    }
  }
  for (const panel of manifest.panels ?? []) {
    const panelPath = path.join(/* turbopackIgnore: true */ dir, panel.entry);
    if (!existsSync(/* turbopackIgnore: true */ panelPath)) {
      return { ok: false, error: `panel "${panel.id}" entry file not found: ${panel.entry}` };
    }
  }
  const record: PluginRecord = {
    folder,
    dir,
    manifest,
    entryPath,
    runtime: null,
    failures: 0,
    incompatible,
    info: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: manifest.apiVersion,
      minAppVersion: manifest.minAppVersion,
      description: manifest.description,
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
      ...(manifest.entry ? { entry: manifest.entry } : {}),
      capabilities: [...manifest.capabilities],
      ...(manifest.streaming ? { streaming: manifest.streaming } : {}),
      ...(manifest.contributes ? { contributes: manifest.contributes } : {}),
      panels: [...(manifest.panels ?? [])],
      enabled: false,
      grantedCapabilities: [],
      status: incompatible ? "incompatible" : "disabled",
      ...(incompatible
        ? { error: `unsupported apiVersion ${manifest.apiVersion} (expected ${API_VERSION})` }
        : {}),
    },
  };
  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// Load / activate
// ---------------------------------------------------------------------------

async function deactivateRecord(record: PluginRecord): Promise<void> {
  const runtime = record.runtime;
  record.runtime = null;
  if (!runtime) return;
  try {
    runtime.deactivate?.();
  } catch (error) {
    console.warn(`[plugins] ${record.folder} deactivate failed:`, error);
  }
}

/**
 * Import a plugin entry at runtime.
 *
 * Bundlers (Turbopack) statically rewrite `import(expr)` and reject a fully
 * dynamic specifier at runtime, so the specifier is hidden behind `new Function`.
 * A CJS `require` fallback keeps working when that is unavailable.
 */
const runtimeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

async function importPlugin(href: string, entryPath: string): Promise<Record<string, unknown>> {
  try {
    return await runtimeImport(href);
  } catch (error) {
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(/* turbopackIgnore: true */ entryPath);
      const resolved = req.resolve(/* turbopackIgnore: true */ entryPath);
      delete req.cache[resolved];
      return req(resolved) as Record<string, unknown>;
    } catch {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

function buildApi(record: PluginRecord, granted: Set<string>): Record<string, unknown> {
  const api: Record<string, unknown> = {
    plugin: {
      id: record.info.id,
      version: record.info.version,
      dir: record.dir,
    },
    log: {
      info: (...args: unknown[]) => console.log(`[plugin:${record.folder}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[plugin:${record.folder}]`, ...args),
      error: (...args: unknown[]) => console.error(`[plugin:${record.folder}]`, ...args),
    },
  };

  const hasTranslateInput = granted.has("translate.transformInput");
  const hasTranslateOutput = granted.has("translate.transformOutput");
  if (hasTranslateInput || hasTranslateOutput) {
    const translate: Record<string, unknown> = {};
    translate.onTransformInput = (fn: unknown) => {
      if (typeof fn === "function" && hasTranslateInput) {
        record.runtime?.input.push(fn as (ctx: InputTransformContext) => unknown);
      }
    };
    translate.onTransformOutput = (fn: unknown) => {
      if (typeof fn === "function" && hasTranslateOutput) {
        record.runtime?.output.push(fn as (ctx: OutputTransformContext) => unknown);
      }
    };
    api.translate = translate;
  }

  if (granted.has("dictionary.source")) {
    api.dictionary = {
      onLookup: (fn: unknown) => {
        if (typeof fn === "function") {
          record.runtime?.lookup.push(fn as (term: string) => unknown);
        }
      },
    };
  }

  return api;
}

async function loadRecord(record: PluginRecord): Promise<void> {
  if (record.incompatible || record.error || !record.entryPath || !record.manifest) return;
  const runtime: Runtime = { input: [], output: [], lookup: [] };
  record.runtime = runtime;
  try {
    const url = pathToFileURL(/* turbopackIgnore: true */ record.entryPath);
    url.searchParams.set("v", `${record.info.version}-${Date.now()}`);
    const mod = await importPlugin(url.href, record.entryPath);
    const activate = (mod.activate ?? (mod.default as Record<string, unknown> | undefined)?.activate) as
      | ((api: unknown) => unknown)
      | undefined;
    if (typeof activate !== "function") {
      throw new Error("entry does not export activate(api)");
    }
    const granted = new Set(record.info.grantedCapabilities);
    const result = await activate(buildApi(record, granted));
    if (isRecord(result) && typeof result.deactivate === "function") {
      runtime.deactivate = result.deactivate as () => void;
    } else if (isRecord(mod) && typeof mod.deactivate === "function") {
      runtime.deactivate = mod.deactivate as () => void;
    }
    record.failures = 0;
  } catch (error) {
    await deactivateRecord(record);
    record.error = `failed to load: ${error instanceof Error ? error.message : String(error)}`;
    record.info.status = "error";
    record.info.error = record.error;
    console.warn(`[plugins] ${record.folder} ${record.error}`);
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

async function doScan(): Promise<void> {
  const dir = getPluginsDir();
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    entries = [];
  }

  const seen = new Set<string>();
  for (const folder of entries) {
    const pluginDir = path.join(/* turbopackIgnore: true */ dir, folder);
    const manifestPath = path.join(/* turbopackIgnore: true */ pluginDir, "manifest.json");
    if (!existsSync(/* turbopackIgnore: true */ manifestPath)) continue;
    seen.add(folder);

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ manifestPath, "utf8"));
    } catch (error) {
      await replaceRecord(errorRecord(folder, pluginDir, `invalid manifest.json: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }

    const validated = validateManifest(raw, folder);
    if (!validated.ok) {
      await replaceRecord(errorRecord(folder, pluginDir, validated.error));
      continue;
    }
    const built = recordFromManifest(folder, pluginDir, validated.manifest);
    if (!built.ok) {
      await replaceRecord(errorRecord(folder, pluginDir, built.error));
      continue;
    }
    await replaceRecord(built.record);
  }

  // Drop records whose folder vanished.
  for (const [folder, record] of [...records]) {
    if (!seen.has(folder)) {
      await deactivateRecord(record);
      records.delete(folder);
    }
  }

  consentCache = null;
  await refreshConsent();
  scanned = true;
}

/** Swap in a freshly scanned record, deactivating the previous one. */
async function replaceRecord(next: PluginRecord): Promise<void> {
  const previous = records.get(next.folder);
  if (previous) {
    const sameShape =
      previous.manifest?.version === next.manifest?.version &&
      previous.manifest?.entry === next.manifest?.entry &&
      previous.manifest?.apiVersion === next.manifest?.apiVersion;
    if (sameShape) {
      // Keep the live hooks; just refresh metadata.
      previous.info = next.info;
      previous.manifest = next.manifest;
      previous.entryPath = next.entryPath;
      previous.incompatible = next.incompatible;
      if (!next.incompatible && previous.error) {
        // Validation now passes → keep the error only if it was a load error.
      }
      return;
    }
    await deactivateRecord(previous);
  }
  records.set(next.folder, next);
}

async function ensureScanned(): Promise<void> {
  if (scanned) return;
  if (scanPromise) return scanPromise;
  scanPromise = doScan()
    .catch((error) => {
      console.warn("[plugins] scan failed:", error);
    })
    .finally(() => {
      scanPromise = null;
    });
  return scanPromise;
}

/** Apply .state.json consent to the current records, loading/unloading as needed. */
async function refreshConsent(): Promise<void> {
  const consent = await readConsent(true);
  for (const record of records.values()) {
    if (!record.manifest) continue;
    const entry = consentFor(consent, record.folder);
    const capabilities = record.manifest.capabilities;
    const granted = capabilities.length > 0 ? grantedFrom(entry, capabilities) : [];
    const enabled = entry.enabled === true && !record.incompatible;
    record.info.grantedCapabilities = granted;
    record.info.enabled = enabled;
    if (record.info.error) delete record.info.error;

    if (record.incompatible) {
      record.info.status = "incompatible";
      record.info.error = `unsupported apiVersion ${record.manifest.apiVersion} (expected ${API_VERSION})`;
      await deactivateRecord(record);
      continue;
    }
    if (record.error) {
      record.info.status = "error";
      record.info.error = record.error;
      await deactivateRecord(record);
      continue;
    }
    if (!enabled) {
      record.info.status = "disabled";
      await deactivateRecord(record);
      continue;
    }
    if (!record.runtime) {
      await loadRecord(record);
    }
    if (record.error) {
      record.info.status = "error";
      record.info.error = record.error;
    } else {
      record.info.status = "ok";
    }
  }
}

// ---------------------------------------------------------------------------
// Hot reload (dev)
// ---------------------------------------------------------------------------

function startWatching(): void {
  if (watcher || process.env.SUBTR_PLUGIN_WATCH !== "1") return;
  const dir = getPluginsDir();
  const schedule = () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      watchTimer = null;
      void reloadPlugins();
    }, 150);
  };
  try {
    watcher = watch(/* turbopackIgnore: true */ dir, { recursive: true }, schedule);
  } catch {
    try {
      watcher = watch(/* turbopackIgnore: true */ dir, schedule);
    } catch {
      watcher = null;
    }
  }
  if (watcher) {
    watcher.on("error", () => {
      /* ignore */
    });
    console.log(`[plugins] watching ${dir}`);
  }
}

/** Re-scan, deactivate stale instances, reload, and bump the revision. */
export async function reloadPlugins(): Promise<number> {
  for (const record of records.values()) {
    await deactivateRecord(record);
  }
  scanned = false;
  scanPromise = null;
  await ensureScanned();
  revision += 1;
  return revision;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function orderedEnabled(): PluginRecord[] {
  return [...records.values()]
    .filter((r) => r.info.enabled && r.runtime && r.info.status === "ok")
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

async function runHook(record: PluginRecord, fn: () => unknown): Promise<HookResult> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("hook timed out")), HOOK_TIMEOUT_MS);
      }),
    ]);
    record.failures = 0;
    return { ok: true, value };
  } catch (error) {
    record.failures += 1;
    record.lastError = error instanceof Error ? error.message : String(error);
    if (record.failures >= MAX_CONSECUTIVE_FAILURES) {
      await autoDisable(record);
    }
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function autoDisable(record: PluginRecord): Promise<void> {
  const message = `${MAX_CONSECUTIVE_FAILURES} consecutive hook failures: ${record.lastError ?? "unknown error"}`;
  record.error = message;
  record.info.enabled = false;
  record.info.status = "error";
  record.info.error = message;
  await deactivateRecord(record);
  try {
    const consent = await readConsent(true);
    const existing = consentFor(consent, record.folder);
    await writeConsent({
      ...consent,
      [record.folder]: {
        ...existing,
        enabled: false,
        version: record.info.version,
        grantedCapabilities: existing.grantedCapabilities ?? record.info.grantedCapabilities,
        grantedAt: existing.grantedAt ?? new Date().toISOString(),
      },
    });
  } catch (error) {
    console.warn(`[plugins] failed to persist auto-disable for ${record.folder}:`, error);
  }
  revision += 1;
  console.warn(`[plugins] auto-disabled ${record.folder}: ${message}`);
}

function coerceTransform(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.text === "string") return value.text;
  return fallback;
}

/** Run enabled input transforms in id order. A failing hook is skipped. */
export async function applyInputTransforms(
  text: string,
  ctx: Omit<InputTransformContext, "text">,
): Promise<string> {
  await ensureScanned();
  let current = text;
  for (const record of orderedEnabled()) {
    for (const fn of record.runtime?.input ?? []) {
      const result = await runHook(record, () => fn({ ...ctx, text: current }));
      if (result.ok) current = coerceTransform(result.value, current);
    }
  }
  return current;
}

/** Run enabled output transforms in id order. A failing hook is skipped. */
export async function applyOutputTransforms(
  text: string,
  ctx: Omit<OutputTransformContext, "text">,
): Promise<string> {
  await ensureScanned();
  let current = text;
  for (const record of orderedEnabled()) {
    for (const fn of record.runtime?.output ?? []) {
      const result = await runHook(record, () => fn({ ...ctx, text: current }));
      if (result.ok) current = coerceTransform(result.value, current);
    }
  }
  return current;
}

/**
 * True when any enabled output plugin declares buffered streaming; the route
 * then collects the whole upstream text and emits one transformed chunk.
 */
export async function hasBufferedOutput(): Promise<boolean> {
  await ensureScanned();
  return orderedEnabled().some(
    (r) => (r.runtime?.output.length ?? 0) > 0 && r.manifest?.streaming === "buffered",
  );
}

/** First non-null dictionary entry from enabled `dictionary.source` plugins. */
export async function lookupDictionary(term: string): Promise<DictionaryEntry | null> {
  await ensureScanned();
  const query = term.trim();
  if (!query) return null;
  for (const record of orderedEnabled()) {
    for (const fn of record.runtime?.lookup ?? []) {
      const result = await runHook(record, () => fn(query));
      if (!result.ok) continue;
      const value = result.value;
      if (!isRecord(value)) continue;
      const sensesRaw = value.senses;
      const senses = Array.isArray(sensesRaw)
        ? sensesRaw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : [];
      if (senses.length === 0 && typeof value.phonetic !== "string") continue;
      return {
        ...(typeof value.phonetic === "string" ? { phonetic: value.phonetic } : {}),
        senses,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** GET /api/plugins payload. */
export async function getPluginsSnapshot(): Promise<PluginsSnapshot> {
  await ensureScanned();
  const consent = await readConsent(false);
  for (const record of records.values()) {
    if (!record.manifest) continue;
    const entry = consentFor(consent, record.folder);
    const capabilities = record.manifest.capabilities;
    record.info.grantedCapabilities = capabilities.length > 0 ? grantedFrom(entry, capabilities) : [];
    const enabled = entry.enabled === true && !record.incompatible && !record.error;
    record.info.enabled = enabled;
    if (record.incompatible) {
      record.info.status = "incompatible";
    } else if (record.error) {
      record.info.status = "error";
      record.info.error = record.error;
    } else if (!enabled) {
      record.info.status = "disabled";
    } else if (record.runtime) {
      record.info.status = "ok";
    } else {
      await loadRecord(record);
      record.info.status = record.error ? "error" : "ok";
    }
  }
  startWatching();

  const plugins = [...records.values()]
    .sort((a, b) => a.folder.localeCompare(b.folder))
    .map((r) => ({ ...r.info, grantedCapabilities: [...r.info.grantedCapabilities], capabilities: [...r.info.capabilities] }));

  return { revision, dir: getPluginsDir(), plugins };
}

/** POST /api/plugins/:id body. */
export type ConsentInput = {
  enabled: boolean;
  grantedCapabilities?: string[];
};

export async function setPluginConsent(
  id: string,
  body: unknown,
): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  await ensureScanned();
  if (!isRecord(body)) return { ok: false, error: "body must be an object" };
  if (typeof body.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
  let granted: string[] | undefined;
  if (body.grantedCapabilities !== undefined) {
    if (
      !Array.isArray(body.grantedCapabilities) ||
      body.grantedCapabilities.some((c) => typeof c !== "string")
    ) {
      return { ok: false, error: "grantedCapabilities must be an array of strings" };
    }
    const unknown = (body.grantedCapabilities as string[]).filter((c) => !CAPABILITY_SET.has(c));
    if (unknown.length > 0) return { ok: false, error: `unknown capabilities: ${unknown.join(", ")}` };
    granted = body.grantedCapabilities as string[];
  }

  const record = records.get(id);
  if (!record) return { ok: false, error: `unknown plugin: ${id}` };
  if (record.incompatible) return { ok: false, error: `plugin ${id} is incompatible (apiVersion)` };

  const consent = await readConsent(true);
  const existing = consentFor(consent, id);
  const effectiveGranted = (granted ?? existing.grantedCapabilities ?? record.manifest?.capabilities ?? []).filter(
    (c): c is string => typeof c === "string" && CAPABILITY_SET.has(c),
  );

  await writeConsent({
    ...consent,
    [id]: {
      enabled: body.enabled,
      version: record.info.version,
      grantedCapabilities: effectiveGranted,
      grantedAt: existing.grantedAt ?? new Date().toISOString(),
    },
  });

  // Clearing a runtime error on an explicit (re-)enable.
  if (body.enabled && record.error) {
    record.error = undefined;
    record.lastError = undefined;
    record.failures = 0;
  }

  if (body.enabled) {
    record.info.enabled = true;
    record.info.grantedCapabilities = record.manifest
      ? grantedFrom(consentFor(await readConsent(true), id), record.manifest.capabilities)
      : [];
    if (!record.runtime) await loadRecord(record);
    record.info.status = record.error ? "error" : "ok";
    if (record.error) record.info.error = record.error;
  } else {
    await deactivateRecord(record);
    record.info.enabled = false;
    record.info.status = "disabled";
  }

  revision += 1;
  return { ok: true, revision };
}

/** Current revision (bumped on reload/enable/disable). */
export function getPluginsRevision(): number {
  return revision;
}

/**
 * Read a plugin panel's HTML entry.
 *
 * Returns null (→ 404) for unknown/uninstalled plugins, plugins that are not
 * enabled/ok, unknown panel ids, and any entry path that escapes the plugin
 * folder (path-traversal guard). Only manifest-declared files are served.
 */
export async function readPanelFile(
  id: string,
  panelId: string,
): Promise<string | null> {
  await ensureScanned();
  const record = records.get(id);
  if (!record || !record.manifest) return null;
  if (record.incompatible || record.error) return null;
  if (!record.info.enabled || record.info.status !== "ok") return null;

  const panel = (record.manifest.panels ?? []).find((p) => p.id === panelId);
  if (!panel) return null;

  const pluginDir = path.resolve(/* turbopackIgnore: true */ record.dir);
  const resolved = path.resolve(
    /* turbopackIgnore: true */ pluginDir,
    /* turbopackIgnore: true */ panel.entry,
  );
  if (!resolved.startsWith(pluginDir + path.sep)) return null;

  try {
    return await fs.readFile(/* turbopackIgnore: true */ resolved, "utf8");
  } catch {
    return null;
  }
}

/** Test-only: reset module state. */
export async function __resetPlugins(): Promise<void> {
  for (const record of records.values()) await deactivateRecord(record);
  records.clear();
  scanned = false;
  scanPromise = null;
  consentCache = null;
  revision = 0;
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
