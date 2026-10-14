"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocalStorage, useT } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { EditIcon, CheckIcon } from "./icons";

const TEXT_KEY = "subtr.text.v1";

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

type ReaderProps = {
  onSelect: (text: string) => void;
  mode?: boolean;
};

export function Reader({ onSelect, mode }: ReaderProps) {
  const { t } = useT();
  const mounted = useIsMounted();
  const [text, setText] = useLocalStorage(TEXT_KEY, "");
  const [isEditing, setIsEditing] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [isEditing]);

  useEffect(() => {
    function handleSelection() {
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      if (range.collapsed) return;

      const anchor = range.startContainer;
      const focus = range.endContainer;
      const reader = readerRef.current;
      if (!reader) return;

      if (!reader.contains(anchor) || !reader.contains(focus)) return;

      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.closest("[data-subtr-overlay]") ||
        active?.closest("[data-subtr-settings]")
      ) {
        return;
      }

      const selected = sel.toString().trim();
      if (!selected) return;
      onSelect(selected);
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    function onFinish() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(handleSelection, 250);
    }

    function onKeyUp(e: KeyboardEvent) {
      // Esc dismisses the subtitle; don't let the debounce bring it back.
      if (e.key === "Escape") return;
      onFinish();
    }

    document.addEventListener("mouseup", onFinish);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onFinish);
      document.removeEventListener("keyup", onKeyUp);
      if (timer) clearTimeout(timer);
    };
  }, [onSelect]);

  if (isEditing) {
    return (
      <main className="mx-auto w-full max-w-[65ch] flex-1 px-6 py-6 sm:py-8">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <CheckIcon className="h-4 w-4" />
            {t("reader.done")}
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("reader.placeholder")}
          className="min-h-[50vh] w-full resize-none rounded-2xl border border-card-border bg-card p-5 text-lg leading-relaxed outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={t("reader.aria.edit")}
        />
      </main>
    );
  }

  if (!text.trim()) {
    return (
      <main className="mx-auto flex w-full max-w-[65ch] flex-1 flex-col items-center justify-start px-6 py-10 text-center sm:py-12">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="group w-full rounded-2xl border-2 border-dashed border-card-border bg-transparent p-8 transition-colors hover:border-accent/40 hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <p className="text-lg text-foreground">{t("reader.empty.title")}</p>
          <p className="mt-2 text-sm text-muted">
            {t("reader.empty.subtitle")}
          </p>
          {mounted && isDesktopMode() && (
            <p className="mt-2 text-xs text-muted">
              {t("reader.empty.desktop")}
            </p>
          )}
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[65ch] flex-1 px-6 py-6 sm:py-8">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          aria-label={t("reader.aria.edit")}
        >
          <EditIcon className="h-4 w-4" />
          {t("reader.edit")}
        </button>
      </div>
      <div
        ref={readerRef}
        className="whitespace-pre-wrap text-lg leading-[1.8] tracking-[-0.01em] text-foreground selection:bg-accent selection:text-white"
        aria-label={t("reader.aria.reading")}
      >
        {text}
      </div>
      <p className="mt-4 text-center text-xs text-muted">
        {mode ? t("reader.hint.on") : t("reader.hint.off")}
      </p>
    </main>
  );
}
