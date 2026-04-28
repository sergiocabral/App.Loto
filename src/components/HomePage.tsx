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

type LookupMode = "draw" | "numbers";
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
  value: number;
  items: NumberTrend[];
};

type SuggestedGame = {
  key: string;
  numbers: string[];
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


const loadedDataCache = new Map<string, LoadedLotteryData>();
const pendingDataRequests = new Map<string, Promise<LoadedLotteryData>>();
const CAIXA_SYNC_BATCH_SIZE = 1;
const DRAW_LIST_PAGE_SIZE = 50;

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

function parseNumberFilter(input: string, lottery: LotteryDefinition): string[] {
  const minimum = lottery.slug === "LotoMania" ? 0 : 1;
  const maximum = lottery.slug === "LotoMania" ? 99 : lottery.countNumbers;
  const numbers = new Set<string>();

  for (const token of input.split(/[\s,;]+/)) {
    const trimmed = token.trim();

    if (!/^\d+$/.test(trimmed)) {
      continue;
    }

    const value = Number.parseInt(trimmed, 10);

    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      continue;
    }

    numbers.add(String(value).padStart(2, "0"));
  }

  return sortNumbersForDisplay([...numbers]);
}

function drawContainsNumbers(draw: Draw, numbers: string[]): boolean {
  if (!numbers.length) {
    return true;
  }

  const drawNumbers = new Set(getDisplayGroups(draw).flat());
  return numbers.every((number) => drawNumbers.has(number));
}

function buildRawPageUrl(lotterySlug: string, drawNumber: string): string {
  const params = new URLSearchParams();

  if (drawNumber) {
    params.set("draw", drawNumber);
  }

  const query = params.toString();
  return `/raw/${lotterySlug}${query ? `?${query}` : ""}`;
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

function buildTrendGroups(
  stats: NumberTrend[],
  getValue: (item: NumberTrend) => number,
  direction: "asc" | "desc",
): NumberTrendGroup[] {
  const byValue = new Map<number, NumberTrend[]>();

  for (const item of stats) {
    const value = getValue(item);
    byValue.set(value, [...(byValue.get(value) ?? []), item]);
  }

  return Array.from(byValue.entries())
    .sort(([leftValue], [rightValue]) => (direction === "asc" ? leftValue - rightValue : rightValue - leftValue))
    .map(([value, items]) => ({
      value,
      items: [...items].sort((left, right) => left.value - right.value),
    }));
}

function getSuggestionSize(lottery: LotteryDefinition): number {
  return lottery.groups?.[0] ?? lottery.numbersPerDraw;
}

function buildSuggestionKey(lottery: LotteryDefinition, view: AnalysisView, data: AnalysisData): string {
  const fingerprint = data.stats.map((item) => `${item.number}:${item.hits}:${item.overdue}`).join(",");
  return [lottery.slug, view, data.periodLabel, data.scopeLabel, data.drawCount, fingerprint].join("|");
}

function getAnalysisWeight(item: NumberTrend, view: AnalysisView, data: AnalysisData): number {
  const maxHits = Math.max(data.maxHits, 1);
  const maxOverdue = Math.max(...data.stats.map((stat) => stat.overdue), 1);
  const hotScore = item.hits / maxHits;
  const coldScore = 1 - hotScore;
  const overdueScore = item.overdue / maxOverdue;

  switch (view) {
    case "least":
      return coldScore * 0.78 + overdueScore * 0.18 + 0.04;
    case "delayed":
      return overdueScore * 0.78 + coldScore * 0.16 + 0.06;
    case "map":
      return hotScore * 0.46 + overdueScore * 0.34 + coldScore * 0.14 + 0.06;
    default:
      return hotScore * 0.78 + overdueScore * 0.14 + 0.08;
  }
}

function sortNumbersForDisplay(numbers: string[]): string[] {
  return [...numbers].sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
}

function shuffleItems<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}

