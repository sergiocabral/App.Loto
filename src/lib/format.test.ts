import { describe, expect, it } from "vitest";
import { getLottery } from "@/data/lotteries";
import { formatNumberRuler, normalizeNumbers, splitDrawGroups } from "@/lib/format";

describe("format helpers", () => {
  it("normalizes arrays and strings into sorted two-digit numbers", () => {
    expect(normalizeNumbers(["10", " 2", "03", "abc", "100"])).toEqual(["00", "02", "03", "10"]);
    expect(normalizeNumbers("09 01-7 texto 12")).toEqual(["01", "07", "09", "12"]);
    expect(normalizeNumbers(undefined)).toEqual([]);
  });

  it("does not reject numeric suffixes when preserving current parseInt behavior", () => {
    expect(normalizeNumbers(["12abc", "05"])).toEqual(["05", "12"]);
  });

  it("renders an aligned number ruler", () => {
    expect(formatNumberRuler(["01", "03"], 5)).toBe("  1   3    ");
    expect(formatNumberRuler(["00", "99"], 99)).toContain("00");
    expect(formatNumberRuler(["00", "99"], 99)).toContain("99");
  });

  it("splits grouped lotteries using their configured sizes", () => {
    const duplaSena = getLottery("DuplaSena");

    expect(duplaSena).not.toBeNull();
    expect(
      splitDrawGroups(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"], duplaSena!),
    ).toEqual([
      ["01", "02", "03", "04", "05", "06"],
      ["07", "08", "09", "10", "11", "12"],
    ]);
  });

  it("returns one group for simple lotteries", () => {
    const megaSena = getLottery("MegaSena");

    expect(megaSena).not.toBeNull();
    expect(splitDrawGroups(["01", "02", "03", "04", "05", "06"], megaSena!)).toEqual([
      ["01", "02", "03", "04", "05", "06"],
    ]);
  });
});
