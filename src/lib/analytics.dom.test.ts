import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTracker, getOwnUmami, identifySession, trackEvent } from "./analytics";

const WEBSITE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  delete window.umami;
});

describe("trackEvent", () => {
  it("sanitizes payloads and never lets analytics errors escape", () => {
    const track = vi.fn();
    window.umami = { track };

    expect(trackEvent(" Evento ", { blank: undefined, invalid: Number.NaN, text: ` ${"x".repeat(200)} ` })).toBe(true);
    expect(track).toHaveBeenCalledWith("Evento", { invalid: 0, text: "x".repeat(180) });

    track.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(trackEvent("Falha")).toBe(false);
  });

  it("drops events when window.umami belongs to another Umami website", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", WEBSITE_ID);
    const track = vi.fn();
    window.umami = { getSession: () => ({ cache: "token", website: "global-website" }), track };

    expect(getOwnUmami()).toBeNull();
    expect(trackEvent("Evento")).toBe(false);
    expect(track).not.toHaveBeenCalled();

    window.umami = { getSession: () => ({ cache: "token", website: WEBSITE_ID }), track };

    expect(trackEvent("Evento")).toBe(true);
    expect(track).toHaveBeenCalledWith("Evento");
  });

  it("treats a failing session lookup as a foreign tracker", () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", WEBSITE_ID);
    window.umami = {
      getSession: () => {
        throw new Error("broken");
      },
      track: vi.fn(),
    };

    expect(trackEvent("Evento")).toBe(false);
  });

  it("returns false when Umami is not available", () => {
    expect(trackEvent("Evento")).toBe(false);

    window.umami = { track: vi.fn() };

    expect(trackEvent("   ")).toBe(false);
  });
});

describe("identifySession", () => {
  it("sends sanitized session data through our own tracker", async () => {
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", WEBSITE_ID);
    const identify = vi.fn().mockResolvedValue(undefined);
    window.umami = { getSession: () => ({ website: WEBSITE_ID }), identify };

    await expect(identifySession({ accessPlan: "free", ignored: undefined })).resolves.toBe(true);
    expect(identify).toHaveBeenCalledWith({ accessPlan: "free" });
  });

  it("returns false without data, without identify or when identify fails", async () => {
    await expect(identifySession({ accessPlan: "free" })).resolves.toBe(false);

    window.umami = { identify: vi.fn().mockRejectedValue(new Error("offline")) };

    await expect(identifySession({})).resolves.toBe(false);
    await expect(identifySession({ accessPlan: "free" })).resolves.toBe(false);

    window.umami = { track: vi.fn() };

    await expect(identifySession({ accessPlan: "free" })).resolves.toBe(false);
  });
});

describe("createDebouncedTracker", () => {
  it("sends only the latest data after a burst and supports flush and cancel", () => {
    vi.useFakeTimers();
    const track = vi.fn();
    window.umami = { track };
    const tracker = createDebouncedTracker("Ajustou faixa", 500);

    tracker.track({ value: 1 });
    tracker.track({ value: 2 });
    vi.advanceTimersByTime(499);
    expect(track).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Ajustou faixa", { value: 2 });

    tracker.track({ value: 3 });
    tracker.flush();
    expect(track).toHaveBeenLastCalledWith("Ajustou faixa", { value: 3 });

    tracker.flush();
    tracker.track({ value: 4 });
    tracker.cancel();
    vi.advanceTimersByTime(1000);
    expect(track).toHaveBeenCalledTimes(2);
  });
});
