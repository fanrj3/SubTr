import { readStorage, writeStorage } from "./storage";

export const MODE_KEY = "subtr.mode.v1";

const listeners = new Set<() => void>();

export function subscribeMode(callback: () => void): () => void {
  listeners.add(callback);
  function onStorage(e: StorageEvent): void {
    if (e.key === MODE_KEY) callback();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function notifyModeListeners(): void {
  listeners.forEach((cb) => cb());
}

export function readMode(): boolean {
  return readStorage<boolean>(MODE_KEY, false);
}

export function writeMode(enabled: boolean): void {
  writeStorage(MODE_KEY, enabled);
  notifyModeListeners();
}
