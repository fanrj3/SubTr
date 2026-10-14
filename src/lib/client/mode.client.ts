"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readMode, subscribeMode, writeMode } from "./mode";

export function useModeState(): boolean {
  return useSyncExternalStore(subscribeMode, readMode, () => false);
}

export function useMode(): [boolean, (enabled: boolean) => void] {
  const mode = useModeState();

  // Report the Translate-mode state to the desktop tray on mount and on change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.subtrDesktop?.setTrayState?.(mode);
  }, [mode]);

  // Global hotkey / tray toggle. Only one window mounts this at a time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = window.subtrDesktop;
    if (!bridge?.onToggleMode) return;
    return bridge.onToggleMode(() => {
      writeMode(!readMode());
    });
  }, []);

  const setMode = useCallback((enabled: boolean) => {
    writeMode(enabled);
  }, []);

  return [mode, setMode];
}
