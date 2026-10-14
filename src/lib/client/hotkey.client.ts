"use client";

import { useEffect } from "react";
import { readHotkey, registerHotkey } from "./hotkey";

export function useHotkeyBootstrap(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    void registerHotkey(readHotkey());
  }, []);
}
