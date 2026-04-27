import { getLottery, type LotteryDefinition } from "@/data/lotteries";
import { normalizeNumbers } from "@/lib/format";
import type { CaixaLotteryResponse, Draw } from "@/lib/types";

const CAIXA_BASE_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api";
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_ATTEMPTS = 3;

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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://www.google.com/",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.89 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRawDraw(lottery: LotteryDefinition, drawNumber: number): Promise<CaixaLotteryResponse | null> {
  const url = buildUrl(lottery, drawNumber);
  let lastError: unknown;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new CaixaApiError(`Caixa API returned HTTP ${response.status}`, response.status);
      }

      const data = (await response.json()) as CaixaLotteryResponse;
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new CaixaApiError("Unable to load Caixa API response");
}

export async function fetchDrawFromCaixa(lotterySlug: string, drawNumber: number): Promise<Draw | null> {
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    throw new CaixaApiError(`Unknown lottery: ${lotterySlug}`);
  }

  const raw = await loadRawDraw(lottery, drawNumber);

  if (!raw) {
    return null;
  }

  const numbers = normalizeNumbers(raw.dezenasSorteadasOrdemSorteio);

  if (!numbers.length) {
    return null;
  }

  return {
    lottery: lottery.slug,
    drawNumber,
    date: raw.dataApuracao ?? "",
    numbers,
    previousDrawNumber: raw.numeroConcursoAnterior ?? null,
    nextDrawNumber: raw.numeroConcursoProximo ?? null,
    raw,
  };
}
