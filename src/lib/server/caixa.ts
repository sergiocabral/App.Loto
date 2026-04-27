import { getLottery, type LotteryDefinition } from "@/data/lotteries";
import { normalizeNumbers } from "@/lib/format";
import type { CaixaLotteryResponse, Draw } from "@/lib/types";

const CAIXA_BASE_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api";
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ATTEMPTS = 3;
const CAIXA_LOG_PREFIX = "[app-loto-next][caixa]";

function logCaixa(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(CAIXA_LOG_PREFIX, message, details);
    return;
  }

  console.info(CAIXA_LOG_PREFIX, message);
}

function warnCaixa(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(CAIXA_LOG_PREFIX, message, details);
    return;
  }

  console.warn(CAIXA_LOG_PREFIX, message);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export class CaixaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CaixaApiError";
  }
}

function buildUrl(lottery: LotteryDefinition, drawNumber: number): string {
  return `${CAIXA_BASE_URL}/${lottery.apiSlug}/${drawNumber}`;
}

function extractNumberGroups(lottery: LotteryDefinition, raw: CaixaLotteryResponse): string[][] {
  if (lottery.groups?.length) {
    const combinedNumbers = normalizeNumbers(raw.dezenasSorteadasOrdemSorteio);
    const firstGroup = normalizeNumbers(raw.listaDezenas ?? raw.dezenasSorteadasOrdemSorteio);
    const secondGroup = normalizeNumbers(raw.listaDezenasSegundoSorteio);
    const explicitGroups = [firstGroup, secondGroup].filter((group) => group.length > 0);

    if (explicitGroups.length) {
      return explicitGroups;
    }

    if (!combinedNumbers.length) {
      return [];
    }

    let offset = 0;
    return lottery.groups
      .map((groupSize) => {
        const group = combinedNumbers.slice(offset, offset + groupSize);
        offset += groupSize;
        return group;
      })
      .filter((group) => group.length > 0);
  }

  return [normalizeNumbers(raw.dezenasSorteadasOrdemSorteio ?? raw.listaDezenas)].filter((group) => group.length > 0);
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    logCaixa("fetch:start", { url, timeoutMs: REQUEST_TIMEOUT_MS });
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://www.google.com/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.89 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    logCaixa("fetch:response", { url, status: response.status, ok: response.ok, elapsedMs: elapsedMs(startedAt) });
    return response;
  } catch (error) {
    warnCaixa("fetch:error", {
      url,
      elapsedMs: elapsedMs(startedAt),
      error: error instanceof Error ? { name: error.name, message: error.message } : error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRawDraw(lottery: LotteryDefinition, drawNumber: number): Promise<CaixaLotteryResponse | null> {
  const startedAt = Date.now();
  const url = buildUrl(lottery, drawNumber);
  let lastError: unknown;

  logCaixa("loadRawDraw:start", { lottery: lottery.slug, apiSlug: lottery.apiSlug, drawNumber, url });

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    logCaixa("loadRawDraw:attempt-start", {
      lottery: lottery.slug,
      drawNumber,
      attempt,
      maxAttempts: REQUEST_ATTEMPTS,
    });

    try {
      const response = await fetchWithTimeout(url);

      if (response.status === 404) {
        logCaixa("loadRawDraw:not-found", {
          lottery: lottery.slug,
          drawNumber,
          attempt,
          elapsedMs: elapsedMs(attemptStartedAt),
          totalElapsedMs: elapsedMs(startedAt),
        });
        return null;
      }

      if (!response.ok) {
        throw new CaixaApiError(`Caixa API returned HTTP ${response.status}`, response.status);
      }

      const data = (await response.json()) as CaixaLotteryResponse;
      logCaixa("loadRawDraw:attempt-success", {
        lottery: lottery.slug,
        drawNumber,
        attempt,
        responseDrawNumber: data.numero ?? null,
        previousDrawNumber: data.numeroConcursoAnterior ?? null,
        nextDrawNumber: data.numeroConcursoProximo ?? null,
        elapsedMs: elapsedMs(attemptStartedAt),
        totalElapsedMs: elapsedMs(startedAt),
      });
      return data;
    } catch (error) {
      lastError = error;
      warnCaixa("loadRawDraw:attempt-error", {
        lottery: lottery.slug,
        drawNumber,
        attempt,
        elapsedMs: elapsedMs(attemptStartedAt),
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      });
    }
  }

  warnCaixa("loadRawDraw:failed-all-attempts", {
    lottery: lottery.slug,
    drawNumber,
    attempts: REQUEST_ATTEMPTS,
    elapsedMs: elapsedMs(startedAt),
  });

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new CaixaApiError("Unable to load Caixa API response");
}

export async function fetchDrawFromCaixa(lotterySlug: string, drawNumber: number): Promise<Draw | null> {
  const startedAt = Date.now();
  logCaixa("fetchDrawFromCaixa:start", { lotterySlug, drawNumber });

  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    warnCaixa("fetchDrawFromCaixa:unknown-lottery", { lotterySlug, drawNumber, elapsedMs: elapsedMs(startedAt) });
    throw new CaixaApiError(`Unknown lottery: ${lotterySlug}`);
  }

  const raw = await loadRawDraw(lottery, drawNumber);

  if (!raw) {
    logCaixa("fetchDrawFromCaixa:no-raw-result", {
      lottery: lottery.slug,
      drawNumber,
      elapsedMs: elapsedMs(startedAt),
    });
    return null;
  }

  const numberGroups = extractNumberGroups(lottery, raw);
  const numbers = numberGroups.flat();

  if (!numbers.length) {
    warnCaixa("fetchDrawFromCaixa:no-numbers", {
      lottery: lottery.slug,
      drawNumber,
      rawDrawNumber: raw.numero ?? null,
      elapsedMs: elapsedMs(startedAt),
    });
    return null;
  }

  logCaixa("fetchDrawFromCaixa:done", {
    lottery: lottery.slug,
    requestedDrawNumber: drawNumber,
    responseDrawNumber: raw.numero ?? null,
    numbers: numbers.length,
    groups: numberGroups.length,
    previousDrawNumber: raw.numeroConcursoAnterior ?? null,
    nextDrawNumber: raw.numeroConcursoProximo ?? null,
    elapsedMs: elapsedMs(startedAt),
  });

  return {
    lottery: lottery.slug,
    drawNumber: raw.numero ?? drawNumber,
    date: raw.dataApuracao ?? "",
    numbers,
    numberGroups,
    previousDrawNumber: raw.numeroConcursoAnterior ?? null,
    nextDrawNumber: raw.numeroConcursoProximo ?? null,
    raw,
  };
}
