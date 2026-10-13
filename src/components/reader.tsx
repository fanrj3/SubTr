"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/lib/client";
import { EditIcon, XIcon } from "./icons";

const TEXT_KEY = "subtr.text.v1";

type ReaderProps = {
  onSelect: (text: string) => void;
};

export function Reader({ onSelect }: ReaderProps) {
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

    document.addEventListener("mouseup", onFinish);
    document.addEventListener("keyup", onFinish);
    return () => {
      document.removeEventListener("mouseup", onFinish);
      document.removeEventListener("keyup", onFinish);
      if (timer) clearTimeout(timer);
    };
  }, [onSelect]);

  if (isEditing) {
    return (
      <main className="mx-auto w-full max-w-[65ch] flex-1 px-6 py-12 sm:py-16">
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
            Done
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste text here to read..."
          className="min-h-[60vh] w-full resize-none rounded-2xl border border-card-border bg-card p-6 text-lg leading-relaxed outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Edit text"
        />
      </main>
    );
  }

  if (!text.trim()) {
    return (
      <main className="mx-auto flex w-full max-w-[65ch] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="group w-full rounded-2xl border-2 border-dashed border-card-border bg-transparent p-10 transition-colors hover:border-accent/40 hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <p className="text-lg text-foreground">Paste text here to read</p>
          <p className="mt-2 text-sm text-muted">Click to add your first passage</p>
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[65ch] flex-1 px-6 py-12 sm:py-16">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5"
          aria-label="Edit text"
        >
          <EditIcon className="h-4 w-4" />
          Edit
        </button>
      </div>
      <div
        ref={readerRef}
        className="whitespace-pre-wrap text-lg leading-[1.8] tracking-[-0.01em] text-foreground selection:bg-accent selection:text-white"
        aria-label="Reading text. Select any passage to translate."
      >
        {text}
      </div>
    </main>
  );
}
