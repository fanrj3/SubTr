export type DictEntry = {
  phonetic?: string;
  senses: string[];
  tag?: string;
  exchange?: string;
};

type DictionaryFile = {
  version: number;
  source: string;
  generatedAt: string;
  entries: Record<string, DictEntry>;
};

let dictionaryPromise: Promise<Record<string, DictEntry> | null> | null = null;
let cache: Record<string, DictEntry> | null = null;

function loadDictionary(): Promise<Record<string, DictEntry> | null> {
  if (cache) return Promise.resolve(cache);
  if (dictionaryPromise) return dictionaryPromise;

  dictionaryPromise = fetch("/dict/ecdict-top30k.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Dictionary HTTP ${res.status}`);
      return res.json() as Promise<DictionaryFile>;
    })
    .then((data) => {
      const entries = data?.entries ?? {};
      cache = entries;
      return entries;
    })
    .catch(() => null);

  return dictionaryPromise;
}

export function isSingleLatinWord(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && /^[A-Za-z][A-Za-z'’-]*$/.test(trimmed);
}

const PLUGIN_LOOKUP_TIMEOUT_MS = 1500;

async function lookupPluginWord(normalized: string): Promise<DictEntry | null> {
  if (typeof window === "undefined") return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PLUGIN_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `/api/dictionary?term=${encodeURIComponent(normalized)}`,
      { signal: controller.signal, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { phonetic?: unknown; senses?: unknown };
    if (!Array.isArray(data?.senses)) return null;
    const senses = data.senses.filter(
      (sense): sense is string => typeof sense === "string"
    );
    if (senses.length === 0) return null;
    return {
      phonetic: typeof data.phonetic === "string" ? data.phonetic : undefined,
      senses,
    };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function lookupWord(word: string): Promise<DictEntry | null> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return null;
  const entries = await loadDictionary();
  const staticEntry = entries?.[normalized];
  if (staticEntry) return staticEntry;
  return lookupPluginWord(normalized);
}