function buildSuggestionGroups(view: AnalysisView, data: AnalysisData): NumberTrendGroup[] {
  if (view === "most") {
    return buildTrendGroups(data.stats, (item) => item.hits, "desc");
  }

  if (view === "least") {
    return buildTrendGroups(data.stats, (item) => item.hits, "asc");
  }

  if (view === "delayed") {
    return buildTrendGroups(data.stats, (item) => item.overdue, "desc");
  }

  return buildTrendGroups(data.stats, (item) => Math.round(getAnalysisWeight(item, view, data) * 1000), "desc");
}

function buildLuckySuggestion(lottery: LotteryDefinition, view: AnalysisView, data: AnalysisData): string[] {
  const size = Math.min(getSuggestionSize(lottery), data.stats.length);
  const selected: string[] = [];

  for (const group of buildSuggestionGroups(view, data)) {
    if (selected.length >= size) {
      break;
    }

    const availableSlots = size - selected.length;
    const shuffledGroup = shuffleItems(group.items);
    selected.push(...shuffledGroup.slice(0, availableSlots).map((item) => item.number));
  }

  return sortNumbersForDisplay(selected);
}

function formatOverdueLabel(overdue: number): string {
  if (overdue === 0) {
    return "Saiu no último concurso";
  }

  return `${overdue} ${overdue === 1 ? "concurso" : "concursos"} sem sair`;
}

