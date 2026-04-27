"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LOTTERIES, getLottery, type LotteryDefinition } from "@/data/lotteries";
import type { Draw } from "@/lib/types";

type CollectionPayload = {
  draws: Draw[];
  hasMore: boolean;
  nextDrawNumber: number | null;
};

type CaixaSyncPayload = {
  draws: Draw[];
  savedDraws: Draw[];
  attemptedDrawNumbers: number[];
  skippedDrawNumbers: number[];
  currentDrawNumber: number | null;
  nextDrawNumber: number | null;
  hasMore: boolean;
  totalStoredDraws: number;
  newestDrawNumber: number | null;
  oldestDrawNumber: number | null;
  consecutiveMisses: number;
  batchSize: number;
  stopReason: string;
  error?: string;
};

type SyncInfo = {
  running: boolean;
  stopRequested: boolean;
  message: string;
  currentDrawNumber: number | null;
  nextDrawNumber: number | null;
  totalStoredDraws: number;
  savedInBatch: number;
  attemptedInBatch: number;
  skippedInBatch: number;
  stopReason: string | null;
};

type LotteryApiPayload = {
  lottery: string;
  collection?: CollectionPayload | null;
  draws?: Draw[];
  draw?: Draw | null;
  text?: string;
  sync?: CaixaSyncPayload;
  error?: string;
};

type LoadedLotteryData = {
  draws: Draw[];
  selectedDraw: Draw | null;
  rawText: string;
  statusMessage: string;
};

type FetchMode = "database" | "caixa";
type AnalysisPeriod = 10 | 25 | 50 | 100 | "all";
type AnalysisView = "most" | "least" | "delayed" | "map";
type DuplaSenaAnalysisScope = "all" | "first" | "second";

type NumberTrend = {
  number: string;
  value: number;
  hits: number;
  overdue: number;
  lastDrawNumber: number | null;
  intensity: number;
};

type NumberTrendGroup = {
  hits: number;
  items: NumberTrend[];
  visibleItems: NumberTrend[];
  hiddenCount: number;
};

type AnalysisData = {
  selectedDraws: Draw[];
  stats: NumberTrend[];
  most: NumberTrend[];
  least: NumberTrend[];
  delayed: NumberTrend[];
  maxHits: number;
  drawCount: number;
  periodLabel: string;
  scopeLabel: string;
};

const ANALYSIS_PERIOD_OPTIONS: Array<{ value: AnalysisPeriod; label: string }> = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "all", label: "Todos" },
];

const ANALYSIS_VIEW_OPTIONS: Array<{ value: AnalysisView; label: string }> = [
  { value: "most", label: "Mais sorteados" },
  { value: "least", label: "Menos sorteados" },
  { value: "delayed", label: "Atrasados" },
  { value: "map", label: "Mapa" },
];

const DUPLA_SENA_SCOPE_OPTIONS: Array<{ value: DuplaSenaAnalysisScope; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "first", label: "1º sorteio" },
  { value: "second", label: "2º sorteio" },
];

const LEAST_GROUP_LIMIT = 4;
const LEAST_GROUP_VISIBLE_NUMBERS = 24;

const loadedDataCache = new Map<string, LoadedLotteryData>();
const pendingDataRequests = new Map<string, Promise<LoadedLotteryData>>();
const CAIXA_SYNC_BATCH_SIZE = 1;

const INITIAL_SYNC_INFO: SyncInfo = {
  running: false,
  stopRequested: false,
  message: "",
  currentDrawNumber: null,
  nextDrawNumber: 1,
  totalStoredDraws: 0,
  savedInBatch: 0,
  attemptedInBatch: 0,
  skippedInBatch: 0,
  stopReason: null,
};

type LoadState = "idle" | "loading" | "syncing" | "loaded" | "error";

type HomePageProps = {
  initialLotterySlug?: string;
  initialDrawNumber?: string;
};

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatStatusDate(draw: Draw | null): string {
  return draw?.date || "Sem data";
}

function getDisplayGroups(draw: Draw): string[][] {
  const groups = draw.numberGroups?.filter((group) => group.length > 0) ?? [];
  return groups.length ? groups : [draw.numbers];
}

function formatDrawNumbers(draw: Draw): string {
  return getDisplayGroups(draw)
    .map((group, index, groups) => (groups.length > 1 ? `${index + 1}º: ${group.join(" · ")}` : group.join(" · ")))
    .join("  |  ");
}

function updateLegacyUrl(lotterySlug?: string, drawNumber?: string): void {
  const path = lotterySlug ? `/?${lotterySlug}${drawNumber ? `/${drawNumber}` : ""}` : "/";
  window.history.pushState(null, "", path);
}

function getInitialLottery(slug?: string): LotteryDefinition | null {
  if (!slug) {
    return null;
  }

  return getLottery(slug);
}

function getDataCacheKey(lotterySlug: string, drawNumber: string): string {
  return drawNumber ? `${lotterySlug}:draw:${drawNumber}` : `${lotterySlug}:history`;
}

