"use client";

import { useEffect, useState } from "react";
import { createDebouncedTracker, trackEvent, type DebouncedTracker } from "@/lib/analytics";

export const TRACKING_DEBOUNCE_MS = 800;

/**
 * Tracker com debounce estável durante a vida do componente. O evento pendente é enviado ao desmontar
 * (ex.: fechar o simulador logo após mexer num slider) para não se perder.
 */
export function useDebouncedTracker(eventName: string, delayMs = TRACKING_DEBOUNCE_MS): DebouncedTracker {
  const [tracker] = useState(() => createDebouncedTracker(eventName, delayMs, trackEvent));

  useEffect(() => () => tracker.flush(), [tracker]);

  return tracker;
}