function getSuggestionDescription(view: AnalysisView, data: AnalysisData): string {
  const filterText = getAnalysisFilterText(data);

  switch (view) {
    case "least":
      return `Sugestão embaralhada priorizando números menos frequentes em ${filterText}.`;
    case "delayed":
      return `Sugestão embaralhada priorizando números há mais tempo sem aparecer em ${filterText}.`;
    case "map":
      return `Sugestão embaralhada equilibrando frequência e atraso em ${filterText}.`;
    default:
      return `Sugestão embaralhada priorizando números mais frequentes em ${filterText}.`;
  }
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
  const most = [...stats].sort((left, right) => right.hits - left.hits || byNumber(left, right));
  const least = [...stats].sort((left, right) => left.hits - right.hits || byNumber(left, right));
  const delayed = [...stats].sort((left, right) => right.overdue - left.overdue || left.hits - right.hits || byNumber(left, right));

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
  const [lookupMode, setLookupMode] = useState<LookupMode>("numbers");
  const [numberFilter, setNumberFilter] = useState<string[]>([]);
  const [visibleDrawState, setVisibleDrawState] = useState({ key: "", limit: DRAW_LIST_PAGE_SIZE });
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>(25);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("most");
  const [duplaSenaAnalysisScope, setDuplaSenaAnalysisScope] = useState<DuplaSenaAnalysisScope>("all");
  const [syncInfo, setSyncInfo] = useState<SyncInfo>(INITIAL_SYNC_INFO);
  const [suggestedGame, setSuggestedGame] = useState<SuggestedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncStopRef = useRef(false);
  const syncSessionRef = useRef(0);

  const isSyncing = syncInfo.running;
  const latestDraw = draws[0] ?? selectedDraw;
  const numberCount = latestDraw?.numbers.length ?? selectedLottery?.numbersPerDraw ?? 0;
  const drawCount = draws.length || (selectedDraw ? 1 : 0);
  const canSyncFromCaixa = Boolean(selectedLottery && status !== "loading" && (isSyncing || !activeDrawNumber.trim()));
  const canClearLookupFilter = Boolean(drawNumberInput.trim() || activeDrawNumber.trim() || numberFilter.length);

  const filteredDraws = useMemo(() => draws.filter((draw) => drawContainsNumbers(draw, numberFilter)), [draws, numberFilter]);
  const numberFilterKey = numberFilter.join("|");
  const drawListKey = `${selectedLottery?.slug ?? ""}|${activeDrawNumber}|${numberFilterKey}`;
  const visibleDrawLimit = visibleDrawState.key === drawListKey ? visibleDrawState.limit : DRAW_LIST_PAGE_SIZE;
  const visibleDraws = useMemo(() => filteredDraws.slice(0, visibleDrawLimit), [filteredDraws, visibleDrawLimit]);
  const hasMoreDraws = visibleDrawLimit < filteredDraws.length;
  const analysisData = useMemo(
    () => buildAnalysisData(draws, selectedLottery, analysisPeriod, selectedLottery?.slug === "DuplaSena" ? duplaSenaAnalysisScope : "all"),
    [analysisPeriod, draws, duplaSenaAnalysisScope, selectedLottery],
  );
  const legacyHref = useMemo(() => {
    if (!selectedLottery) {
      return "#";
    }

    return buildRawPageUrl(selectedLottery.slug, activeDrawNumber.trim());
  }, [selectedLottery, activeDrawNumber]);
  const suggestionKey = useMemo(
    () => (selectedLottery && analysisData ? buildSuggestionKey(selectedLottery, analysisView, analysisData) : ""),
    [analysisData, analysisView, selectedLottery],
  );
  const visibleSuggestionNumbers = suggestedGame?.key === suggestionKey ? suggestedGame.numbers : [];

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

      const cacheKey = getDataCacheKey(lottery.slug, requestedDrawNumber);
      const alreadyLoaded = loadedDataCache.get(cacheKey);

      if (!alreadyLoaded) {
        setStatus("loading");
        setError(null);
        setStatusMessage(requestedDrawNumber ? `Consultando concurso ${requestedDrawNumber}...` : "Carregando resultados...");
      }

      try {
        const loadedData = await loadLotteryDataOnce(lottery.slug, requestedDrawNumber);

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
      }
    }

    void loadSelectedLotteryData();

    return () => {
      ignoreResult = true;
    };
  }, [selectedLottery, activeDrawNumber, syncInfo.running]);

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
    setLookupMode("numbers");
    setNumberFilter([]);
    setSyncInfo(INITIAL_SYNC_INFO);
    setSuggestedGame(null);
    updateLegacyUrl(lottery.slug);
  }

  function submitDrawLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedLottery) {
      return;
    }

    const trimmed = drawNumberInput.trim();

    if (lookupMode === "numbers") {
      const parsedNumbers = parseNumberFilter(trimmed, selectedLottery);

      if (!parsedNumbers.length) {
        setNumberFilter([]);
        setSuggestedGame(null);
        setStatusMessage("Informe números válidos para filtrar.");
        return;
      }

      setSuggestedGame(null);
      setNumberFilter(parsedNumbers);
      setSelectedDraw(null);
      setActiveDrawNumber("");
      updateLegacyUrl(selectedLottery.slug);
      setStatusMessage(`Filtro aplicado: ${parsedNumbers.join(", ")}.`);
      return;
    }

    setNumberFilter([]);
    setSuggestedGame(null);
    setActiveDrawNumber(trimmed);
    updateLegacyUrl(selectedLottery.slug, trimmed || undefined);
  }

  function changeLookupMode(mode: LookupMode) {
    setLookupMode(mode);
    setDrawNumberInput("");
    setNumberFilter([]);
    setSuggestedGame(null);

    if (mode === "numbers" && selectedLottery && activeDrawNumber.trim()) {
      setSelectedDraw(null);
      setActiveDrawNumber("");
      updateLegacyUrl(selectedLottery.slug);
    }
  }

  function clearLookupFilter() {
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setNumberFilter([]);
    setSuggestedGame(null);
    setSelectedDraw(draws[0] ?? null);

    if (selectedLottery) {
      updateLegacyUrl(selectedLottery.slug);
      setStatusMessage(getHistoryStatusMessage(draws));
    }
  }

  function loadMoreDraws() {
    setVisibleDrawState((current) => ({
      key: drawListKey,
      limit: (current.key === drawListKey ? current.limit : DRAW_LIST_PAGE_SIZE) + DRAW_LIST_PAGE_SIZE,
    }));
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
    setActiveDrawNumber("");
    setDrawNumberInput("");
    setNumberFilter([]);
    updateLegacyUrl(lottery.slug);
    setStatus("syncing");
    setError(null);
    setStatusMessage("Sincronizando...");
    setSuggestedGame(null);
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

  function changeAnalysisPeriod(period: AnalysisPeriod) {
    setSuggestedGame(null);
    setAnalysisPeriod(period);
  }

  function changeAnalysisView(view: AnalysisView) {
    setSuggestedGame(null);
    setAnalysisView(view);
  }

  function changeDuplaSenaAnalysisScope(scope: DuplaSenaAnalysisScope) {
    setSuggestedGame(null);
    setDuplaSenaAnalysisScope(scope);
  }

  function generateLuckySuggestion() {
    if (!selectedLottery || !analysisData || !suggestionKey) {
      return;
    }

    setSuggestedGame({
      key: suggestionKey,
      numbers: buildLuckySuggestion(selectedLottery, analysisView, analysisData),
    });
  }

  return (
    <>
      <div className="dashboard">
      <section className="hero-card">
        <div>
          <h1>Luckygames</h1>
          <p className="hero-copy">
            Resultados das{" "}
            <a href="https://loterias.caixa.gov.br" rel="noreferrer" target="_blank">
              Loterias da Caixa
            </a>
            , estatísticas simples e sugestões para consultar com calma. O serviço apenas facilita a leitura dos sorteios públicos.
          </p>
          <div className="donation-callout">
            <strong>Ganhou ou o serviço ajudou?</strong>
            <span>
              Apoie com um PIX para <strong className="pix-key">contato@luckygames.tips</strong> ou cartão em{" "}
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
            <div className="lookup-mode-control" aria-label="Tipo de consulta">
              <button className={lookupMode === "numbers" ? "active" : ""} onClick={() => changeLookupMode("numbers")} type="button">
                Números
              </button>
              <button className={lookupMode === "draw" ? "active" : ""} onClick={() => changeLookupMode("draw")} type="button">
                Concurso
              </button>
            </div>
            <label htmlFor="draw-number">{lookupMode === "draw" ? "Número do concurso" : "Números para encontrar"}</label>
            <div className="lookup-row">
              <input
                disabled={!selectedLottery}
                id="draw-number"
                inputMode={lookupMode === "draw" ? "numeric" : "text"}
                onChange={(event) => setDrawNumberInput(event.target.value)}
                placeholder={lookupMode === "draw" ? "Ex: 3000" : "Ex: 05 12 33"}
                type="text"
                value={drawNumberInput}
              />
              <button disabled={!selectedLottery || status === "loading" || isSyncing} type="submit">
                {lookupMode === "draw" ? "Consultar" : "Filtrar"}
              </button>
            </div>
            <div className="lookup-actions">
              <button className="secondary-button" disabled={!canClearLookupFilter} onClick={clearLookupFilter} type="button">
                Limpar filtro
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
                    : numberFilter.length
                      ? `Concursos com ${numberFilter.join(" · ")}`
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
                  <summary>
                    <span>
                      <strong>Visão crua dos resultados</strong>
                      <small>Clique no título para abrir/fechar a prévia</small>
                    </span>
                    <a className="legacy-link" href={legacyHref} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
                      Abrir em nova aba
                    </a>
                  </summary>
                  <div className="raw-output-actions">
                    <span>Visualização em texto para perceber padrões manualmente.</span>
                  </div>
                  <div className="raw-output-pre-wrap">
                    <pre>{rawText}</pre>
                  </div>
                </details>
              ) : null}
              <SuggestionPanel
                activeView={analysisView}
                data={analysisData}
                lottery={selectedLottery}
                numbers={visibleSuggestionNumbers}
                onLucky={generateLuckySuggestion}
              />
              <AnalysisPanel
                activeView={analysisView}
                data={analysisData}
                isDuplaSena={selectedLottery?.slug === "DuplaSena"}
                onPeriodChange={changeAnalysisPeriod}
                onScopeChange={changeDuplaSenaAnalysisScope}
                onViewChange={changeAnalysisView}
                period={analysisPeriod}
                scope={duplaSenaAnalysisScope}
              />
              {numberFilter.length && filteredDraws.length === 0 ? (
                <FilterEmptyState numbers={numberFilter} />
              ) : (
                <DrawList
                  draws={visibleDraws}
                  hasMore={hasMoreDraws}
                  onLoadMore={loadMoreDraws}
                  onSelect={setSelectedDraw}
                  selectedDrawNumber={selectedDraw?.drawNumber ?? null}
                  totalCount={filteredDraws.length}
                  visibleCount={visibleDraws.length}
                />
              )}
            </>
          ) : null}
        </section>
      </section>
    </div>
    <footer className="super-footer" aria-label="Apoie o Luckygames">
      <div className="donation-callout donation-callout-bottom">
        <strong>Serviço gratuito</strong>
        <span>
          Se o Luckygames ajudou, apoie com um PIX para <strong className="pix-key">contato@luckygames.tips</strong> ou cartão em{" "}
          <a href="https://idontneedit.org" rel="noreferrer" target="_blank">
            idontneedit.org
          </a>
          .
        </span>
      </div>
    </footer>
  </>
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

