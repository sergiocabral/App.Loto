"use client";

import { useEffect } from "react";

export function AutoRefresh({ delay = 1000 }: { delay?: number }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => window.location.reload(), delay);
    return () => window.clearTimeout(timeout);
  }, [delay]);

  return null;
}
