import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draw } from "@/lib/types";

const serviceMocks = vi.hoisted(() => ({
  getStoredDraw: vi.fn(),
  loadLotteryHistory: vi.fn(),
}));

vi.mock("@/lib/server/service", () => serviceMocks);

function draw(drawNumber: number, overrides: Partial<Draw> = {}): Draw {
  return {
    lottery: "Quina",
    drawNumber,
    date: "01/01/2026",
    numbers: ["01", "02", "03", "04", "05"],
    numberGroups: [["01", "02", "03", "04", "05"]],
    previousDrawNumber: drawNumber - 1 || null,
    nextDrawNumber: drawNumber + 1,
    raw: {},
    ...overrides,
  };
}

function stringifyElement(element: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(element, (key, value: unknown) => {
    if (key === "_owner" || key === "_store") {
      return undefined;
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return undefined;
      }
      seen.add(value);
    }

    return value;
  });
}

describe("raw results page", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("renders formatted raw history page from database data", async () => {
    serviceMocks.loadLotteryHistory.mockResolvedValueOnce([draw(2), draw(1)]);
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    const element = await RawLotteryPage({
      params: Promise.resolve({ lottery: "Quina" }),
      searchParams: Promise.resolve({}),
    });

    const rendered = stringifyElement(element);

    expect(serviceMocks.loadLotteryHistory).toHaveBeenCalledWith("Quina");
    expect(rendered).toContain("Quina");
    expect(rendered).toContain("Luckygames");
    expect(rendered).toContain("Abrir TXT puro");
    expect(rendered).toContain("00002 | 01/01/2026");
    expect(rendered).toContain("/api/lotteries/Quina?format=legacy");
    expect(rendered).not.toContain("Visão crua dos resultados");
    expect(rendered).not.toContain("Formato");
    expect(rendered).not.toContain("Texto bruto");
  });

  it("renders a single draw raw page when draw query is valid", async () => {
    serviceMocks.getStoredDraw.mockResolvedValueOnce(draw(1234));
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    const element = await RawLotteryPage({
      params: Promise.resolve({ lottery: "Quina" }),
      searchParams: Promise.resolve({ draw: "1234" }),
    });

    const rendered = stringifyElement(element);

    expect(serviceMocks.getStoredDraw).toHaveBeenCalledWith("Quina", 1234);
    expect(serviceMocks.loadLotteryHistory).not.toHaveBeenCalled();
    expect(rendered).toContain("Quina — concurso 1234");
    expect(rendered).toContain("/api/lotteries/Quina?format=legacy&draw=1234");
  });

  it("renders empty state when no raw text exists", async () => {
    serviceMocks.loadLotteryHistory.mockResolvedValueOnce([]);
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    const element = await RawLotteryPage({
      params: Promise.resolve({ lottery: "Quina" }),
      searchParams: Promise.resolve({}),
    });

    expect(stringifyElement(element)).toContain("Nenhum resultado salvo");
  });

  it("renders not found view for unknown lotteries", async () => {
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    const element = await RawLotteryPage({
      params: Promise.resolve({ lottery: "Unknown" }),
      searchParams: Promise.resolve({}),
    });

    expect(stringifyElement(element)).toContain("Jogo não encontrado");
    expect(serviceMocks.loadLotteryHistory).not.toHaveBeenCalled();
    expect(serviceMocks.getStoredDraw).not.toHaveBeenCalled();
  });

  it("uses the first draw query value when duplicate params are provided", async () => {
    serviceMocks.getStoredDraw.mockResolvedValueOnce(draw(7));
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    await RawLotteryPage({
      params: Promise.resolve({ lottery: "Quina" }),
      searchParams: Promise.resolve({ draw: ["7", "8"] }),
    });

    expect(serviceMocks.getStoredDraw).toHaveBeenCalledWith("Quina", 7);
  });

  it("strictly rejects non-integer draw query", async () => {
    const { default: RawLotteryPage } = await import("@/app/raw/[lottery]/page");

    const element = await RawLotteryPage({
      params: Promise.resolve({ lottery: "Quina" }),
      searchParams: Promise.resolve({ draw: "123abc" }),
    });

    expect(serviceMocks.getStoredDraw).not.toHaveBeenCalled();
    expect(serviceMocks.loadLotteryHistory).not.toHaveBeenCalled();
    expect(stringifyElement(element)).toContain("Concurso inválido");
  });
});