function upsertLoadedDrawInCache(lotterySlug: string, loadedDraw: Draw): void {
  const historyCacheKey = getDataCacheKey(lotterySlug, "");
  const historyData = loadedDataCache.get(historyCacheKey);

  if (!historyData) {
    return;
  }

  const existingIndex = historyData.draws.findIndex((draw) => draw.drawNumber === loadedDraw.drawNumber);
  const nextDraws = existingIndex >= 0 ? [...historyData.draws] : [loadedDraw, ...historyData.draws];

  if (existingIndex >= 0) {
    nextDraws[existingIndex] = loadedDraw;
  }

  nextDraws.sort((left, right) => right.drawNumber - left.drawNumber);
  loadedDataCache.set(historyCacheKey, {
    ...historyData,
    draws: nextDraws,
    selectedDraw: nextDraws[0] ?? loadedDraw,
    statusMessage: `Histórico com ${nextDraws.length} concursos.`,
  });
}

function buildLegacyUrl(lotterySlug: string, drawNumber: string): string {
  const params = new URLSearchParams({ format: "legacy" });

  if (drawNumber) {
    params.set("draw", drawNumber);
  }

  return `/api/lotteries/${lotterySlug}?${params.toString()}`;
}

function getHistoryStatusMessage(draws: Draw[]): string {
  return draws.length ? `${draws.length} concursos encontrados.` : "Nenhum resultado encontrado.";
}

function cacheHistoryData(lotterySlug: string, draws: Draw[], rawText: string, statusMessage = getHistoryStatusMessage(draws)): LoadedLotteryData {
  const loadedData: LoadedLotteryData = {
    draws,
    selectedDraw: draws[0] ?? null,
    rawText,
    statusMessage,
  };

  loadedDataCache.set(getDataCacheKey(lotterySlug, ""), loadedData);
  return loadedData;
}

function formatSyncStopReason(reason: string | null): string {
  switch (reason) {
    case "batch_completed":
      return "Lote concluído";
    case "not_found_limit":
      return "Fim provável";
    case "api_returned_previous_draw":
      return "Último concurso alcançado";
    case "api_returned_different_draw":
      return "Resposta inesperada";
    case "error":
      return "Erro";
    default:
      return "Aguardando";
  }
}

function getAnalysisViewLabel(view: AnalysisView): string {
  return ANALYSIS_VIEW_OPTIONS.find((option) => option.value === view)?.label ?? "Análise";
}

function formatHitsLabel(hitCount: number): string {
  return `${hitCount} ${hitCount === 1 ? "vez" : "vezes"}`;
}

function formatNumberCount(count: number): string {
  return `${count} ${count === 1 ? "número" : "números"}`;
}

function getAnalysisFilterText(data: AnalysisData): string {
  const periodText = data.periodLabel.toLowerCase();

  if (data.scopeLabel === "Todos os sorteios") {
    return periodText;
  }

  return `${periodText} no ${data.scopeLabel.toLowerCase()}`;
}

function getAnalysisDescription(view: AnalysisView, data: AnalysisData): string {
  const filterText = getAnalysisFilterText(data);

  switch (view) {
    case "least":
      return `Considerando ${filterText}, agrupa os números pela menor quantidade de aparições.`;
    case "delayed":
      return `Considerando ${filterText}, mostra há quantos concursos cada número não aparece.`;
    case "map":
      return `Considerando ${filterText}, cores mais fortes indicam números que apareceram mais.`;
    default:
      return `Considerando ${filterText}, destaca os números que mais apareceram.`;
  }
}

function getAnalysisPeriodLabel(period: AnalysisPeriod, drawCount: number): string {
  if (period === "all") {
    return `${drawCount} concursos`;
  }

  return `Últimos ${Math.min(period, drawCount)} concursos`;
}

function getAnalysisScopeLabel(scope: DuplaSenaAnalysisScope): string {
  switch (scope) {
    case "first":
      return "1º sorteio";
    case "second":
      return "2º sorteio";
    default:
      return "Todos os sorteios";
  }
}

function getNumbersForAnalysis(draw: Draw, scope: DuplaSenaAnalysisScope): string[] {
  const groups = getDisplayGroups(draw);

  if (scope === "first") {
    return groups[0] ?? [];
  }

  if (scope === "second") {
    return groups[1] ?? [];
  }

  return groups.flat();
}

function buildNumberRange(lottery: LotteryDefinition): string[] {
  if (lottery.slug === "LotoMania") {
    return Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));
  }

  return Array.from({ length: lottery.countNumbers }, (_, index) => String(index + 1).padStart(2, "0"));
}

function buildLeastTrendGroups(stats: NumberTrend[]): NumberTrendGroup[] {
  const byHits = new Map<number, NumberTrend[]>();

  for (const item of stats) {
    byHits.set(item.hits, [...(byHits.get(item.hits) ?? []), item]);
  }

  return Array.from(byHits.entries())
    .sort(([leftHits], [rightHits]) => leftHits - rightHits)
    .slice(0, LEAST_GROUP_LIMIT)
    .map(([hits, items]) => {
      const sortedItems = [...items].sort((left, right) => left.value - right.value);

      return {
        hits,
        items: sortedItems,
        visibleItems: sortedItems.slice(0, LEAST_GROUP_VISIBLE_NUMBERS),
        hiddenCount: Math.max(0, sortedItems.length - LEAST_GROUP_VISIBLE_NUMBERS),
      };
    });
}

