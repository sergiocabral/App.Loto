import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessOriginTracker } from "./AccessOriginTracker";

describe("AccessOriginTracker", () => {
  it("sanitizes the origin, preserves other query parameters and removes it after tracking", () => {
    vi.useFakeTimers();
    const track = vi.fn();
    window.umami = { track };
    window.history.replaceState({}, "", "/resultados?keep=sim&origin= Campanha%20VIP!! &origin=other#top");

    render(<AccessOriginTracker />);
    vi.runOnlyPendingTimers();

    expect(track).toHaveBeenCalledWith("Novo acesso", { origin: "campanha-vip", path: "/resultados" });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/resultados?keep=sim#top");
  });

  it("times out safely and cancels retries on unmount", () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/?origin=parceiro");
    const { unmount } = render(<AccessOriginTracker />);

    unmount();
    vi.advanceTimersByTime(5000);
    expect(window.location.search).toBe("?origin=parceiro");
  });
});
