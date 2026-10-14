"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./storage";

const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  listeners.get(key)?.forEach((cb) => cb());
}

/** Notify `useLocalStorage` subscribers for a key after an out-of-band write. */
export function notifyStorageKey(key: string): void {
  notify(key);
}

function subscribe(key: string, callback: () => void): () => void {
  if (!listeners.has(key)) {
    listeners.set(key, new Set());
  }
  listeners.get(key)?.add(callback);

  function onStorage(e: StorageEvent): void {
    if (e.key === key) callback();
  }

  window.addEventListener("storage", onStorage);
  return () => {
    listeners.get(key)?.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLocalStorage<T>(
  key: string,
  fallback: T
): [T, (update: T | ((prev: T) => T)) => void] {
  const getSnapshot = useCallback(() => readStorage<T>(key, fallback), [key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(
    useCallback((callback) => subscribe(key, callback), [key]),
    getSnapshot,
    getServerSnapshot
  );

  const setValue = useCallback(
    (update: T | ((prev: T) => T)) => {
      const next = typeof update === "function" ? (update as (prev: T) => T)(value) : update;
      writeStorage(key, next);
      notify(key);
    },
    [key, value]
  );

  return [value, setValue];
}
