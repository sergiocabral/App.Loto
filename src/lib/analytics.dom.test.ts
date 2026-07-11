import { describe, expect, it, vi } from "vitest";
import { trackEvent } from "./analytics";

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
});
