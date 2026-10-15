// SubTr voice→translated-subtitles pipeline (Phase 1 prototype).
//
// Pure, dependency-free helpers used by desktop/main.cjs. Kept in plain CJS so
// the main process can `require` it and so the algorithm can be unit-tested with
// Node alone (no Electron): see the tests at the bottom of this file.
//
// NOTE: `src/lib/client/voice/protocol.ts` mirrors these constants for the
// renderer-side module. Keep VOICE_SAMPLE_RATE / VOICE_WINDOW_MS / VOICE_HOP_MS
// in sync between the two files.
//
// Data flow (Phase 1):
//   loopback audio (renderer) -> 16 kHz mono s16le PCM -> ring buffer (here)
//   -> rolling window (~5 s, hop ~1.5 s) -> whisper-server /inference
//   -> VoiceCommitter (overlap-dedupe + 2-pass agreement) -> committed text
//   -> forwarded to the existing overlay capture channel for translation.

"use strict";

const VOICE_SAMPLE_RATE = 16000;
const VOICE_BYTES_PER_SAMPLE = 2;
/** Rolling analysis window length in milliseconds. */
const VOICE_WINDOW_MS = 5000;
/** Time between rolling analysis passes in milliseconds. */
const VOICE_HOP_MS = 1500;
/** Minimum chars overlap between two passes before a prefix counts as stable. */
const VOICE_OVERLAP_RATIO = 0.8;
/** Passes with no speech before the current utterance is considered finished. */
const VOICE_EMPTY_PASSES_TO_END = 2;

const NON_SPEECH_RE = /^\[[^\]]*\]$|^\([^)]*\)$|^♪.*♪$|^<(?:noise|unk|inaudible|music|silence)>$/i;

/** Collapse whitespace and trim a raw whisper transcript. */
function normalizeTranscript(text) {
  return String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the transcript is empty or only a non-speech marker ([MUSIC], …). */
function isNonSpeech(text) {
  const t = normalizeTranscript(text);
  return !t || NON_SPEECH_RE.test(t);
}

/** Length of the longest common leading substring of a and b (chars). */
function longestCommonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Trim to the last whitespace so a partial trailing word is never committed. */
function wordAlignedPrefix(text) {
  const t = String(text).replace(/\s+$/, "");
  const idx = t.lastIndexOf(" ");
  if (idx <= 0) return "";
  return t.slice(0, idx).replace(/\s+$/, "");
}

/**
 * The agreed prefix of two consecutive passes: the longest common prefix, but
 * only when it covers at least `ratio` of the shorter pass (else ""). This is
 * the raw prefix; callers should pass it through `stabilizePrefix` to avoid
 * committing a partial trailing word.
 */
function agreedPrefix(previous, next, ratio = VOICE_OVERLAP_RATIO) {
  if (!previous || !next) return "";
  const common = longestCommonPrefixLength(previous, next);
  if (common === 0) return "";
  const minLen = Math.min(previous.length, next.length);
  if (common < Math.ceil(minLen * ratio)) return "";
  return next.slice(0, common);
}

/**
 * A committed prefix must be word-aligned. If the agreed prefix ends mid-word in
 * `next` (i.e. the next pass continues the same token), drop that partial token;
 * otherwise the whole agreed prefix is safe to commit.
 */
function stabilizePrefix(agreed, next) {
  const a = String(agreed).replace(/\s+$/, "");
  if (!a) return "";
  if (next.length > a.length && next[a.length] !== " ") {
    return wordAlignedPrefix(a);
  }
  return a;
}

/** Fixed-capacity Int16 ring buffer that keeps the most recent samples. */
class PcmRingBuffer {
  constructor(maxSamples) {
    this.max = Math.max(1, Math.floor(maxSamples));
    this.buf = new Int16Array(this.max);
    this.length = 0;
  }

  /** Append a chunk of Int16 samples (Int16Array or Buffer). Keeps the tail. */
  append(chunk) {
    if (!chunk || chunk.length === 0) return;
    const src = chunk.length > this.max ? chunk.subarray(chunk.length - this.max) : chunk;
    if (src.length >= this.max) {
      this.buf.set(src, 0);
      this.length = this.max;
      return;
    }
    const overflow = this.length + src.length - this.max;
    if (overflow > 0) {
      this.buf.copyWithin(0, overflow, this.length);
      this.length -= overflow;
    }
    this.buf.set(src, this.length);
    this.length += src.length;
  }

  /** Copy of the most recent `n` samples (fewer if not available). */
  takeLast(n) {
    const k = Math.min(n, this.length);
    return this.buf.slice(this.length - k, this.length);
  }

  get size() {
    return this.length;
  }

  clear() {
    this.length = 0;
  }
}

/**
 * Stateful rolling-window committer.
 *
 * A prefix is committed only when two consecutive passes agree on it (classic
 * "stable prefix" rule), it is word-aligned, and it extends what we already
 * committed. Divergence (overlap below the ratio) starts a fresh utterance.
 */
class VoiceCommitter {
  constructor() {
    this.reset();
  }

  reset() {
    this.committed = "";
    this.previous = "";
    this.emptyPasses = 0;
  }

  /**
   * Feed one pass transcript.
   * @param {string} rawTranscript
   * @returns {{ committed: string, delta: string } | { ended: string } | null}
   *   - `{ committed, delta }` when new stable text was committed
   *   - `{ ended }` when the utterance finished (silence)
   *   - `null` when nothing changed
   */
  feed(rawTranscript) {
    if (isNonSpeech(rawTranscript)) {
      this.emptyPasses += 1;
      this.previous = "";
      if (this.emptyPasses >= VOICE_EMPTY_PASSES_TO_END && this.committed) {
        const ended = this.committed;
        this.reset();
        return { ended };
      }
      return null;
    }

    this.emptyPasses = 0;
    const text = normalizeTranscript(rawTranscript);
    const agreed = agreedPrefix(this.previous, text);
    if (this.previous && !agreed) {
      // Diverged: likely a new utterance. Drop the old committed base but keep
      // this pass as the new rolling base so the next pass can re-agree.
      this.committed = "";
    }
    this.previous = text;

    const stable = stabilizePrefix(agreed, text);
    if (stable && stable.length > this.committed.length && stable.startsWith(this.committed)) {
      const delta = stable.slice(this.committed.length).trim();
      this.committed = stable;
      if (delta) return { committed: this.committed, delta };
    }
    return null;
  }
}

/** Encode Int16 mono samples as a 16-bit PCM WAV file (Buffer). */
function encodeWav(int16, sampleRate = VOICE_SAMPLE_RATE) {
  const dataBytes = int16.length * VOICE_BYTES_PER_SAMPLE;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * VOICE_BYTES_PER_SAMPLE, 28);
  buf.writeUInt16LE(VOICE_BYTES_PER_SAMPLE, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < int16.length; i++) {
    buf.writeInt16LE(int16[i] | 0, 44 + i * 2);
  }
  return buf;
}

