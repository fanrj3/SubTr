"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getTextMetrics, useLocalStorage, useT } from "@/lib/client";
import { isDesktopMode } from "@/lib/client/desktop";
import { EditIcon, CheckIcon, SubTrLogo } from "./icons";

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

  const metrics = getTextMetrics(text);
  const wordCount = metrics.latinWords + Math.round(metrics.cjkChars / 2);
  const charCount = Array.from(text.trim()).length;

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

  async function pasteFromClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      if (value.trim()) {
        setText(value);
        return;
      }
    } catch {
      // Permission denied / unsupported — fall through to the editor.
    }
    setIsEditing(true);
  }

  if (isEditing) {
    return (
      <main className="mx-auto w-full max-w-[68ch] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium text-muted">{t("reader.editing.hint")}</p>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-card-border bg-card px-3 py-1.5 text-[12px] font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <CheckIcon className="h-4 w-4" />
            {t("reader.done")}
          </button>
        </div>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("reader.placeholder")}
            className="min-h-[52vh] w-full resize-none rounded-[22px] border border-card-border bg-card px-5 py-5 text-[17px] leading-[1.85] outline-none shadow-sm transition-shadow placeholder:text-muted/70 focus-visible:ring-2 focus-visible:ring-accent sm:px-6"
            aria-label={t("reader.aria.edit")}
          />
          <span className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-background/80 px-2 py-0.5 text-[10px] tabular-nums text-muted backdrop-blur">
            {t("reader.meta.chars", { n: charCount })}
          </span>
        </div>
      </main>
    );
  }

  if (!text.trim()) {
    return (
      <main className="mx-auto flex w-full max-w-[68ch] flex-1 flex-col items-center justify-start px-4 pb-8 pt-8 text-center sm:px-6 sm:pt-14">
        <div className="w-full rounded-[26px] border border-card-border bg-card/70 p-7 shadow-sm backdrop-blur-sm sm:p-10">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-dim text-accent ring-1 ring-accent/15">
            <SubTrLogo className="h-6 w-6" />
          </span>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            {t("reader.empty.kicker")}
          </p>
          <h1 className="mx-auto mt-2 max-w-[24ch] text-[22px] font-semibold leading-[1.25] tracking-[-0.02em] text-foreground sm:text-[24px]">
            {t("reader.empty.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-[42ch] text-[13px] leading-relaxed text-muted">
            {t("reader.empty.subtitle")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void pasteFromClipboard()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[12px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
            >
              {t("reader.paste")}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-card-border bg-background px-4 text-[12px] font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
            >
              <EditIcon className="h-4 w-4" />
              {t("reader.write")}
            </button>
          </div>
          {mounted && isDesktopMode() && (
            <p className="mt-4 text-[11px] text-muted">
              {t("reader.empty.desktop")}
            </p>
          )}
        </div>
        <p className="mt-4 text-[11px] text-muted">{t("reader.empty.hint")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[68ch] flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success/70" />
          <span className="tabular-nums">{t("reader.meta.words", { n: wordCount })}</span>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">{t("reader.meta.chars", { n: charCount })}</span>
        </div>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-card-border bg-card px-3 py-1.5 text-[12px] font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          aria-label={t("reader.aria.edit")}
        >
          <EditIcon className="h-4 w-4" />
          {t("reader.edit")}
        </button>
      </div>
      <div
        ref={readerRef}
        className="rounded-[22px] border border-card-border/80 bg-card/60 px-5 py-6 text-[17px] leading-[1.85] tracking-[-0.011em] text-foreground shadow-sm backdrop-blur-sm selection:bg-accent selection:text-white sm:px-7 sm:py-7"
        aria-label={t("reader.aria.reading")}
      >
        <div className="whitespace-pre-wrap">{text}</div>
      </div>
      <p className="mt-3 text-center text-[11px] text-muted">
        {mode ? t("reader.hint.on") : t("reader.hint.off")}
      </p>
    </main>
  );
}
