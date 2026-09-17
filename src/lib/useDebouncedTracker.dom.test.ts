import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedTracker } from "./useDebouncedTracker";

afterEach(() => {
  delete window.umami;
});

describe("useDebouncedTracker", () => {
  it("keeps the same tracker across renders and flushes the pending event on unmount", () => {
    vi.useFakeTimers();
    const track = vi.fn();
    window.umami = { track };
    const { rerender, result, unmount } = renderHook(() => useDebouncedTracker("Ajustou faixa análise"));
    const firstTracker = result.current;

    rerender();
    expect(result.current).toBe(firstTracker);

    result.current.track({ selectedCount: 12 });
    unmount();

    expect(track).toHaveBeenCalledWith("Ajustou faixa análise", { selectedCount: 12 });
    vi.advanceTimersByTime(2000);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
