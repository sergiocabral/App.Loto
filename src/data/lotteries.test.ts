import { describe, expect, it } from "vitest";
import { getLottery, isLotterySlug, LOTTERIES } from "@/data/lotteries";

describe("lottery definitions", () => {
  it("keeps the supported lotteries unique and mapped to Caixa slugs", () => {
    const slugs = LOTTERIES.map((lottery) => lottery.slug);
    const apiSlugs = LOTTERIES.map((lottery) => lottery.apiSlug);

    expect(new Set(slugs).size).toBe(LOTTERIES.length);
    expect(new Set(apiSlugs).size).toBe(LOTTERIES.length);
    expect(slugs).toEqual(["MegaSena", "LotoFacil", "Quina", "LotoMania", "DuplaSena", "TimeMania", "DiaDeSorte"]);
  });

  it("resolves lotteries case-insensitively without accepting unknown values", () => {
    expect(getLottery("MegaSena")?.apiSlug).toBe("megasena");
    expect(getLottery("megasena")?.slug).toBe("MegaSena");
    expect(getLottery("MEGASENA")?.countNumbers).toBe(60);
    expect(getLottery("../MegaSena")).toBeNull();
    expect(getLottery("MegaSena?format=legacy")).toBeNull();
    expect(isLotterySlug("Quina")).toBe(true);
    expect(isLotterySlug("quina")).toBe(true);
    expect(isLotterySlug("Loteca")).toBe(false);
  });

  it("keeps DuplaSena configured as two groups in one draw", () => {
    expect(getLottery("DuplaSena")).toMatchObject({
      apiSlug: "duplasena",
      countNumbers: 50,
      numbersPerDraw: 12,
      groups: [6, 6],
    });
  });

  it("keeps LotoMania range compatible with number zero", () => {
    expect(getLottery("LotoMania")).toMatchObject({
      countNumbers: 99,
      numbersPerDraw: 20,
    });
  });
});
