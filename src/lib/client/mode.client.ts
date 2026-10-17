"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readMode, subscribeMode, writeMode } from "./mode";

export function useModeState(): boolean {
  return useSyncExternalStore(subscribeMode, readMode, () => false);
}

export function useMode(): [boolean, (enabled: boolean) => void] {
  const mode = useModeState();

  // Global hotkey / tray toggle is handled by <ModeBridge /> in the root layout
  // so it also works on Settings and other non-home routes. The main process is
  // the authoritative tray source; only user-initiated switches are reported.
  const setMode = useCallback((enabled: boolean) => {
    writeMode(enabled);
    if (typeof window !== "undefined") window.subtrDesktop?.setMode?.(enabled);
  }, []);

  return [mode, setMode];
}