function buildAnalysisData(
  draws: Draw[],
  lottery: LotteryDefinition | null,
  period: AnalysisPeriod,
  scope: DuplaSenaAnalysisScope,
): AnalysisData | null {
  if (!lottery || !draws.length) {
    return null;
  }

  const selectedDraws = (period === "all" ? draws : draws.slice(0, period)).filter((draw) => getNumbersForAnalysis(draw, scope).length > 0);

  if (!selectedDraws.length) {
    return null;
  }

  const hits = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  const overdueByNumber = new Map<string, number>();

  selectedDraws.forEach((draw, drawIndex) => {
    const uniqueNumbers = new Set(getNumbersForAnalysis(draw, scope));

    for (const number of uniqueNumbers) {
      hits.set(number, (hits.get(number) ?? 0) + 1);

      if (!lastSeen.has(number)) {
        lastSeen.set(number, draw.drawNumber);
        overdueByNumber.set(number, drawIndex);
      }
    }
  });

  const numbers = buildNumberRange(lottery);
  const maxHits = Math.max(...numbers.map((number) => hits.get(number) ?? 0), 0);
  const stats = numbers.map((number) => {
    const numberHits = hits.get(number) ?? 0;
    const lastDrawNumber = lastSeen.get(number) ?? null;
    const overdue = overdueByNumber.get(number) ?? selectedDraws.length;

    return {
      number,
      value: Number.parseInt(number, 10),
      hits: numberHits,
      overdue,
      lastDrawNumber,
      intensity: maxHits ? numberHits / maxHits : 0,
    };
  });

  const byNumber = (left: NumberTrend, right: NumberTrend) => left.value - right.value;
  const most = [...stats].sort((left, right) => right.hits - left.hits || byNumber(left, right)).slice(0, 12);
  const least = [...stats].sort((left, right) => left.hits - right.hits || byNumber(left, right)).slice(0, 12);
  const delayed = [...stats].sort((left, right) => right.overdue - left.overdue || left.hits - right.hits || byNumber(left, right)).slice(0, 12);

  return {
    selectedDraws,
    stats,
    most,
    least,
    delayed,
    maxHits,
    drawCount: selectedDraws.length,
    periodLabel: getAnalysisPeriodLabel(period, selectedDraws.length),
    scopeLabel: getAnalysisScopeLabel(scope),
  };
}

async function loadLotteryDataOnce(lotterySlug: string, drawNumber: string): Promise<LoadedLotteryData> {
  const cacheKey = getDataCacheKey(lotterySlug, drawNumber);
  const cachedData = loadedDataCache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  const pendingRequest = pendingDataRequests.get(cacheKey);

  if (pendingRequest) {
    return pendingRequest;
  }

  const endpoint = drawNumber ? `/api/lotteries/${lotterySlug}?draw=${drawNumber}` : `/api/lotteries/${lotterySlug}`;
  const request = fetch(endpoint, { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json()) as LotteryApiPayload;

      if (!response.ok) {
        throw new Error(payload.error || `Falha HTTP ${response.status}`);
      }

      const loadedData: LoadedLotteryData = drawNumber
        ? {
            draws: payload.draw ? [payload.draw] : [],
            selectedDraw: payload.draw ?? null,
            rawText: payload.text ?? "",
            statusMessage: payload.draw ? "Concurso encontrado." : "Concurso não encontrado.",
          }
        : (() => {
            const history = payload.draws ?? payload.collection?.draws ?? [];

            return cacheHistoryData(lotterySlug, history, payload.text ?? "");
          })();

      loadedDataCache.set(cacheKey, loadedData);
      return loadedData;
    })
    .finally(() => {
      pendingDataRequests.delete(cacheKey);
    });

  pendingDataRequests.set(cacheKey, request);
  return request;
}

