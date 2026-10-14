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

export async function lookupWord(word: string): Promise<DictEntry | null> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return null;
  const entries = await loadDictionary();
  if (!entries) return null;
  return entries[normalized] ?? null;
}
