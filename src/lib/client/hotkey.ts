import { readStorage, writeStorage } from "./storage";
import { notifyStorageKey } from "./use-local-storage";

export const HOTKEY_KEY = "subtr.hotkey.v1";
export const DEFAULT_HOTKEY = "CommandOrControl+Shift+T";

export const STRONG_MODIFIERS = new Set(["Control", "Alt", "Command", "CommandOrControl"]);
export const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Command", "Super", "CommandOrControl"];

export const RESERVED_HOTKEYS = new Set([
  "Command+Space",
  "Alt+Command+Space",
  "Command+Tab",
  "Shift+Command+Tab",
  "Command+Q",
]);

export const SUGGESTED_HOTKEYS = [
  "Alt+Shift+Space",
  "Control+Shift+Space",
  "Alt+Command+T",
];

export type HotkeyError = "reserved" | "modifier" | "noKey" | "generic";

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

export function readHotkey(): string {
  const stored = readStorage<string>(HOTKEY_KEY, DEFAULT_HOTKEY);
  return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_HOTKEY;
}

export function writeHotkey(accel: string): void {
  writeStorage(HOTKEY_KEY, accel);
  // Keep the TopBar hint (and other mounted views) in sync.
  notifyStorageKey(HOTKEY_KEY);
}

export type HotkeyRegistration = {
  ok: boolean;
  /** The accelerator that is actually registered (may be a fallback). */
  accelerator?: string;
  /** True when the requested accelerator was taken and a fallback was used. */
  fallback?: boolean;
  error?: string;
};

export async function registerHotkey(
  accel: string,
  options?: { allowFallback?: boolean }
): Promise<HotkeyRegistration> {
  if (typeof window === "undefined") return { ok: true, accelerator: accel };
  const bridge = window.subtrDesktop;
  if (!bridge?.setToggleHotkey) return { ok: true, accelerator: accel };
  try {
    return await bridge.setToggleHotkey(accel, options);
  } catch {
    return { ok: false };
  }
}

const CODE_MAP: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Escape",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_MAP[code] ?? null;
}

export function modifiersFromEvent(event: KeyboardEvent): string[] {
  const mac = isMac();
  const mods: string[] = [];
  if (event.ctrlKey) mods.push("Control");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push(mac ? "Command" : "Super");
  return mods;
}

export function canonicalAccelerator(modifiers: string[], key: string): string {
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.includes(m));
  return [...ordered, key].join("+");
}

export function normalizeAccelerator(accel: string): string {
  const tokens = accel.split("+").filter(Boolean);
  const modifiers = tokens.filter((t) => MODIFIER_ORDER.includes(t));
  const keys = tokens.filter((t) => !MODIFIER_ORDER.includes(t));
  return canonicalAccelerator(modifiers, keys[0] ?? "");
}

export function validateAccelerator(accel: string): { ok: true } | { ok: false; error: HotkeyError } {
  const tokens = accel.split("+").filter(Boolean);
  const modifiers = tokens.filter((t) => MODIFIER_ORDER.includes(t));
  const keys = tokens.filter((t) => !MODIFIER_ORDER.includes(t));

  if (keys.length !== 1) return { ok: false, error: "noKey" };

  const strong = modifiers.some((m) => STRONG_MODIFIERS.has(m));
  if (!strong) return { ok: false, error: "modifier" };

  if (RESERVED_HOTKEYS.has(normalizeAccelerator(accel))) {
    return { ok: false, error: "reserved" };
  }

  return { ok: true };
}

export function acceleratorFromEvent(
  event: KeyboardEvent
): { accel: string } | { error: HotkeyError } {
  if (MODIFIER_CODES.has(event.code)) {
    return { error: "noKey" };
  }
  const key = keyFromCode(event.code);
  if (!key) return { error: "noKey" };
  const accel = canonicalAccelerator(modifiersFromEvent(event), key);
  const validation = validateAccelerator(accel);
  if (!validation.ok) return { error: validation.error };
  return { accel };
}

export function formatAccel(accel: string, mac: boolean = isMac()): string {
  const tokens = accel.split("+").filter(Boolean);
  const glyphs: string[] = [];
  for (const token of tokens) {
    if (mac) {
      switch (token) {
        case "Control":
          glyphs.push("⌃");
          continue;
        case "Alt":
          glyphs.push("⌥");
          continue;
        case "Shift":
          glyphs.push("⇧");
          continue;
        case "Command":
        case "CommandOrControl":
        case "Super":
          glyphs.push("⌘");
          continue;
        default:
          glyphs.push(token);
      }
    } else {
      switch (token) {
        case "Control":
        case "Command":
        case "CommandOrControl":
          glyphs.push("Ctrl");
          continue;
        case "Alt":
          glyphs.push("Alt");
          continue;
        case "Shift":
          glyphs.push("Shift");
          continue;
        case "Super":
          glyphs.push("Win");
          continue;
        default:
          glyphs.push(token);
      }
    }
  }
  return mac ? glyphs.join("") : glyphs.join("+");
}