/** Peak normalised amplitude (0..1) of an Int16 buffer — cheap silence check. */
function rms(int16) {
  if (!int16 || int16.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < int16.length; i++) {
    const v = int16[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / int16.length);
}

module.exports = {
  VOICE_SAMPLE_RATE,
  VOICE_BYTES_PER_SAMPLE,
  VOICE_WINDOW_MS,
  VOICE_HOP_MS,
  VOICE_OVERLAP_RATIO,
  VOICE_EMPTY_PASSES_TO_END,
  normalizeTranscript,
  isNonSpeech,
  longestCommonPrefixLength,
  wordAlignedPrefix,
  agreedPrefix,
  stabilizePrefix,
  PcmRingBuffer,
  VoiceCommitter,
  encodeWav,
  rms,
};

// ---------------------------------------------------------------------------
// Inline self-test: `node desktop/voice-pipeline.cjs --selftest`
// ---------------------------------------------------------------------------
if (require.main === module && process.argv.includes("--selftest")) {
  const assert = require("node:assert");
  const {
    VoiceCommitter,
    PcmRingBuffer,
    encodeWav,
    agreedPrefix,
    isNonSpeech,
  } = module.exports;

  // --- commit: two consecutive passes agreeing on a prefix commit it ---
  const c = new VoiceCommitter();
  assert.strictEqual(c.feed("hello wor"), null, "single pass commits nothing");
  assert.deepStrictEqual(
    c.feed("hello world how"),
    { committed: "hello", delta: "hello" },
    "second pass commits agreed prefix (drops the partial token)",
  );
  assert.deepStrictEqual(
    c.feed("hello world how are"),
    { committed: "hello world how", delta: "world how" },
    "extends committed text once the token is proven complete",
  );
  assert.deepStrictEqual(
    c.feed("hello world how are"),
    { committed: "hello world how are", delta: "are" },
    "a stable repeat commits the remaining token",
  );
  // non-speech marker ends the utterance after enough empty passes
  assert.strictEqual(c.feed("[BLANK_AUDIO]"), null);
  assert.deepStrictEqual(c.feed(""), { ended: "hello world how are" }, "silence ends utterance");
  assert.strictEqual(c.committed, "", "utterance reset after silence");

  // --- divergence starts a fresh utterance ---
  const d = new VoiceCommitter();
  d.feed("the quick brown fox");
  d.feed("the quick brown fox jumps");
  assert.strictEqual(d.committed, "the quick brown fox");
  d.feed("completely different words here");
  assert.strictEqual(d.committed, "", "divergence resets committed base");

  // --- overlap helper ---
  assert.strictEqual(agreedPrefix("abcdefgh", "abcdZZZZ"), ""); // <80% overlap
  assert.strictEqual(agreedPrefix("abcdefgh", "abcdefgZ"), "abcdefg"); // >=80%

  // --- non-speech detection ---
  assert.ok(isNonSpeech(""));
  assert.ok(isNonSpeech("  [MUSIC] "));
  assert.ok(!isNonSpeech("hello"));

  // --- ring buffer keeps the tail ---
  const ring = new PcmRingBuffer(5);
  ring.append(Int16Array.from([1, 2, 3]));
  ring.append(Int16Array.from([4, 5, 6, 7]));
  assert.strictEqual(ring.size, 5);
  assert.deepStrictEqual(Array.from(ring.takeLast(5)), [3, 4, 5, 6, 7]);

  // --- WAV header sanity ---
  const wav = encodeWav(Int16Array.from([0, 1, -1, 512]));
  assert.strictEqual(wav.length, 44 + 8);
  assert.strictEqual(wav.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(wav.toString("ascii", 8, 12), "WAVE");
  assert.strictEqual(wav.readUInt32LE(24), 16000);
  assert.strictEqual(wav.readUInt16LE(22), 1);
  assert.strictEqual(wav.readUInt32LE(40), 8);

  console.log("[voice-pipeline] self-test OK");
}
