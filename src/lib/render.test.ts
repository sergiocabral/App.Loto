import { describe, expect, it } from "vitest";
import { renderDrawText, renderHistoryText, lotteryNames } from "@/lib/render";
import type { Draw } from "@/lib/types";

function makeDraw(overrides: Partial<Draw> = {}): Draw {
  return {
    lottery: "MegaSena",
    drawNumber: 3000,
    date: "26/04/2026",
    numbers: ["02", "08", "18", "26", "27", "28"],
    previousDrawNumber: 2999,
    nextDrawNumber: 3001,
    raw: {},
    ...overrides,
  };
}

describe("legacy text rendering", () => {
  it("renders simple lottery draw with id, date, numbers and separator", () => {
    expect(renderDrawText(makeDraw())).toBe("03000 | 26/04/2026 | 02 08 18 26 27 28\n--------------------------------------\n");
  });

  it("renders extended number ruler for history/raw text", () => {
    const text = renderDrawText(makeDraw({ numbers: ["01", "03", "60"] }), true);

    expect(text).toContain("03000 | 26/04/2026 | 01 03 60 | ");
    expect(text).toContain("01");
    expect(text).toContain("03");
    expect(text).toContain("60");
  });

  it("renders DuplaSena as two lines under the same draw", () => {
    const text = renderDrawText(
      makeDraw({
        lottery: "DuplaSena",
        drawNumber: 123,
        numbers: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
        numberGroups: [
          ["01", "02", "03", "04", "05", "06"],
          ["07", "08", "09", "10", "11", "12"],
        ],
      }),
    );

    expect(text).toContain("00123 | 26/04/2026 | 01 02 03 04 05 06");
    expect(text).toContain("      |            | 07 08 09 10 11 12");
  });

  it("splits DuplaSena by definition if groups are not present", () => {
    const text = renderDrawText(
      makeDraw({
        lottery: "DuplaSena",
        drawNumber: 123,
        numbers: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
        numberGroups: undefined,
      }),
    );

    expect(text).toContain("01 02 03 04 05 06");
    expect(text).toContain("07 08 09 10 11 12");
  });

  it("renders history by concatenating draw texts", () => {
    const text = renderHistoryText([
      makeDraw({ drawNumber: 2, numbers: ["01", "02", "03", "04", "05", "06"] }),
      makeDraw({ drawNumber: 1, numbers: ["07", "08", "09", "10", "11", "12"] }),
    ]);

    expect(text).toContain("00002 | 26/04/2026 | 01 02 03 04 05 06 | ");
    expect(text).toContain("00001 | 26/04/2026 | 07 08 09 10 11 12 | ");
    expect(text.indexOf("00002")).toBeLessThan(text.indexOf("00001"));
  });

  it("returns empty text for unknown lotteries or empty numbers", () => {
    expect(renderDrawText(makeDraw({ lottery: "Unknown", numbers: ["01"] }))).toBe("");
    expect(renderDrawText(makeDraw({ numbers: [] }))).toBe("");
  });

  it("exports all known lottery slugs for legacy routes", () => {
    expect(lotteryNames).toContain("MegaSena");
    expect(lotteryNames).toContain("DuplaSena");
  });
});
