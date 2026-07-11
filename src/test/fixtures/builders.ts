import type { CaixaLotteryResponse, Draw } from "@/lib/types";

export function buildDraw(overrides: Partial<Draw> = {}): Draw {
  const drawNumber = overrides.drawNumber ?? 1;

  return {
    lottery: "MegaSena",
    drawNumber,
    date: "01/01/2026",
    numbers: ["01", "02", "03", "04", "05", "06"],
    numberGroups: [["01", "02", "03", "04", "05", "06"]],
    previousDrawNumber: drawNumber > 1 ? drawNumber - 1 : null,
    nextDrawNumber: drawNumber + 1,
    raw: {},
    ...overrides,
  };
}

export function buildCaixaResponse(overrides: CaixaLotteryResponse = {}): CaixaLotteryResponse {
  return {
    numero: 1,
    numeroConcursoAnterior: undefined,
    numeroConcursoProximo: 2,
    dataApuracao: "01/01/2026",
    dezenasSorteadasOrdemSorteio: ["01", "02", "03", "04", "05", "06"],
    ...overrides,
  };
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}