async function fetchDrawFromCaixaAndStore(lotterySlug: string, drawNumber: string): Promise<LoadedLotteryData> {
  const endpoint = `/api/lotteries/${lotterySlug}`;
  const response = await fetch(endpoint, {
    body: JSON.stringify({ drawNumber }),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as LotteryApiPayload;

  if (!response.ok) {
    throw new Error(payload.error || `Falha HTTP ${response.status}`);
  }

  const loadedData: LoadedLotteryData = {
    draws: payload.draw ? [payload.draw] : [],
    selectedDraw: payload.draw ?? null,
    rawText: payload.text ?? "",
    statusMessage: payload.draw ? "Concurso atualizado." : "Concurso não encontrado.",
  };

  if (payload.draw) {
    loadedDataCache.set(getDataCacheKey(lotterySlug, drawNumber), loadedData);
    upsertLoadedDrawInCache(lotterySlug, payload.draw);
  }

  return loadedData;
}

export function HomePage({ initialLotterySlug, initialDrawNumber }: HomePageProps) {
  const initialLottery = getInitialLottery(initialLotterySlug);
  const [selectedLottery, setSelectedLottery] = useState<LotteryDefinition | null>(initialLottery);
  const [drawNumberInput, setDrawNumberInput] = useState(initialDrawNumber ?? "");
  const [activeDrawNumber, setActiveDrawNumber] = useState(initialDrawNumber ?? "");
  const [draws, setDraws] = useState<Draw[]>([]);
  const [selectedDraw, setSelectedDraw] = useState<Draw | null>(null);
  const [rawText, setRawText] = useState("");
  const [status, setStatus] = useState<LoadState>(initialLottery ? "loading" : "idle");
  const [statusMessage, setStatusMessage] = useState(
    initialLottery ? "Carregando resultados..." : "Escolha uma loteria.",
  );
  const [fetchMode, setFetchMode] = useState<FetchMode>("database");
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>(25);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("most");
  const [duplaSenaAnalysisScope, setDuplaSenaAnalysisScope] = useState<DuplaSenaAnalysisScope>("all");
  const [syncInfo, setSyncInfo] = useState<SyncInfo>(INITIAL_SYNC_INFO);
  const [error, setError] = useState<string | null>(null);
  const syncStopRef = useRef(false);
  const syncSessionRef = useRef(0);

  const isSyncing = syncInfo.running;
  const latestDraw = draws[0] ?? selectedDraw;
  const numberCount = latestDraw?.numbers.length ?? selectedLottery?.numbersPerDraw ?? 0;
  const drawCount = draws.length || (selectedDraw ? 1 : 0);
  const caixaDrawNumber = drawNumberInput.trim() || activeDrawNumber.trim();
  const canFetchFromCaixa = Boolean(selectedLottery && caixaDrawNumber && status !== "loading" && !isSyncing);
  const canSyncFromCaixa = Boolean(selectedLottery && status !== "loading" && (isSyncing || !activeDrawNumber.trim()));

  const visibleDraws = useMemo(() => draws.slice(0, 20), [draws]);
  const analysisData = useMemo(
    () => buildAnalysisData(draws, selectedLottery, analysisPeriod, selectedLottery?.slug === "DuplaSena" ? duplaSenaAnalysisScope : "all"),
    [analysisPeriod, draws, duplaSenaAnalysisScope, selectedLottery],
  );
  const legacyHref = useMemo(() => {
    if (!selectedLottery) {
      return "#";
    }

    return buildLegacyUrl(selectedLottery.slug, activeDrawNumber.trim());
  }, [selectedLottery, activeDrawNumber]);

  useEffect(() => {
    if (!selectedLottery || syncInfo.running) {
      return;
    }

    let ignoreResult = false;
    const lottery = selectedLottery;
    const requestedDrawNumber = activeDrawNumber.trim();

    async function loadSelectedLotteryData() {
      if (requestedDrawNumber) {
        const numericDrawNumber = Number.parseInt(requestedDrawNumber, 10);

        if (!Number.isFinite(numericDrawNumber) || numericDrawNumber < 1) {
          setStatus("error");
          setError("Informe um número de concurso válido.");
          setStatusMessage("Não foi possível consultar esse concurso.");
          return;
        }
      }

      const shouldFetchFromCaixa = fetchMode === "caixa";
      const cacheKey = getDataCacheKey(lottery.slug, requestedDrawNumber);
      const alreadyLoaded = shouldFetchFromCaixa ? null : loadedDataCache.get(cacheKey);

      if (!alreadyLoaded) {
        setStatus("loading");
        setError(null);
        setStatusMessage(
          shouldFetchFromCaixa
            ? `Atualizando concurso ${requestedDrawNumber}...`
            : requestedDrawNumber
              ? `Consultando concurso ${requestedDrawNumber}...`
              : "Carregando resultados...",
        );
      }

      try {
        const loadedData = shouldFetchFromCaixa
          ? await fetchDrawFromCaixaAndStore(lottery.slug, requestedDrawNumber)
          : await loadLotteryDataOnce(lottery.slug, requestedDrawNumber);

        if (ignoreResult) {
          return;
        }

        setDraws(loadedData.draws);
        setSelectedDraw(loadedData.selectedDraw);
        setRawText(loadedData.rawText);
        setStatus("loaded");
        setStatusMessage(loadedData.statusMessage);
      } catch (loadError) {
        if (ignoreResult) {
          return;
        }

        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Erro desconhecido ao carregar dados.");
        setStatusMessage("Não foi possível carregar os dados agora.");
      } finally {
        if (!ignoreResult && shouldFetchFromCaixa) {
          setFetchMode("database");
        }
      }
    }

    void loadSelectedLotteryData();

    return () => {
      ignoreResult = true;
    };
  }, [selectedLottery, activeDrawNumber, fetchMode, syncInfo.running]);

  function selectLottery(lottery: LotteryDefinition) {
    syncStopRef.current = true;
    syncSessionRef.current += 1;
    setSelectedLottery(lottery);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setRawText("");
    setDraws([]);
    setSelectedDraw(null);
    setError(null);
    setStatus("loading");
    setStatusMessage("Preparando...");
    setFetchMode("database");
    setSyncInfo(INITIAL_SYNC_INFO);
    updateLegacyUrl(lottery.slug);
  }

  function submitDrawLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLottery) {
      return;
    }

    const trimmed = drawNumberInput.trim();
    setFetchMode("database");
    setActiveDrawNumber(trimmed);
    updateLegacyUrl(selectedLottery.slug, trimmed || undefined);
  }

  function fetchActiveDrawFromCaixa() {
    if (!selectedLottery || status === "loading" || isSyncing) {
      return;
    }

    const drawNumberToFetch = drawNumberInput.trim() || activeDrawNumber.trim();
    const numericDrawNumber = Number.parseInt(drawNumberToFetch, 10);

    if (!Number.isFinite(numericDrawNumber) || numericDrawNumber < 1) {
      setStatus("error");
      setError("Informe um número de concurso válido.");
      setStatusMessage("Verifique o número do concurso.");
      return;
    }

    setDrawNumberInput(drawNumberToFetch);
    setActiveDrawNumber(drawNumberToFetch);
    setError(null);
    setFetchMode("caixa");
    updateLegacyUrl(selectedLottery.slug, drawNumberToFetch);
  }

  function requestStopSyncFromCaixa() {
    syncStopRef.current = true;
    setSyncInfo((current) => ({
      ...current,
      stopRequested: true,
      message: "Pausando...",
    }));
  }

  async function runSyncBatch(lottery: LotteryDefinition, sessionId: number, startAt?: number): Promise<CaixaSyncPayload> {
    const response = await fetch(`/api/lotteries/${lottery.slug}`, {
      body: JSON.stringify({ action: "sync-caixa", batchSize: CAIXA_SYNC_BATCH_SIZE, startAt }),
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as LotteryApiPayload;

    if (!response.ok || !payload.sync) {
      throw new Error(payload.error || `Falha HTTP ${response.status}`);
    }

    if (syncSessionRef.current !== sessionId) {
      return payload.sync;
    }

    const history = payload.draws ?? payload.sync.draws ?? [];
    const loadedData = cacheHistoryData(lottery.slug, history, payload.text ?? "", getHistoryStatusMessage(history));
    setDraws(loadedData.draws);
    setSelectedDraw((current) => {
      if (!current) {
        return loadedData.selectedDraw;
      }

      return loadedData.draws.find((draw) => draw.drawNumber === current.drawNumber) ?? loadedData.selectedDraw;
    });
    setRawText(loadedData.rawText);

    setSyncInfo((current) => ({
      ...current,
      currentDrawNumber: payload.sync?.currentDrawNumber ?? null,
      nextDrawNumber: payload.sync?.nextDrawNumber ?? null,
      totalStoredDraws: payload.sync?.totalStoredDraws ?? history.length,
      savedInBatch: payload.sync?.savedDraws.length ?? 0,
      attemptedInBatch: payload.sync?.attemptedDrawNumbers.length ?? 0,
      skippedInBatch: payload.sync?.skippedDrawNumbers.length ?? 0,
      stopReason: payload.sync?.stopReason ?? null,
      message: payload.sync?.totalStoredDraws
        ? `${payload.sync.totalStoredDraws} concursos salvos. Próximo: ${payload.sync.nextDrawNumber ?? "--"}.`
        : "Buscando concursos...",
    }));
    setStatus("syncing");
    setStatusMessage(
      payload.sync.totalStoredDraws
        ? `${payload.sync.totalStoredDraws} concursos salvos.`
        : `Buscando concurso ${payload.sync.currentDrawNumber ?? startAt ?? 1}...`,
    );
    setError(null);

    return payload.sync;
  }

  async function syncBaseFromCaixa() {
    if (!selectedLottery || syncInfo.running) {
      return;
    }

    const lottery = selectedLottery;
    const sessionId = syncSessionRef.current + 1;
    syncSessionRef.current = sessionId;
    syncStopRef.current = false;
    setFetchMode("database");
    setActiveDrawNumber("");
    setDrawNumberInput("");
    updateLegacyUrl(lottery.slug);
    setStatus("syncing");
    setError(null);
    setStatusMessage("Sincronizando...");
    setSyncInfo({
      ...INITIAL_SYNC_INFO,
      running: true,
      message: "Iniciando...",
      totalStoredDraws: drawCount,
    });

    let nextStart: number | undefined = undefined;

    try {
      while (!syncStopRef.current && syncSessionRef.current === sessionId) {
        const sync = await runSyncBatch(lottery, sessionId, nextStart);
        nextStart = sync.nextDrawNumber ?? undefined;

        if (!sync.hasMore || !sync.nextDrawNumber || sync.stopReason !== "batch_completed") {
          break;
        }
      }

      if (syncSessionRef.current !== sessionId) {
        return;
      }

      const stoppedByUser = syncStopRef.current;
      setStatus("loaded");
      setSyncInfo((current) => ({
        ...current,
        running: false,
        stopRequested: false,
        message: stoppedByUser
          ? `Pausado. Próximo: ${current.nextDrawNumber ?? "--"}.`
          : `Sincronização finalizada. ${current.totalStoredDraws || drawCount} concursos salvos.`,
      }));
      setStatusMessage(
        stoppedByUser
          ? "Sincronização pausada."
          : "Resultados atualizados.",
      );
    } catch (syncError) {
      if (syncSessionRef.current !== sessionId) {
        return;
      }

      const message = syncError instanceof Error ? syncError.message : "Erro desconhecido ao sincronizar.";
      const hasVisibleDraws = loadedDataCache.get(getDataCacheKey(lottery.slug, ""))?.draws.length || draws.length;
      setStatus(hasVisibleDraws ? "loaded" : "error");
      setError(message);
      setStatusMessage(hasVisibleDraws ? "Sincronização interrompida." : "Falha ao iniciar a sincronização.");
      setSyncInfo((current) => ({
        ...current,
        running: false,
        stopRequested: false,
        stopReason: "error",
        message,
      }));
    } finally {
      syncStopRef.current = false;
    }
  }

  return (
    <div className="dashboard">
      <section className="hero-card">
        <div>
          <span className="eyebrow">Luckygames</span>
          <h1>Resultados das Loterias da Caixa, grátis e fácil.</h1>
          <p className="hero-copy">
            Consulte sorteios e estatísticas simples. Os números vêm da fonte pública das Loterias da Caixa; o Luckygames apenas facilita a consulta.
          </p>
          <div className="donation-callout">
            <strong>Ganhou ou o serviço ajudou?</strong>
            <span>
              Apoie com um donativo por <a href="mailto:contato@luckygames.tips">contato@luckygames.tips</a> ou cartão em{" "}
              <a href="https://idontneedit.org" rel="noreferrer" target="_blank">
                idontneedit.org
              </a>
              .
            </span>
          </div>
        </div>
      </section>

      <section className="lottery-grid" aria-label="Loterias disponíveis">
        {LOTTERIES.map((lottery) => {
          const active = selectedLottery?.slug === lottery.slug;

          return (
            <button
              className={`lottery-card ${active ? "active" : ""}`}
              key={lottery.slug}
              onClick={() => selectLottery(lottery)}
              type="button"
            >
              <span>{formatLotteryName(lottery.slug)}</span>
              <strong>{lottery.numbersPerDraw}</strong>
              <small>números</small>
            </button>
          );
        })}
      </section>

      <section className="content-layout">
        <aside className="control-panel">
          <div className="panel-heading">
            <span className="eyebrow">Jogo</span>
            <h2>{selectedLottery ? formatLotteryName(selectedLottery.slug) : "Selecione uma loteria"}</h2>
          </div>

          <form className="lookup-form" onSubmit={submitDrawLookup}>
            <label htmlFor="draw-number">Número do concurso</label>
            <div className="lookup-row">
              <input
                disabled={!selectedLottery}
                id="draw-number"
                inputMode="numeric"
                onChange={(event) => setDrawNumberInput(event.target.value)}
                placeholder="Ex: 3000"
                type="text"
                value={drawNumberInput}
              />
              <button disabled={!selectedLottery || status === "loading" || isSyncing} type="submit">
                Consultar
              </button>
            </div>
            <div className="lookup-actions">
              <button className="secondary-button" disabled={!canFetchFromCaixa} onClick={fetchActiveDrawFromCaixa} type="button">
                Atualizar resultado
              </button>
            </div>
          </form>

          <div className={`sync-panel ${syncInfo.running ? "running" : ""}`}>
            <div className="sync-panel-header">
              <div>
                <span className="eyebrow">Sincronização</span>
                <strong>Resultados</strong>
              </div>
              <button
                className="sync-button"
                disabled={!canSyncFromCaixa || syncInfo.stopRequested}
                onClick={syncInfo.running ? requestStopSyncFromCaixa : syncBaseFromCaixa}
                type="button"
              >
                {syncInfo.running ? (syncInfo.stopRequested ? "Pausando..." : "Pausar") : "Sincronizar"}
              </button>
            </div>
            <div className="sync-progress-grid">
              <div>
                <span>Concurso</span>
                <strong>{syncInfo.currentDrawNumber ?? "--"}</strong>
              </div>
              <div>
                <span>Próximo</span>
                <strong>{syncInfo.nextDrawNumber ?? "--"}</strong>
              </div>
              <div>
                <span>Salvos</span>
                <strong>{syncInfo.totalStoredDraws || drawCount}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{formatSyncStopReason(syncInfo.stopReason)}</strong>
              </div>
            </div>
            {syncInfo.message ? <p>{syncInfo.message}</p> : null}
          </div>

          <div className="metric-list">
            <div>
              <span>Concursos</span>
              <strong>{drawCount}</strong>
            </div>
            <div>
              <span>Último</span>
              <strong>{latestDraw?.drawNumber ?? "--"}</strong>
            </div>
            <div>
              <span>Data</span>
              <strong>{formatStatusDate(latestDraw)}</strong>
            </div>
            <div>
              <span>Números</span>
              <strong>{numberCount || "--"}</strong>
            </div>
          </div>
        </aside>

        <section className="results-panel">
          <div className="results-header">
            <div>
              <span className="eyebrow">Resultados</span>
              <h2>
                {selectedLottery
                  ? activeDrawNumber
                    ? `Concurso ${activeDrawNumber}`
                    : `Histórico de ${formatLotteryName(selectedLottery.slug)}`
                  : "Aguardando seleção"}
              </h2>
            </div>
            {statusMessage ? <div className={`status-badge ${status}`}>{statusMessage}</div> : null}
          </div>

          {status === "loading" ? <LoadingState /> : null}
          {status === "error" ? <ErrorState message={error ?? "Erro ao carregar."} /> : null}
          {status !== "loading" && status !== "error" && !selectedLottery ? <EmptyState /> : null}
          {status !== "loading" && status !== "error" && selectedLottery && draws.length === 0 ? (
            <NoResultsState isSyncing={isSyncing} onStartSync={syncBaseFromCaixa} />
          ) : null}
          {status !== "loading" && status !== "error" && draws.length > 0 ? (
            <>
              {rawText ? (
                <details className="raw-output raw-output-top">
                  <summary>Visão crua dos resultados</summary>
                  <div className="raw-output-actions">
                    <span>Texto simples gerado a partir dos resultados salvos.</span>
                    <a className="legacy-link" href={legacyHref} rel="noreferrer" target="_blank">
                      Abrir em nova aba
                    </a>
                  </div>
                  <pre>{rawText}</pre>
                </details>
              ) : null}
              <DrawSpotlight draw={selectedDraw ?? draws[0]} />
              <AnalysisPanel
                activeView={analysisView}
                data={analysisData}
                isDuplaSena={selectedLottery?.slug === "DuplaSena"}
                onPeriodChange={setAnalysisPeriod}
                onScopeChange={setDuplaSenaAnalysisScope}
                onViewChange={setAnalysisView}
                period={analysisPeriod}
                scope={duplaSenaAnalysisScope}
              />
              <DrawList draws={visibleDraws} onSelect={setSelectedDraw} selectedDrawNumber={selectedDraw?.drawNumber ?? null} />
            </>
          ) : null}
        </section>
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status">
      <div className="loader-ring" />
      <div>
        <strong>Carregando resultados</strong>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <strong>Escolha uma loteria</strong>
      <p>Selecione um jogo para ver os concursos.</p>
    </div>
  );
}

function NoResultsState({ isSyncing, onStartSync }: { isSyncing: boolean; onStartSync: () => void }) {
  return (
    <div className="empty-state">
      <strong>{isSyncing ? "Carregando concursos" : "Nenhum resultado salvo"}</strong>
      <p>{isSyncing ? "Os resultados aparecerão aqui conforme forem salvos." : "Sincronize para carregar os resultados."}</p>
      {!isSyncing ? (
        <button className="empty-action" onClick={onStartSync} type="button">
          Sincronizar agora
        </button>
      ) : null}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state">
      <strong>Falha ao carregar</strong>
      <p>{message}</p>
    </div>
  );
}

function AnalysisPanel({
  activeView,
  data,
  isDuplaSena,
  onPeriodChange,
  onScopeChange,
  onViewChange,
  period,
  scope,
}: {
  activeView: AnalysisView;
  data: AnalysisData | null;
  isDuplaSena: boolean;
  onPeriodChange: (period: AnalysisPeriod) => void;
  onScopeChange: (scope: DuplaSenaAnalysisScope) => void;
  onViewChange: (view: AnalysisView) => void;
  period: AnalysisPeriod;
  scope: DuplaSenaAnalysisScope;
}) {
  return (
    <details className="analysis-panel" open>
      <summary className="analysis-summary">
        <div>
          <span className="eyebrow">Análise rápida</span>
          <strong>{data ? getAnalysisDescription(activeView, data) : "Carregue resultados para ver a análise."}</strong>
        </div>
        <span className="analysis-summary-chip">{data ? `${getAnalysisViewLabel(activeView)} · ${data.periodLabel}` : "Abrir"}</span>
      </summary>

      <div className="analysis-body" aria-label="Análise rápida dos resultados">
        {data ? (
          <div className="analysis-current-filter">
            <span>{getAnalysisViewLabel(activeView)}</span>
            <strong>{data.scopeLabel === "Todos os sorteios" ? data.periodLabel : `${data.periodLabel} · ${data.scopeLabel}`}</strong>
          </div>
        ) : null}

        <details className="analysis-options">
          <summary>
            <span>Ajustar análise</span>
            <strong>{getAnalysisViewLabel(activeView)}</strong>
          </summary>

          <div className="analysis-controls" aria-label="Filtros da análise">
            <div className="control-group">
              <span>Período</span>
              <div className="segmented-control compact" aria-label="Período analisado">
                {ANALYSIS_PERIOD_OPTIONS.map((option) => (
                  <button
                    className={period === option.value ? "active" : ""}
                    key={String(option.value)}
                    onClick={() => onPeriodChange(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {isDuplaSena ? (
              <div className="control-group">
                <span>Sorteio</span>
                <div className="segmented-control compact" aria-label="Sorteio da Dupla Sena">
                  {DUPLA_SENA_SCOPE_OPTIONS.map((option) => (
                    <button
                      className={scope === option.value ? "active" : ""}
                      key={option.value}
                      onClick={() => onScopeChange(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="control-group">
              <span>Ver</span>
              <div className="segmented-control view-selector" aria-label="Tipo de análise">
                {ANALYSIS_VIEW_OPTIONS.map((option) => (
                  <button
                    className={activeView === option.value ? "active" : ""}
                    key={option.value}
                    onClick={() => onViewChange(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>

        {data ? <AnalysisContent data={data} view={activeView} /> : <div className="analysis-empty">Carregue resultados para ver a análise.</div>}
      </div>
    </details>
  );
}

function AnalysisContent({ data, view }: { data: AnalysisData; view: AnalysisView }) {
  if (view === "map") {
    return <NumberHeatMap stats={data.stats} />;
  }

  if (view === "least") {
    return <LeastTrendGroups groups={buildLeastTrendGroups(data.stats)} />;
  }

  const items = view === "most" ? data.most : data.delayed;
  const label = view === "delayed" ? "concursos sem sair" : "vezes";
  const getValue = (item: NumberTrend) => (view === "delayed" ? item.overdue : item.hits);

  return (
    <div className="trend-list">
      {items.map((item) => (
        <div className="trend-row" key={`${view}-${item.number}`}>
          <span className="trend-number">{item.number}</span>
          <div>
            <strong>
              {getValue(item)} {label}
            </strong>
            <div className="trend-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(8, item.intensity * 100)}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeastTrendGroups({ groups }: { groups: NumberTrendGroup[] }) {
  return (
    <div className="least-groups">
      {groups.map((group) => (
        <article className="least-group" key={`least-${group.hits}`}>
          <div className="least-group-header">
            <strong>{formatHitsLabel(group.hits)}</strong>
            <span>{formatNumberCount(group.items.length)}</span>
          </div>
          <div className="least-number-cloud">
            {group.visibleItems.map((item) => (
              <span key={`least-${group.hits}-${item.number}`}>{item.number}</span>
            ))}
            {group.hiddenCount ? <small>+{group.hiddenCount}</small> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function NumberHeatMap({ stats }: { stats: NumberTrend[] }) {
  return (
    <div className="number-heat-map">
      {stats.map((item) => (
        <div
          className="heat-number"
          key={`map-${item.number}`}
          style={{
            backgroundColor: `rgba(56, 189, 248, ${0.08 + item.intensity * 0.5})`,
            borderColor: item.hits ? `rgba(125, 211, 252, ${0.25 + item.intensity * 0.5})` : "rgba(148, 163, 184, 0.16)",
          }}
          title={`${item.number}: ${item.hits} vez(es), atraso ${item.overdue}`}
        >
          <strong>{item.number}</strong>
          <small>{item.hits}x</small>
        </div>
      ))}
    </div>
  );
}

function DrawSpotlight({ draw }: { draw: Draw | null | undefined }) {
  if (!draw) {
    return null;
  }

  const groups = getDisplayGroups(draw);

  return (
    <article className="draw-spotlight">
      <div>
        <span className="eyebrow">Concurso {draw.drawNumber}</span>
        <h3>{draw.date || "Data não informada"}</h3>
      </div>
      <div className={`number-cloud ${groups.length > 1 ? "grouped" : ""}`}>
        {groups.map((group, groupIndex) => (
          <div className="number-group" key={`${draw.drawNumber}-group-${groupIndex}`}>
            {groups.length > 1 ? <small>{groupIndex + 1}º sorteio</small> : null}
            <div>
              {group.map((number, numberIndex) => (
                <span key={`${draw.drawNumber}-${groupIndex}-${number}-${numberIndex}`}>{number}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function DrawList({
  draws,
  onSelect,
  selectedDrawNumber,
}: {
  draws: Draw[];
  onSelect: (draw: Draw) => void;
  selectedDrawNumber: number | null;
}) {
  return (
    <div className="draw-list">
      {draws.map((draw) => (
        <button
          className={`draw-row ${selectedDrawNumber === draw.drawNumber ? "active" : ""}`}
          key={`${draw.lottery}-${draw.drawNumber}`}
          onClick={() => onSelect(draw)}
          type="button"
        >
          <span>#{draw.drawNumber}</span>
          <strong>{formatDrawNumbers(draw)}</strong>
          <small>{draw.date}</small>
        </button>
      ))}
    </div>
  );
}