function FilterEmptyState({ numbers }: { numbers: string[] }) {
  return (
    <div className="empty-state compact">
      <strong>Nenhum concurso encontrado</strong>
      <p>Não há resultados carregados contendo todos estes números: {numbers.join(", ")}.</p>
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
    <details className="analysis-panel">
      <summary className="analysis-summary">
        <div>
          <span className="eyebrow">Análise rápida</span>
          <strong>{data ? getAnalysisDescription(activeView, data) : "Carregue resultados para ver a análise."}</strong>
        </div>
      </summary>

      <div className="analysis-body" aria-label="Análise rápida dos resultados">
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
    return (
      <div className="analysis-scroll-area">
        <NumberHeatMap stats={data.stats} />
      </div>
    );
  }

  const groups =
    view === "most"
      ? buildTrendGroups(data.stats, (item) => item.hits, "desc")
      : view === "least"
        ? buildTrendGroups(data.stats, (item) => item.hits, "asc")
        : buildTrendGroups(data.stats, (item) => item.overdue, "desc");

  return <TrendGroups groups={groups} view={view} />;
}

function TrendGroups({ groups, view }: { groups: NumberTrendGroup[]; view: AnalysisView }) {
  return (
    <div className="analysis-scroll-area">
      <div className="trend-groups">
        {groups.map((group) => (
          <article className="trend-group" key={`${view}-${group.value}`}>
            <div className="trend-group-header">
              <strong>{view === "delayed" ? formatOverdueLabel(group.value) : formatHitsLabel(group.value)}</strong>
              <span>{formatNumberCount(group.items.length)}</span>
            </div>
            <div className="trend-number-cloud">
              {group.items.map((item) => (
                <span key={`${view}-${group.value}-${item.number}`}>{item.number}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
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

function SuggestionPanel({
  activeView,
  data,
  lottery,
  numbers,
  onLucky,
}: {
  activeView: AnalysisView;
  data: AnalysisData | null;
  lottery: LotteryDefinition | null;
  numbers: string[];
  onLucky: () => void;
}) {
  if (!lottery || !data) {
    return null;
  }

  return (
    <article className="suggestion-card">
      <div className="suggestion-header">
        <div>
          <span className="eyebrow">Sugestão para jogar</span>
          <h3>{formatLotteryName(lottery.slug)}</h3>
        </div>
        <button className="lucky-button" onClick={onLucky} type="button">
          Estou com sorte
        </button>
      </div>
      <p className="suggestion-copy">{getSuggestionDescription(activeView, data)}</p>
      <div className="suggestion-numbers" aria-label="Sugestão baseada na análise rápida">
        {numbers.length ? numbers.map((number) => <span key={`analysis-suggestion-${number}`}>{number}</span>) : <em>Toque em “Estou com sorte” para gerar uma sugestão.</em>}
      </div>
    </article>
  );
}

function DrawList({
  draws,
  hasMore,
  onLoadMore,
  onSelect,
  selectedDrawNumber,
  totalCount,
  visibleCount,
}: {
  draws: Draw[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (draw: Draw) => void;
  selectedDrawNumber: number | null;
  totalCount: number;
  visibleCount: number;
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
      {hasMore ? (
        <button className="load-more-draws" onClick={onLoadMore} type="button">
          <span>Ver mais resultados</span>
          <small>
            Exibindo {visibleCount} de {totalCount}
          </small>
        </button>
      ) : null}
    </div>
  );
}
