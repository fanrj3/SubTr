"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    // Make client navigation feel instant: no enter animation, predictable
    // scroll-to-top, and no header jitter.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return <div className="flex flex-1 flex-col">{children}</div>;
}
