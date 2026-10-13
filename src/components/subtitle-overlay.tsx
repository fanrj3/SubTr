"use client";

import { useEffect, useRef } from "react";
import { XIcon, LoaderIcon, AlertIcon } from "./icons";

export type SubtitleState =
  | { kind: "idle" }
  | { kind: "loading"; original: string }
  | { kind: "streaming"; original: string; text: string }
  | { kind: "error"; original: string; message: string }
  | { kind: "success"; original: string; text: string };

type SubtitleOverlayProps = {
  state: SubtitleState;
  onDismiss: () => void;
};

const IDLE_HIDE_MS = 20000;

export function SubtitleOverlay({ state, onDismiss }: SubtitleOverlayProps) {
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.kind === "idle") {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    if (state.kind === "error" || state.kind === "success") {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(onDismiss, IDLE_HIDE_MS);
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [state, onDismiss]);

  if (state.kind === "idle") return null;

  const isError = state.kind === "error";
  const isLoading = state.kind === "loading";
  const rawText = isError ? state.message : state.kind === "loading" ? "" : state.text;
  const hasText = rawText.trim().length > 0;
  const mainText = hasText ? rawText : isError ? state.message : "No translation returned";

  return (
    <div
      data-subtr-overlay
      className="pointer-events-none fixed inset-x-0 bottom-[clamp(3rem,12vh,8rem)] z-40 mx-auto flex max-w-[min(920px,92vw)] justify-center px-4 animate-subtitle-in"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="pointer-events-auto relative w-full rounded-2xl border border-white/10 bg-black/82 px-6 py-4 text-center text-white shadow-lg backdrop-blur-xl transition-all">
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Dismiss subtitle"
        >
          <XIcon className="h-4 w-4" />
        </button>

        <p className="mb-1 line-clamp-2 text-xs leading-relaxed text-white/55">
          {state.original}
        </p>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-1 text-white/80">
            <LoaderIcon className="h-4 w-4" />
            <span className="text-base">Translating</span>
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center gap-2 py-1 text-danger">
            <AlertIcon className="h-5 w-5" />
            <span className="text-base">{mainText}</span>
          </div>
        )}

        {!isLoading && !isError && (
          <p
            className={`text-lg leading-snug tracking-wide ${
              hasText
                ? "font-medium text-white"
                : "text-white/60"
            }`}
          >
            {mainText}
            {state.kind === "streaming" && hasText && (
              <span
                className="ml-0.5 inline-block h-[1em] w-0.5 align-middle bg-white/80 animate-caret-blink"
                aria-hidden="true"
              />
            )}
          </p>
        )}
      </div>
    </div>
  );
}
