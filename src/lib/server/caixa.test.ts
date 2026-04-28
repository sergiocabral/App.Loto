import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaixaLotteryResponse } from "@/lib/types";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("Caixa API integration", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("fetches and normalizes a simple lottery draw", async () => {
    const raw: CaixaLotteryResponse = {
      numero: 3000,
      numeroConcursoAnterior: 2999,
      numeroConcursoProximo: 3001,
      dataApuracao: "26/04/2026",
      dezenasSorteadasOrdemSorteio: ["18", "02", "26", "08", "28", "27"],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(raw));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");
    const draw = await fetchDrawFromCaixa("MegaSena", 3000);

    expect(fetchMock).toHaveBeenCalledWith("https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena/3000", expect.any(Object));
    expect(draw).toMatchObject({
      lottery: "MegaSena",
      drawNumber: 3000,
      date: "26/04/2026",
      numbers: ["02", "08", "18", "26", "27", "28"],
      numberGroups: [["02", "08", "18", "26", "27", "28"]],
      previousDrawNumber: 2999,
      nextDrawNumber: 3001,
      raw,
    });
  });

  it("uses response draw number when Caixa returns a different existing draw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          numero: 2999,
          dataApuracao: "24/04/2026",
          dezenasSorteadasOrdemSorteio: ["01", "02", "03", "04", "05", "06"],
        }),
      ),
    );

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");
    const draw = await fetchDrawFromCaixa("MegaSena", 3000);

    expect(draw?.drawNumber).toBe(2999);
  });

  it("extracts DuplaSena groups from explicit Caixa fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          numero: 123,
          dataApuracao: "01/01/2026",
          listaDezenas: ["06", "05", "04", "03", "02", "01"],
          listaDezenasSegundoSorteio: ["12", "11", "10", "09", "08", "07"],
        }),
      ),
    );

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");
    const draw = await fetchDrawFromCaixa("DuplaSena", 123);

    expect(draw?.numberGroups).toEqual([
      ["01", "02", "03", "04", "05", "06"],
      ["07", "08", "09", "10", "11", "12"],
    ]);
    expect(draw?.numbers).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
  });

  it("splits DuplaSena combined draw numbers when explicit groups are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          numero: 123,
          dataApuracao: "01/01/2026",
          dezenasSorteadasOrdemSorteio: ["12", "01", "11", "02", "10", "03", "09", "04", "08", "05", "07", "06"],
          listaDezenas: [],
        }),
      ),
    );

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");
    const draw = await fetchDrawFromCaixa("DuplaSena", 123);

    expect(draw?.numberGroups).toEqual([
      ["01", "02", "03", "04", "05", "06"],
      ["07", "08", "09", "10", "11", "12"],
    ]);
  });

  it("returns null for 404 without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");

    await expect(fetchDrawFromCaixa("MegaSena", 999999)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws CaixaApiError after all HTTP 500 attempts fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { CaixaApiError, fetchDrawFromCaixa } = await import("@/lib/server/caixa");

    await expect(fetchDrawFromCaixa("MegaSena", 3001)).rejects.toBeInstanceOf(CaixaApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null when normalized groups are empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          numero: 123,
          dataApuracao: "01/01/2026",
          dezenasSorteadasOrdemSorteio: "texto sem dezenas",
          listaDezenas: [],
        }),
      ),
    );

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");

    await expect(fetchDrawFromCaixa("DuplaSena", 123)).resolves.toBeNull();
  });

  it("returns null when Caixa response has no numbers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ numero: 1, dataApuracao: "01/01/2026" })));

    const { fetchDrawFromCaixa } = await import("@/lib/server/caixa");

    await expect(fetchDrawFromCaixa("MegaSena", 1)).resolves.toBeNull();
  });

  it("rejects unknown lottery slugs before calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { CaixaApiError, fetchDrawFromCaixa } = await import("@/lib/server/caixa");

    await expect(fetchDrawFromCaixa("Unknown", 1)).rejects.toBeInstanceOf(CaixaApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
