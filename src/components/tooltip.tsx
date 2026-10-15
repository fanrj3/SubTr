"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/lib/client";

const VIEWPORT_MARGIN = 8;

export function HelpTooltip({ children }: { children: string }) {
  const { t } = useT();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; open: boolean }>({
    top: 0,
    left: 0,
    open: false,
  });
  const measuredRef = useRef(false);

  const show = useCallback(() => {
    measuredRef.current = false;
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({ top: rect.bottom + 6, left: rect.left, open: true });
  }, []);

  const hide = useCallback(() => {
    setPosition((prev) => ({ ...prev, open: false }));
  }, []);

  // Reposition after measuring: clamp inside the pane column and flip above
  // the anchor when there is not enough room below.
  useLayoutEffect(() => {
    if (!position.open || measuredRef.current) return;
    const button = buttonRef.current;
    const tip = tooltipRef.current;
    if (!button || !tip || typeof window === "undefined") return;
    measuredRef.current = true;

    const anchor = button.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const pane = tip.closest("main");
    const paneRect = pane?.getBoundingClientRect();

    const minLeft = paneRect ? Math.max(VIEWPORT_MARGIN, paneRect.left + VIEWPORT_MARGIN) : VIEWPORT_MARGIN;
    const maxLeft =
      (paneRect ? Math.min(window.innerWidth, paneRect.right) : window.innerWidth) -
      width -
      VIEWPORT_MARGIN;
    let left = anchor.left + anchor.width / 2 - width / 2;
    left = Math.max(minLeft, Math.min(Math.max(minLeft, maxLeft), left));

    let top = anchor.bottom + 6;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = anchor.top - height - 6;
    }
    top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - height - VIEWPORT_MARGIN, top));

    setPosition({ top, left, open: true });
  }, [position.open]);

  return (
    <span className="inline-flex align-middle">
      <button
        ref={buttonRef}
        type="button"
        aria-describedby={position.open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-card-border bg-background text-[10px] leading-none text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={t("tooltip.moreInfo")}
      >
        ?
      </button>
      {position.open && (
        <span
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className="fixed z-[60] w-56 rounded-lg border border-card-border bg-card px-3 py-2 text-left text-xs leading-snug text-foreground shadow-md"
          style={{ top: position.top, left: position.left }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
