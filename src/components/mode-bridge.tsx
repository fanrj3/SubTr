"use client";

import { useEffect } from "react";
import { readHotkey, registerHotkey, writeHotkey } from "@/lib/client/hotkey";
import { readMode, writeMode } from "@/lib/client/mode";
import { writeStorage } from "@/lib/client/storage";

/**
 * App-wide desktop bridge for translation mode + the global toggle hotkey.
 *
 * Mounted by the root layout (not the home page), so the hotkey and tray stay
 * in sync on every route — Settings, panel previews, and the home reader alike.
 * The main process owns the authoritative value while the app is running; this
 * component only mirrors it into localStorage.
 */
export function ModeBridge() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = window.subtrDesktop;
    if (!bridge?.isDesktop) return;

    // The overlay window shares the origin but must not own hotkey registration
    // (main only accepts it from the reader window).
    const isOverlay = window.location.pathname.startsWith("/overlay");
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    if (!isOverlay) {
      void (async () => {
        const requested = readHotkey();
        const result = await registerHotkey(requested, { allowFallback: true });
        if (cancelled) return;
        if (result.ok && result.accelerator && result.accelerator !== requested) {
          // Persist the accelerator that actually won, so the Settings recorder
          // and the TopBar hint show the truth.
          writeHotkey(result.accelerator);
        }
        try {
          writeStorage("subtr.hotkey.status.v1", {
            ok: result.ok,
            accelerator: result.accelerator ?? requested,
            fallback: !!result.fallback,
            error: result.error ?? null,
            at: Date.now(),
          });
        } catch {
          // ignore quota / private-mode failures
        }
      })();

      // Seed main once, then ask for the authoritative value (covers a window
      // recreated while the hotkey kept toggling).
      bridge.syncMode?.(readMode());
      bridge.requestToggleMode?.();

      if (bridge.onToggleMode) {
        unsubscribe = bridge.onToggleMode((payload) => {
          const next =
            typeof payload?.enabled === "boolean" ? payload.enabled : !readMode();
          writeMode(next);
        });
      }
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}
