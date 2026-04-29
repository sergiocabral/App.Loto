"use client";

import { useEffect } from "react";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

const ACCESS_ORIGIN_QUERY_PARAM = "origin";
const MAX_ACCESS_ORIGIN_LENGTH = 80;
const TRACK_RETRY_INTERVAL_MS = 250;
const TRACK_TIMEOUT_MS = 4000;

function sanitizeAccessOrigin(value: string | null): string | null {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_ACCESS_ORIGIN_LENGTH);

  return normalized || null;
}

function getDecodedQueryKey(segment: string): string {
  const rawKey = segment.split("=", 1)[0]?.replace(/\+/g, " ") ?? "";

  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

function buildUrlWithoutAccessOrigin(url: URL): string {
  const query = url.search
    .slice(1)
    .split("&")
    .filter((segment) => segment && getDecodedQueryKey(segment) !== ACCESS_ORIGIN_QUERY_PARAM)
    .join("&");

  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

function replaceCurrentUrl(path: string): void {
  window.history.replaceState(window.history.state, "", path);
}

export function AccessOriginTracker() {
  useEffect(() => {
    const currentUrl = new URL(window.location.href);

    if (!currentUrl.searchParams.has(ACCESS_ORIGIN_QUERY_PARAM)) {
      return;
    }

    const cleanPath = buildUrlWithoutAccessOrigin(currentUrl);
    const origin = sanitizeAccessOrigin(currentUrl.searchParams.get(ACCESS_ORIGIN_QUERY_PARAM));

    if (!origin) {
      replaceCurrentUrl(cleanPath);
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;
    const startedAt = Date.now();

    function finish(): void {
      if (cancelled) {
        return;
      }

      replaceCurrentUrl(cleanPath);
    }

    function tryTrackOrigin(): void {
      if (cancelled) {
        return;
      }

      const tracked = trackEvent(ANALYTICS_EVENTS.newAccess, {
        origin,
        path: currentUrl.pathname,
      });

      if (tracked || Date.now() - startedAt >= TRACK_TIMEOUT_MS) {
        finish();
        return;
      }

      retryTimer = window.setTimeout(tryTrackOrigin, TRACK_RETRY_INTERVAL_MS);
    }

    retryTimer = window.setTimeout(tryTrackOrigin, 0);

    return () => {
      cancelled = true;

      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  return null;
}
