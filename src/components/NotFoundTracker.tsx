"use client";

import { useEffect } from "react";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

const TRACK_RETRY_INTERVAL_MS = 250;
const TRACK_TIMEOUT_MS = 5000;

type NotFoundTrackerProps = {
  kind: "lottery" | "page";
};

/** Registra páginas inexistentes; tenta por alguns segundos porque o Umami pode ainda estar carregando. */
export function NotFoundTracker({ kind }: NotFoundTrackerProps) {
  useEffect(() => {
    const startedAt = Date.now();
    const path = window.location.pathname;
    let retryTimer: number | undefined;

    function tryTrack() {
      if (trackEvent(ANALYTICS_EVENTS.pageNotFound, { kind, path }) || Date.now() - startedAt >= TRACK_TIMEOUT_MS) {
        return;
      }

      retryTimer = window.setTimeout(tryTrack, TRACK_RETRY_INTERVAL_MS);
    }

    tryTrack();

    return () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [kind]);

  return null;
}
