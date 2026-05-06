"use client";

import Image from "next/image";
import Link from "next/link";
import { ResultsChatPanel } from "@/components/ResultsChatPanel";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { LOTTERIES, getLottery, type LotteryDefinition } from "@/data/lotteries";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { createSequentialLoadQueue } from "@/lib/client/sequentialLoadQueue";
import {
  ANALYSIS_PERIOD_OPTIONS,
  ANALYSIS_VIEW_OPTIONS,
  DUPLA_SENA_SCOPE_OPTIONS,
  buildAnalysisData,
  buildLuckySuggestion,
  buildSuggestionKey,
  buildTrendGroups,
  drawContainsNumbers,
  formatHitsLabel,
  formatNumberCount,
  formatOverdueLabel,
  formatRecencyScore,
  getAnalysisDescription,
  getAnalysisViewLabel,
  getDisplayGroups,
  getSuggestionDescription,
  getSuggestionSize,
  getSuggestionVariantKey,
  parseNumberFilter,
  sortNumbersForDisplay,
  type AnalysisData,
  type AnalysisDrawRange,
  type AnalysisPeriod,
  type AnalysisView,
  type DuplaSenaAnalysisScope,
  type NumberTrend,
  type NumberTrendGroup,
  type RecencyScoreMode,
} from "@/lib/analysis";
import type { Draw } from "@/lib/types";

type LookupMode = "numbers" | "draw";

type PublicDraw = Omit<Draw, "raw">;

function asClientDraw(draw: PublicDraw): Draw {
  return { ...draw, raw: {} };
}

function asClientDraws(draws: PublicDraw[]): Draw[] {
  return draws.map(asClientDraw);
}

type CollectionPayload = {
  draws: PublicDraw[];
  hasMore: boolean;
  nextDrawNumber: number | null;
};

type CaixaSyncPayload = {
  draws: PublicDraw[];
  savedDraws: PublicDraw[];
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

type SyncSource = "manual";

type LotteryApiPayload = {
  lottery: string;
  collection?: CollectionPayload | null;
  draws?: PublicDraw[];
  draw?: PublicDraw | null;
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

type SuggestedGame = {
  combinationKey: string;
  filterKey: string;
  lotterySlug: string;
  numbers: string[];
  sourceLabel: string;
  variantIndex: number;
};

type Remark42Theme = "dark" | "light";

type Remark42Config = {
  host: string;
  site_id: string;
  components?: string[];
  theme: Remark42Theme;
  locale?: string;
  no_footer?: boolean;
  page_title?: string;
  url?: string;
};

type Remark42Instance = {
  changeTheme?: (theme: Remark42Theme) => void;
  destroy: () => void;
};

type Remark42Api = {
  changeTheme?: (theme: Remark42Theme) => void;
  createInstance?: (config: Remark42Config) => Remark42Instance;
  destroy?: () => void;
};

type NavigatorConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

type NavigatorWithConnection = Navigator & {
  connection?: NavigatorConnection;
};

declare global {
  interface Window {
    REMARK42?: Remark42Api;
    remark_config?: Remark42Config;
  }
}

const REMARK42_HOST = (process.env.NEXT_PUBLIC_REMARK42_HOST || "https://comments.cabral.dev").replace(/\/+$/, "");
const REMARK42_SITE_ID = process.env.NEXT_PUBLIC_REMARK42_SITE_ID || "global";
const REMARK42_LOCALE = process.env.NEXT_PUBLIC_REMARK42_LOCALE || "bp";
const REMARK42_NO_FOOTER = process.env.NEXT_PUBLIC_REMARK42_NO_FOOTER !== "false";
const REMARK42_ROOT_ID = "remark42";
const REMARK42_SCRIPT_ID = "remark42-embed-script";

const INITIAL_DRAW_LIST_PAGE_SIZE = 25;
const MAX_DRAW_LIST_INCREMENT = 400;
const SAVE_DATA_CONNECTION_TYPES = ["slow-2g", "2g", "3g"] as const;
const loadedDataCache = new Map<string, LoadedLotteryData>();
const pendingDataRequests = new Map<string, Promise<LoadedLotteryData>>();
const historyLoadQueue = createSequentialLoadQueue<LoadedLotteryData>((lotterySlug) => loadLotteryDataOnce(lotterySlug, ""));
const CAIXA_SYNC_BATCH_SIZE = 1;
const NUMBER_GROUP_LONG_PRESS_MS = 1000;

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

function createNumberGroupLongPressHandlers(onLongPress: () => void) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function clearLongPressTimer() {
    if (!timeoutId) {
      return;
    }

    clearTimeout(timeoutId);
    timeoutId = null;
  }

  return {
    onClickCapture(event: React.MouseEvent<HTMLElement>) {
      if (event.currentTarget.dataset.longPressHandled !== "true") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      delete event.currentTarget.dataset.longPressHandled;
    },
    onContextMenu(event: React.MouseEvent<HTMLElement>) {
      if (event.currentTarget.dataset.longPressHandled !== "true") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      delete event.currentTarget.dataset.longPressHandled;
    },
    onPointerCancel: clearLongPressTimer,
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0) {
        return;
      }

      const target = event.currentTarget;
      clearLongPressTimer();
      delete target.dataset.longPressHandled;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        target.dataset.longPressHandled = "true";
        onLongPress();
      }, NUMBER_GROUP_LONG_PRESS_MS);
    },
    onPointerLeave: clearLongPressTimer,
    onPointerUp: clearLongPressTimer,
  };
}

type LoadState = "idle" | "loading" | "syncing" | "loaded" | "error";

type HomePageProps = {
  initialLotterySlug?: string;
  initialDrawNumber?: string;
  isChatEnabled?: boolean;
};

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatStatusDate(draw: Draw | null): string {
  return draw?.date || "Sem data";
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

function shouldPrefetchLotteryHistory(): boolean {
  const connection = typeof navigator === "undefined" ? null : (navigator as NavigatorWithConnection).connection;

  if (!connection) {
    return true;
  }

  const isSaveData = connection.saveData;
  const connectionType = connection.effectiveType;

  return !isSaveData && !SAVE_DATA_CONNECTION_TYPES.includes(connectionType as (typeof SAVE_DATA_CONNECTION_TYPES)[number]);
}

function queueHistoryDataLoad(lotterySlug: string, options: { priority?: boolean } = {}): Promise<LoadedLotteryData> {
  const cacheKey = getDataCacheKey(lotterySlug, "");
  const cachedData = loadedDataCache.get(cacheKey);

  if (cachedData) {
    return Promise.resolve(cachedData);
  }

  const pendingRequest = pendingDataRequests.get(cacheKey);

  if (pendingRequest) {
    return pendingRequest;
  }

  return historyLoadQueue.load(lotterySlug, options);
}

function cacheHistoryData(lotterySlug: string, draws: Draw[], rawText: string, statusMessage = getHistoryStatusMessage(draws)): LoadedLotteryData {
  const loadedData: LoadedLotteryData = {
    draws,
    selectedDraw: null,
    rawText,
    statusMessage,
  };

  loadedDataCache.set(getDataCacheKey(lotterySlug, ""), loadedData);
  return loadedData;
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

  const endpoint = drawNumber ? `/api/lotteries/${lotterySlug}?draw=${drawNumber}` : `/api/lotteries/${lotterySlug}?collect=false`;
  const request = fetch(endpoint, { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json()) as LotteryApiPayload;

      if (!response.ok) {
        throw new Error(payload.error || `Falha HTTP ${response.status}`);
      }

      const loadedData: LoadedLotteryData = drawNumber
        ? {
            draws: payload.draw ? [asClientDraw(payload.draw)] : [],
            selectedDraw: null,
            rawText: payload.text ?? "",
            statusMessage: payload.draw ? "Concurso encontrado." : "Concurso não encontrado.",
          }
        : (() => {
            const history = asClientDraws(payload.draws ?? payload.collection?.draws ?? []);

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

function getCombinationKey(numbers: string[]): string {
  return numbers.join("-");
}

function getSuggestionSourceLabel(view: AnalysisView, data: AnalysisData): string {
  return `${getAnalysisViewLabel(view)} · ${data.periodLabel}${data.scopeLabel === "Todos os sorteios" ? "" : ` · ${data.scopeLabel}`}`;
}

function getLotteryAnalyticsData(lottery: LotteryDefinition) {
  return {
    lottery: lottery.slug,
    numbersPerDraw: lottery.numbersPerDraw,
    totalNumbers: lottery.countNumbers,
  };
}

function getPeriodAnalyticsValue(period: AnalysisPeriod): string | number {
  return period === "all" ? "ajustar" : period;
}

function getAnalysisAnalyticsData(
  lottery: LotteryDefinition,
  view: AnalysisView,
  period: AnalysisPeriod,
  data: AnalysisData | null,
  scope: DuplaSenaAnalysisScope,
) {
  return {
    ...getLotteryAnalyticsData(lottery),
    analysisView: view,
    analysisViewLabel: getAnalysisViewLabel(view),
    drawCount: data?.drawCount ?? 0,
    period: getPeriodAnalyticsValue(period),
    periodLabel: data?.periodLabel ?? String(getPeriodAnalyticsValue(period)),
    scope,
    scopeLabel: data?.scopeLabel ?? "",
  };
}

function getGroupedNumbersClipboardText(groups: string[][]): string {
  if (groups.length <= 1) {
    return (groups[0] ?? []).join(" ");
  }

  return groups.map((group, index) => `${index + 1}º: ${group.join(" ")}`).join("\n");
}

function getDrawClipboardText(draw: Draw): string {
  return getGroupedNumbersClipboardText(getDisplayGroups(draw));
}

function getSuggestedGameKey(game: SuggestedGame): string {
  return `${game.lotterySlug}:${game.filterKey}:${game.variantIndex}:${game.combinationKey}`;
}

function copyTextWithTemporarySelection(text: string): boolean {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.opacity = "0";
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalizedText);
      return true;
    } catch {
      return copyTextWithTemporarySelection(normalizedText);
    }
  }

  return copyTextWithTemporarySelection(normalizedText);
}

function buildUniqueLuckySuggestion(
  lottery: LotteryDefinition,
  view: AnalysisView,
  data: AnalysisData,
  existingKeys: Set<string>,
  variantIndex: number,
): string[] | null {
  const maxAttempts = 80;
  const size = getSuggestionSize(lottery);

  if (view === "map") {
    const hotNumbers = data.stats
      .filter((item) => item.hits > 0)
      .sort((left, right) => right.hits - left.hits || left.overdue - right.overdue || left.value - right.value);
    const pool = hotNumbers.length >= size ? hotNumbers : [...hotNumbers, ...data.stats.filter((item) => item.hits === 0)];
    const topWindowSize = Math.min(pool.length, Math.max(size, Math.ceil(size * 1.7)));
    const topWindow = pool.slice(0, topWindowSize);

    if (!topWindow.length) {
      return null;
    }

    const stableHotNumbers = sortNumbersForDisplay(pool.slice(0, size).map((item) => item.number));

    if (variantIndex === 1 || !existingKeys.has(getCombinationKey(stableHotNumbers))) {
      return stableHotNumbers;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const offset = (variantIndex + attempt) % topWindow.length;
      const selected = topWindow
        .filter((_, index) => index !== offset)
        .slice(0, size)
        .map((item) => item.number);
      const numbers = sortNumbersForDisplay(selected);
      const combinationKey = getCombinationKey(numbers);

      if (numbers.length === size && !existingKeys.has(combinationKey)) {
        return numbers;
      }
    }

    return null;
  }

  function findUniqueByRecencyScoreMode(recencyScoreMode: RecencyScoreMode): string[] | null {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const numbers = buildLuckySuggestion(lottery, view, data, Math.random, recencyScoreMode);
      const combinationKey = getCombinationKey(numbers);

      if (!existingKeys.has(combinationKey)) {
        return numbers;
      }
    }

    return null;
  }

  if (view === "recent") {
    return findUniqueByRecencyScoreMode("float") ?? findUniqueByRecencyScoreMode("rounded");
  }

  return findUniqueByRecencyScoreMode("float");
}

export function HomePage({ initialLotterySlug, initialDrawNumber, isChatEnabled = false }: HomePageProps) {
  const initialLottery = getInitialLottery(initialLotterySlug);
  const [selectedLottery, setSelectedLottery] = useState<LotteryDefinition | null>(initialLottery);
  const [drawNumberInput, setDrawNumberInput] = useState(initialDrawNumber ?? "");
  const [activeDrawNumber, setActiveDrawNumber] = useState(initialDrawNumber ?? "");
  const [draws, setDraws] = useState<Draw[]>([]);
  const [selectedDraw, setSelectedDraw] = useState<Draw | null>(null);
  const [status, setStatus] = useState<LoadState>(initialLottery ? "loading" : "idle");
  const [statusMessage, setStatusMessage] = useState(
    initialDrawNumber ? "Consultando concurso..." : initialLottery ? "Carregando dados salvos..." : "Escolha uma loteria.",
  );
  const [lookupMode, setLookupMode] = useState<LookupMode>("numbers");
  const [numberFilter, setNumberFilter] = useState<string[]>([]);
  const [visibleDrawState, setVisibleDrawState] = useState({ increment: INITIAL_DRAW_LIST_PAGE_SIZE, key: "", limit: INITIAL_DRAW_LIST_PAGE_SIZE });
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>(25);
  const [customAnalysisRange, setCustomAnalysisRange] = useState<AnalysisDrawRange | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("most");
  const [recentWeightDisplayMode, setRecentWeightDisplayMode] = useState<RecencyScoreMode>("float");
  const [duplaSenaAnalysisScope, setDuplaSenaAnalysisScope] = useState<DuplaSenaAnalysisScope>("all");
  const [syncInfo, setSyncInfo] = useState<SyncInfo>(INITIAL_SYNC_INFO);
  const [suggestedGames, setSuggestedGames] = useState<SuggestedGame[]>([]);
  const [selectedSuggestedGameKey, setSelectedSuggestedGameKey] = useState<string | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const syncStopRef = useRef(false);
  const syncSessionRef = useRef(0);
  const selectionClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSyncing = syncInfo.running;
  const drawCount = draws.length || (selectedDraw ? 1 : 0);
  const canClearLookupFilter = Boolean(drawNumberInput.trim() || activeDrawNumber.trim() || numberFilter.length);

  const filteredDraws = useMemo(() => draws.filter((draw) => drawContainsNumbers(draw, numberFilter)), [draws, numberFilter]);
  const numberFilterKey = numberFilter.join("|");
  const drawListKey = `${selectedLottery?.slug ?? ""}|${activeDrawNumber}|${numberFilterKey}`;
  const visibleDrawLimit = visibleDrawState.key === drawListKey ? visibleDrawState.limit : INITIAL_DRAW_LIST_PAGE_SIZE;
  const visibleDraws = useMemo(() => filteredDraws.slice(0, visibleDrawLimit), [filteredDraws, visibleDrawLimit]);
  const hasMoreDraws = visibleDrawLimit < filteredDraws.length;
  const analysisSourceDraws = numberFilter.length || activeDrawNumber.trim() ? filteredDraws : draws;
  const availableAnalysisDrawCount = Math.max(1, analysisSourceDraws.length || drawCount);
  const effectiveCustomAnalysisRange = useMemo(() => {
    const maximum = availableAnalysisDrawCount;
    const fallback = { end: maximum, start: 1 };
    const range = customAnalysisRange ?? fallback;
    const start = Math.min(Math.max(Math.round(range.start), 1), maximum);
    const end = Math.min(Math.max(Math.round(range.end), 1), maximum);

    if (maximum <= 1) {
      return { end: 1, start: 1 };
    }

    if (start >= end) {
      return start >= maximum ? { end: maximum, start: maximum - 1 } : { end: start + 1, start };
    }

    return { end, start };
  }, [availableAnalysisDrawCount, customAnalysisRange]);
  const analysisData = useMemo(
    () =>
      buildAnalysisData(
        analysisSourceDraws,
        selectedLottery,
        analysisPeriod,
        selectedLottery?.slug === "DuplaSena" ? duplaSenaAnalysisScope : "all",
        analysisPeriod === "all" ? effectiveCustomAnalysisRange : undefined,
      ),
    [analysisPeriod, analysisSourceDraws, duplaSenaAnalysisScope, effectiveCustomAnalysisRange, selectedLottery],
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
  const selectedNumberList = useMemo(() => sortNumbersForDisplay([...selectedNumbers]), [selectedNumbers]);
  const selectedNumberText = selectedNumberList.join(" ");
  const visibleSuggestedGames = useMemo(
    () =>
      suggestedGames
        .filter((game) => selectedLottery && game.lotterySlug === selectedLottery.slug)
        .sort((left, right) => right.variantIndex - left.variantIndex),
    [selectedLottery, suggestedGames],
  );

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
        setStatusMessage(requestedDrawNumber ? `Consultando concurso ${requestedDrawNumber}...` : "Carregando dados salvos...");
      }

      try {
        const loadedData = requestedDrawNumber
          ? await loadLotteryDataOnce(lottery.slug, requestedDrawNumber)
          : await queueHistoryDataLoad(lottery.slug, { priority: true });

        if (ignoreResult) {
          return;
        }

        setDraws(loadedData.draws);
        setSelectedDraw(loadedData.selectedDraw);
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

  useEffect(() => {
    if (!shouldPrefetchLotteryHistory()) {
      return;
    }

    for (const lottery of LOTTERIES) {
      void queueHistoryDataLoad(lottery.slug).catch(() => undefined);
    }
  }, []);

  useEffect(
    () => () => {
      if (selectionClickTimeoutRef.current) {
        clearTimeout(selectionClickTimeoutRef.current);
      }
    },
    [],
  );

  function selectLottery(lottery: LotteryDefinition) {
    const cachedHistory = loadedDataCache.get(getDataCacheKey(lottery.slug, ""));

    syncStopRef.current = true;
    syncSessionRef.current += 1;
    void queueHistoryDataLoad(lottery.slug, { priority: true }).catch(() => undefined);
    setSelectedLottery(lottery);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setDraws(cachedHistory?.draws ?? []);
    setSelectedDraw(cachedHistory?.selectedDraw ?? null);
    setSelectedNumbers(new Set());
    setSelectedSuggestedGameKey(null);
    setError(null);
    setStatus(cachedHistory ? "loaded" : "loading");
    setStatusMessage(cachedHistory?.statusMessage ?? "Carregando dados salvos...");
    setLookupMode("numbers");
    setNumberFilter([]);
    setCustomAnalysisRange(null);
    setRecentWeightDisplayMode("float");
    setSyncInfo(INITIAL_SYNC_INFO);
    updateLegacyUrl(lottery.slug);
    trackEvent(ANALYTICS_EVENTS.lotterySelected, getLotteryAnalyticsData(lottery));
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
        setStatusMessage("Informe números válidos para filtrar.");
        return;
      }

      setNumberFilter(parsedNumbers);
      setSelectedDraw(null);
      setActiveDrawNumber("");
      updateLegacyUrl(selectedLottery.slug);
      setStatusMessage(`Filtro aplicado: ${parsedNumbers.join(", ")}.`);
      trackEvent(ANALYTICS_EVENTS.searchedNumbers, {
        ...getLotteryAnalyticsData(selectedLottery),
        count: parsedNumbers.length,
      });
      return;
    }

    setNumberFilter([]);
    setActiveDrawNumber(trimmed);
    updateLegacyUrl(selectedLottery.slug, trimmed || undefined);
    if (lookupMode === "draw" && trimmed) {
      trackEvent(ANALYTICS_EVENTS.searchedDraw, {
        ...getLotteryAnalyticsData(selectedLottery),
        hasDrawNumber: true,
      });
    }
  }

  function changeLookupMode(mode: LookupMode) {
    setLookupMode(mode);
    setDrawNumberInput("");
    setNumberFilter([]);
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
    setSelectedDraw(null);

    if (selectedLottery) {
      updateLegacyUrl(selectedLottery.slug);
      setStatusMessage(getHistoryStatusMessage(draws));
      trackEvent(ANALYTICS_EVENTS.clearedFilter, {
        ...getLotteryAnalyticsData(selectedLottery),
        mode: lookupMode,
      });
    }
  }

  function toggleSelectedNumber(number: string) {
    setSelectedNumbers((current) => {
      const next = new Set(current);

      if (next.has(number)) {
        next.delete(number);
      } else {
        next.add(number);
      }

      return next;
    });
  }

  function clearPendingSelectionClick() {
    if (!selectionClickTimeoutRef.current) {
      return;
    }

    clearTimeout(selectionClickTimeoutRef.current);
    selectionClickTimeoutRef.current = null;
  }

  function scheduleSelectionClick(action: () => void) {
    clearPendingSelectionClick();
    selectionClickTimeoutRef.current = setTimeout(() => {
      selectionClickTimeoutRef.current = null;
      action();
    }, 220);
  }

  function addNumberGroupToSelection(numbers: string[]) {
    const groupNumbers = sortNumbersForDisplay([...new Set(numbers)]);

    if (!groupNumbers.length) {
      return;
    }

    clearPendingSelectionClick();
    setSelectedNumbers((current) => new Set([...current, ...groupNumbers]));
    setSelectedSuggestedGameKey(null);
    setStatusMessage(`Números adicionados: ${groupNumbers.join(", ")}.`);
  }

  function replaceOrClearNumberGroupSelection(numbers: string[]) {
    const groupNumbers = sortNumbersForDisplay([...new Set(numbers)]);

    if (!groupNumbers.length) {
      return;
    }

    clearPendingSelectionClick();
    setSelectedSuggestedGameKey(null);

    if (groupNumbers.every((number) => selectedNumbers.has(number))) {
      setSelectedNumbers(new Set());
      setStatusMessage("Seleção de números limpa.");
      return;
    }

    setSelectedNumbers(new Set(groupNumbers));
    setStatusMessage(`Seleção atualizada: ${groupNumbers.join(", ")}.`);
  }

  function applySelectedNumbersFilter() {
    if (!selectedLottery || !selectedNumberList.length) {
      return;
    }

    setLookupMode("numbers");
    setDrawNumberInput(selectedNumberText);
    setNumberFilter(selectedNumberList);
    setSelectedDraw(null);
    setActiveDrawNumber("");
    updateLegacyUrl(selectedLottery.slug);
    setStatusMessage(`Filtro aplicado: ${selectedNumberList.join(", ")}.`);
    trackEvent(ANALYTICS_EVENTS.searchedNumbers, {
      ...getLotteryAnalyticsData(selectedLottery),
      count: selectedNumberList.length,
      source: "selection",
    });
  }

  function clearSelectedNumbers() {
    if (!selectedNumberList.length) {
      return;
    }

    setSelectedNumbers(new Set());
    setSelectedSuggestedGameKey(null);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setNumberFilter([]);
    setSelectedDraw(null);

    if (selectedLottery) {
      updateLegacyUrl(selectedLottery.slug);
      trackEvent(ANALYTICS_EVENTS.clearedFilter, {
        ...getLotteryAnalyticsData(selectedLottery),
        mode: "selection",
      });
    }

    setStatusMessage("Seleção e filtro limpos.");
  }

  function copySelectedNumbers() {
    if (!selectedNumberText) {
      return;
    }

    void copySelectionToClipboard(selectedNumberText, "Números selecionados copiados.");
  }

  function loadMoreDraws() {
    const currentLimit = visibleDrawState.key === drawListKey ? visibleDrawState.limit : INITIAL_DRAW_LIST_PAGE_SIZE;
    const currentIncrement = visibleDrawState.key === drawListKey ? visibleDrawState.increment : INITIAL_DRAW_LIST_PAGE_SIZE;
    const nextIncrement = Math.min(currentIncrement * 2, MAX_DRAW_LIST_INCREMENT);

    setVisibleDrawState({
      increment: nextIncrement,
      key: drawListKey,
      limit: currentLimit + nextIncrement,
    });

    if (selectedLottery) {
      trackEvent(ANALYTICS_EVENTS.loadMoreDraws, {
        ...getLotteryAnalyticsData(selectedLottery),
        currentVisibleCount: currentLimit,
        nextIncrement,
        totalCount: filteredDraws.length,
      });
    }
  }

  function requestStopSyncFromCaixa() {
    syncStopRef.current = true;

    if (selectedLottery) {
      trackEvent(ANALYTICS_EVENTS.syncPaused, {
        ...getLotteryAnalyticsData(selectedLottery),
        totalStoredDraws: syncInfo.totalStoredDraws,
      });
    }
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

    const history = asClientDraws(payload.draws ?? payload.sync.draws ?? []);
    const loadedData = cacheHistoryData(lottery.slug, history, payload.text ?? "", getHistoryStatusMessage(history));
    setDraws(loadedData.draws);
    setSelectedDraw((current) => {
      if (!current) {
        return null;
      }

      return loadedData.draws.find((draw) => draw.drawNumber === current.drawNumber) ?? null;
    });

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

  async function syncBaseFromCaixa(source: SyncSource = "manual") {
    if (!selectedLottery || status === "loading") {
      return;
    }

    if (syncInfo.running) {
      requestStopSyncFromCaixa();
      return;
    }

    if (activeDrawNumber.trim()) {
      setStatusMessage("Volte ao histórico da loteria antes de carregar novos resultados.");
      return;
    }

    const lottery = selectedLottery;
    const sessionId = syncSessionRef.current + 1;
    syncSessionRef.current = sessionId;
    syncStopRef.current = false;
    setActiveDrawNumber("");
    setDrawNumberInput("");
    setNumberFilter([]);
    setSelectedDraw(null);
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
    trackEvent(ANALYTICS_EVENTS.syncStarted, {
      ...getLotteryAnalyticsData(lottery),
      source,
      totalStoredDraws: drawCount,
    });

    let lastTotalStoredDraws = drawCount;
    let nextStart: number | undefined = undefined;

    try {
      while (!syncStopRef.current && syncSessionRef.current === sessionId) {
        const sync = await runSyncBatch(lottery, sessionId, nextStart);
        lastTotalStoredDraws = sync.totalStoredDraws || lastTotalStoredDraws;
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
      setStatusMessage(stoppedByUser ? "Carregamento pausado." : "Resultados atualizados.");
      if (!stoppedByUser) {
        trackEvent(ANALYTICS_EVENTS.syncFinished, {
          ...getLotteryAnalyticsData(lottery),
          source,
          totalStoredDraws: lastTotalStoredDraws,
        });
      }
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
      trackEvent(ANALYTICS_EVENTS.syncFailed, {
        ...getLotteryAnalyticsData(lottery),
        hasVisibleDraws: Boolean(hasVisibleDraws),
        source,
      });
    } finally {
      syncStopRef.current = false;
    }
  }

  function changeAnalysisPeriod(period: AnalysisPeriod) {
    setAnalysisPeriod(period);
    if (selectedLottery) {
      trackEvent(
        ANALYTICS_EVENTS.updatedAnalysisPeriod,
        getAnalysisAnalyticsData(selectedLottery, analysisView, period, analysisData, duplaSenaAnalysisScope),
      );
    }
  }

  function changeCustomAnalysisRange(nextRange: AnalysisDrawRange) {
    const maximum = availableAnalysisDrawCount;
    const currentRange = customAnalysisRange ?? { end: maximum, start: 1 };
    const start = Number.isFinite(nextRange.start) ? Math.round(nextRange.start) : currentRange.start;
    const end = Number.isFinite(nextRange.end) ? Math.round(nextRange.end) : currentRange.end;
    const normalizedStart = Math.min(Math.max(start, 1), maximum);
    const normalizedEnd = Math.min(Math.max(end, 1), maximum);
    const trackedRange = (() => {
      if (maximum <= 1) {
        return { end: 1, start: 1 };
      }

      if (normalizedStart >= normalizedEnd) {
        return normalizedStart >= maximum
          ? { end: maximum, start: maximum - 1 }
          : { end: normalizedStart + 1, start: normalizedStart };
      }

      return { end: normalizedEnd, start: normalizedStart };
    })();

    setCustomAnalysisRange(trackedRange);

    if (selectedLottery) {
      trackEvent(ANALYTICS_EVENTS.updatedAnalysisRange, {
        ...getAnalysisAnalyticsData(selectedLottery, analysisView, analysisPeriod, analysisData, duplaSenaAnalysisScope),
        selectedCount: Math.max(1, trackedRange.end - trackedRange.start + 1),
      });
    }
  }

  function changeAnalysisView(view: AnalysisView) {
    const nextRecentWeightDisplayMode =
      view === "recent" && analysisView === "recent"
        ? recentWeightDisplayMode === "float"
          ? "rounded"
          : "float"
        : "float";

    setRecentWeightDisplayMode(nextRecentWeightDisplayMode);
    setAnalysisView(view);
    if (selectedLottery) {
      trackEvent(
        ANALYTICS_EVENTS.updatedAnalysisView,
        {
          ...getAnalysisAnalyticsData(selectedLottery, view, analysisPeriod, analysisData, duplaSenaAnalysisScope),
          recentScoreMode: view === "recent" ? (nextRecentWeightDisplayMode === "float" ? 1 : 2) : undefined,
        },
      );
    }
  }

  function changeDuplaSenaAnalysisScope(scope: DuplaSenaAnalysisScope) {
    setDuplaSenaAnalysisScope(scope);
    if (selectedLottery) {
      trackEvent(
        ANALYTICS_EVENTS.updatedAnalysisScope,
        getAnalysisAnalyticsData(selectedLottery, analysisView, analysisPeriod, analysisData, scope),
      );
    }
  }

  function generateLuckySuggestion() {
    if (!selectedLottery || !analysisData || !suggestionKey) {
      return;
    }

    const analyticsData = getAnalysisAnalyticsData(selectedLottery, analysisView, analysisPeriod, analysisData, duplaSenaAnalysisScope);

    trackEvent(ANALYTICS_EVENTS.luckyButtonClicked, analyticsData);

    const suggestionVariantKey = getSuggestionVariantKey(selectedLottery, analysisView, analysisData);
    const existingGamesForContext = suggestedGames.filter(
      (game) => game.lotterySlug === selectedLottery.slug && game.filterKey === suggestionVariantKey,
    );
    const existingKeys = new Set(existingGamesForContext.map((game) => game.combinationKey));
    const variantIndex = existingGamesForContext.length + 1;
    const numbers = buildUniqueLuckySuggestion(selectedLottery, analysisView, analysisData, existingKeys, variantIndex);

    if (!numbers) {
      setStatusMessage("Não encontrei uma nova combinação diferente para este filtro.");
      return;
    }

    setSuggestedGames((current) => [
      {
        combinationKey: getCombinationKey(numbers),
        filterKey: suggestionVariantKey,
        lotterySlug: selectedLottery.slug,
        numbers,
        sourceLabel: getSuggestionSourceLabel(analysisView, analysisData),
        variantIndex,
      },
      ...current,
    ]);
    setSelectedSuggestedGameKey(null);
    setStatusMessage("Nova sugestão adicionada.");
    trackEvent(ANALYTICS_EVENTS.generatedSuggestion, {
      ...analyticsData,
      suggestionSize: numbers.length,
      variantIndex,
    });
  }

  function clearSuggestedGames() {
    if (!selectedLottery) {
      setSuggestedGames([]);
      setSelectedSuggestedGameKey(null);
      return;
    }

    setSuggestedGames((current) => current.filter((game) => game.lotterySlug !== selectedLottery.slug));
    setSelectedSuggestedGameKey(null);
    setStatusMessage("Sugestões limpas.");
  }

  async function copySelectionToClipboard(text: string, successMessage: string) {
    const copied = await copyTextToClipboard(text);
    setStatusMessage(copied ? successMessage : "Seleção feita, mas o navegador bloqueou a cópia automática.");
  }

  function selectDrawAndCopy(draw: Draw) {
    scheduleSelectionClick(() => {
      if (selectedDraw?.drawNumber === draw.drawNumber) {
        setSelectedDraw(null);
        return;
      }

      setSelectedDraw(draw);
      void copySelectionToClipboard(getDrawClipboardText(draw), `Números do concurso ${draw.drawNumber} copiados.`);
      if (selectedLottery) {
        trackEvent(ANALYTICS_EVENTS.copyDraw, {
          ...getLotteryAnalyticsData(selectedLottery),
          drawNumber: draw.drawNumber,
          grouped: getDisplayGroups(draw).length > 1,
        });
      }
    });
  }

  function selectSuggestedGame(game: SuggestedGame) {
    scheduleSelectionClick(() => {
      const gameKey = getSuggestedGameKey(game);

      if (selectedSuggestedGameKey === gameKey) {
        setSelectedSuggestedGameKey(null);
        return;
      }

      setSelectedSuggestedGameKey(gameKey);
      void copySelectionToClipboard(game.numbers.join(" "), "Sugestão copiada.");
      if (selectedLottery) {
        trackEvent(ANALYTICS_EVENTS.copySuggestion, {
          ...getAnalysisAnalyticsData(selectedLottery, analysisView, analysisPeriod, analysisData, duplaSenaAnalysisScope),
          suggestionSize: game.numbers.length,
          variantIndex: game.variantIndex,
        });
      }
    });
  }

  function returnToHome() {
    syncStopRef.current = true;
    syncSessionRef.current += 1;
    setSelectedLottery(null);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setDraws([]);
    setSelectedDraw(null);
    setSelectedNumbers(new Set());
    setSelectedSuggestedGameKey(null);
    setStatus("idle");
    setStatusMessage("Escolha uma loteria.");
    setLookupMode("numbers");
    setNumberFilter([]);
    setVisibleDrawState({ increment: INITIAL_DRAW_LIST_PAGE_SIZE, key: "", limit: INITIAL_DRAW_LIST_PAGE_SIZE });
    setAnalysisPeriod(25);
    setCustomAnalysisRange(null);
    setAnalysisView("most");
    setRecentWeightDisplayMode("float");
    setDuplaSenaAnalysisScope("all");
    setSyncInfo(INITIAL_SYNC_INFO);
    setError(null);
    updateLegacyUrl();
  }

  function trackDonationLinkClick(placement: "hero" | "footer") {
    trackEvent(ANALYTICS_EVENTS.donationLinkClicked, { placement });
  }

  return (
    <>
      <div className="dashboard">
      <section className="hero-card">
        <div>
          <Link aria-label="Voltar para o início sem loteria selecionada" className="brand-home" href="/" onClick={returnToHome}>
            <Image alt="Luckygames" className="brand-icon" height={72} priority src="/gohorse.png" width={72} />
            <h1>Luckygames</h1>
          </Link>
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
              <a href="https://idontneedit.org" onClick={() => trackDonationLinkClick("hero")} rel="noreferrer" target="_blank">
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
              className={`lottery-card lottery-card-${lottery.slug.toLowerCase()} ${active ? "active" : ""}`}
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

      {selectedLottery ? (
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
              <div className="lookup-buttons">
                <button disabled={!selectedLottery || status === "loading" || isSyncing} type="submit">
                  {lookupMode === "draw" ? "Consultar" : "Pesquisar"}
                </button>
                <button className="secondary-button" disabled={!canClearLookupFilter} onClick={clearLookupFilter} type="button">
                  Limpar filtro
                </button>
              </div>
            </div>
          </form>

          {isChatEnabled ? (
            <ResultsChatPanel
              activeDrawNumber={activeDrawNumber}
              analysisData={analysisData}
              analysisViewLabel={getAnalysisViewLabel(analysisView)}
              draws={analysisData?.selectedDraws ?? []}
              isLoading={status === "loading"}
              lottery={selectedLottery}
              numberFilter={numberFilter}
            />
          ) : null}

          <SelectedNumbersToolbar
            numbers={selectedNumberList}
            onApplyFilter={applySelectedNumbersFilter}
            onClear={clearSelectedNumbers}
            onCopy={copySelectedNumbers}
            onToggleNumber={toggleSelectedNumber}
          />
        </aside>

        <section className="results-panel">
          <div className="results-header">
            <div className="results-title-block">
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
              {statusMessage ? <p className={`status-badge ${status}`}>{statusMessage}</p> : null}
            </div>
            <div className="results-actions">
              <a
                className="legacy-link results-link"
                href={legacyHref}
                onClick={() => {
                  if (selectedLottery) {
                    trackEvent(ANALYTICS_EVENTS.openRawResults, {
                      ...getLotteryAnalyticsData(selectedLottery),
                      hasDrawNumber: Boolean(activeDrawNumber.trim()),
                    });
                  }
                }}
                rel="noreferrer"
                target="_blank"
              >
                Ver todos os sorteios
              </a>
            </div>
          </div>

          {status === "loading" ? <LoadingState /> : null}
          {status === "error" ? <ErrorState message={error ?? "Erro ao carregar."} /> : null}
          {status !== "loading" && status !== "error" && draws.length === 0 ? (
            <NoResultsState isSyncing={isSyncing} />
          ) : null}
          {status !== "loading" && status !== "error" && draws.length > 0 ? (
            <>
              <SuggestionPanel
                activeView={analysisView}
                data={analysisData}
                lottery={selectedLottery}
                games={visibleSuggestedGames}
                onClear={clearSuggestedGames}
                onAddNumberGroup={addNumberGroupToSelection}
                onLucky={generateLuckySuggestion}
                onReplaceOrClearNumberGroup={replaceOrClearNumberGroupSelection}
                onSelectGame={selectSuggestedGame}
                selectedGameKey={selectedSuggestedGameKey}
                onToggleNumber={toggleSelectedNumber}
                selectedNumbers={selectedNumbers}
              />
              <AnalysisPanel
                activeView={analysisView}
                availableDrawCount={availableAnalysisDrawCount}
                availableDraws={analysisSourceDraws}
                customRange={effectiveCustomAnalysisRange}
                data={analysisData}
                isDuplaSena={selectedLottery?.slug === "DuplaSena"}
                recentWeightDisplayMode={recentWeightDisplayMode}
                selectedNumbers={selectedNumbers}
                onToggleNumber={toggleSelectedNumber}
                onCustomRangeChange={changeCustomAnalysisRange}
                onPeriodChange={changeAnalysisPeriod}
                onScopeChange={changeDuplaSenaAnalysisScope}
                onViewChange={changeAnalysisView}
                period={analysisPeriod}
                scope={duplaSenaAnalysisScope}
              />
              {numberFilter.length && filteredDraws.length === 0 ? (
                <FilterEmptyState numbers={numberFilter} />
              ) : (
                <>
              <div className="results-list-heading">
                <button
                  aria-label={syncInfo.running ? "Pausar carregamento manual de resultados" : "Carregar resultados manualmente"}
                  className={`results-list-label results-sync-trigger ${syncInfo.running ? "running" : ""}`}
                  disabled={!selectedLottery || syncInfo.stopRequested}
                  onClick={() => syncBaseFromCaixa("manual")}
                      title={syncInfo.running ? "Pausar carregamento" : "Carregar resultados manualmente"}
                      type="button"
                    >
                      {syncInfo.running ? (syncInfo.stopRequested ? "Interrompendo carregamento..." : "Carregando resultados...") : "Resultados"}
                    </button>
                <strong>
                  {filteredDraws.length} concurso{filteredDraws.length === 1 ? "" : "s"}
                </strong>
              </div>
                  <DrawList
                    draws={visibleDraws}
                    hasMore={hasMoreDraws}
                    onLoadMore={loadMoreDraws}
                    onSelect={selectDrawAndCopy}
                    onAddNumberGroup={addNumberGroupToSelection}
                    onReplaceOrClearNumberGroup={replaceOrClearNumberGroupSelection}
                    selectedDrawNumber={selectedDraw?.drawNumber ?? null}
                    totalCount={filteredDraws.length}
                    visibleCount={visibleDraws.length}
                    onToggleNumber={toggleSelectedNumber}
                    selectedNumbers={selectedNumbers}
                  />
                </>
              )}
            </>
          ) : null}
        </section>
      </section>
      ) : (
        <section className="selection-empty" aria-label="Selecione uma loteria">
          <EmptyState />
        </section>
      )}
    </div>
    <Remark42Comments />
    <footer className="super-footer" aria-label="Apoie o Luckygames">
      <div className="donation-callout donation-callout-bottom">
        <span>
          Se o Luckygames ajudou, apoie com um PIX para <strong className="pix-key">contato@luckygames.tips</strong> ou cartão em{" "}
          <a href="https://idontneedit.org" onClick={() => trackDonationLinkClick("footer")} rel="noreferrer" target="_blank">
            idontneedit.org
          </a>
          .
        </span>
      </div>
    </footer>
  </>
  );
}

function SelectedNumbersToolbar({
  numbers,
  onApplyFilter,
  onClear,
  onCopy,
  onToggleNumber,
}: {
  numbers: string[];
  onApplyFilter: () => void;
  onClear: () => void;
  onCopy: () => void;
  onToggleNumber: (number: string) => void;
}) {
  const hasNumbers = numbers.length > 0;
  const countLabel = hasNumbers ? `${numbers.length} ${numbers.length === 1 ? "número" : "números"}` : "0 números";

  return (
    <section className="selected-numbers-toolbar" aria-label="Números selecionados" aria-live="polite">
      <div className="selected-numbers-meta">
        <span className="eyebrow">Seleção</span>
        <strong>{countLabel}</strong>
      </div>
      <div className="selected-number-list">
        {hasNumbers ? (
          numbers.map((number) => (
            <button
              aria-label={`Remover número ${number} da seleção`}
              className="selected-number-chip"
              key={number}
              onClick={() => onToggleNumber(number)}
              title="Remover da seleção"
              type="button"
            >
              {number}
            </button>
          ))
        ) : (
          <span className="selected-number-placeholder">Sem seleção</span>
        )}
      </div>
      <div className="selected-number-actions">
        <button className="selected-number-action primary" disabled={!hasNumbers} onClick={onApplyFilter} type="button">
          Filtrar
        </button>
        <button className="selected-number-action" disabled={!hasNumbers} onClick={onCopy} type="button">
          Copiar
        </button>
        <button className="selected-number-action" disabled={!hasNumbers} onClick={onClear} type="button">
          Limpar
        </button>
      </div>
    </section>
  );
}

function Remark42Comments() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<Remark42Instance | null>(null);

  useEffect(() => {
    if (!REMARK42_HOST || !REMARK42_SITE_ID) {
      return;
    }

    let cancelled = false;
    const config: Remark42Config = {
      components: ["embed"],
      host: REMARK42_HOST,
      locale: REMARK42_LOCALE,
      no_footer: REMARK42_NO_FOOTER,
      page_title: "Luckygames — bate-papo",
      site_id: REMARK42_SITE_ID,
      theme: "dark",
      url: new URL("/", window.location.origin).toString(),
    };

    function destroyCurrentInstance() {
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
        return;
      }

      window.REMARK42?.destroy?.();
    }

    function mountRemark42() {
      if (cancelled || !rootRef.current || !window.REMARK42?.createInstance) {
        return;
      }

      destroyCurrentInstance();
      rootRef.current.innerHTML = "";
      window.remark_config = config;
      instanceRef.current = window.REMARK42.createInstance(config);
      window.REMARK42.changeTheme?.("dark");
    }

    window.remark_config = config;

    if (window.REMARK42?.createInstance) {
      mountRemark42();
    } else {
      window.addEventListener("REMARK42::ready", mountRemark42, { once: true });

      if (!document.getElementById(REMARK42_SCRIPT_ID)) {
        const script = document.createElement("script");
        script.async = true;
        script.defer = true;
        script.id = REMARK42_SCRIPT_ID;
        script.src = `${config.host}/web/embed.js`;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      window.removeEventListener("REMARK42::ready", mountRemark42);
      destroyCurrentInstance();
    };
  }, []);

  return (
    <section className="comments-section" aria-labelledby="comments-title">
      <div className="comments-heading">
        <span className="eyebrow">Comunidade</span>
        <h2 id="comments-title">Bate-papo dos jogadores</h2>
        <p>Uma área livre para trocar ideias, palpites e experiências com outros usuários do Luckygames.</p>
      </div>
      <div className="remark42-frame">
        <div className="remark42-root" id={REMARK42_ROOT_ID} ref={rootRef}>
          Carregando bate-papo...
        </div>
      </div>
    </section>
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

function NoResultsState({ isSyncing }: { isSyncing: boolean }) {
  return (
    <div className="empty-state">
      <strong>{isSyncing ? "Carregando concursos" : "Nenhum resultado salvo"}</strong>
      <p>
        {isSyncing
          ? "Os resultados aparecerão aqui conforme forem salvos."
          : "Quando o cron centralizado salvar concursos desta loteria, eles aparecerão aqui automaticamente."}
      </p>
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
  availableDrawCount,
  availableDraws,
  customRange,
  data,
  isDuplaSena,
  recentWeightDisplayMode,
  selectedNumbers,
  onToggleNumber,
  onCustomRangeChange,
  onPeriodChange,
  onScopeChange,
  onViewChange,
  period,
  scope,
}: {
  activeView: AnalysisView;
  availableDrawCount: number;
  availableDraws: Draw[];
  customRange: AnalysisDrawRange;
  data: AnalysisData | null;
  isDuplaSena: boolean;
  recentWeightDisplayMode: RecencyScoreMode;
  onToggleNumber: (number: string) => void;
  onCustomRangeChange: (range: AnalysisDrawRange) => void;
  onPeriodChange: (period: AnalysisPeriod) => void;
  onScopeChange: (scope: DuplaSenaAnalysisScope) => void;
  onViewChange: (view: AnalysisView) => void;
  period: AnalysisPeriod;
  scope: DuplaSenaAnalysisScope;
  selectedNumbers: Set<string>;
}) {
  return (
    <details className="analysis-panel">
      <summary className="analysis-summary">
        <div>
          <span className="analysis-click-hint">Toque para abrir ou fechar</span>
          <strong>Análise rápida</strong>
          <p>{data ? getAnalysisDescription(activeView, data) : "Carregue resultados para ver a análise."}</p>
        </div>
      </summary>
      <div className="analysis-body" aria-label="Análise rápida dos resultados">
        <details className="analysis-options" open>
          <summary>
            <span>Ajustes</span>
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
                    <span className={option.value === "all" ? "period-option-range" : undefined}>{option.label}</span>
                  </button>
                ))}
              </div>
              {period === "all" ? (
                <RangeSliderCard
                  availableDrawCount={availableDrawCount}
                  draws={availableDraws}
                  range={customRange}
                  onRangeChange={onCustomRangeChange}
                />
              ) : null}
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
                    <span>{option.label}</span>
                    {option.value === "recent" && activeView === "recent" ? (
                      <span className="analysis-view-mode-indicator">({recentWeightDisplayMode === "float" ? 1 : 2})</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>

        {data ? (
          <AnalysisContent
            data={data}
            onToggleNumber={onToggleNumber}
            recentWeightDisplayMode={recentWeightDisplayMode}
            selectedNumbers={selectedNumbers}
            view={activeView}
          />
        ) : (
          <div className="analysis-empty">Carregue resultados para ver a análise.</div>
        )}
      </div>
    </details>
  );
}

function RangeSliderCard({
  availableDrawCount,
  draws,
  onRangeChange,
  range,
}: {
  availableDrawCount: number;
  draws: Draw[];
  onRangeChange: (range: AnalysisDrawRange) => void;
  range: AnalysisDrawRange;
}) {
  const maximum = Math.max(1, availableDrawCount);
  const start = Math.min(Math.max(range.start, 1), maximum);
  const end = Math.min(Math.max(range.end, 1), maximum);
  const selectedCount = Math.max(1, end - start + 1);
  const visualStart = maximum - end + 1;
  const visualEnd = maximum - start + 1;
  const visualStartPercent = maximum > 1 ? ((visualStart - 1) / (maximum - 1)) * 100 : 0;
  const visualEndPercent = maximum > 1 ? ((visualEnd - 1) / (maximum - 1)) * 100 : 100;
  const thumbSize = 20;
  const visualStartPosition = `calc(${visualStartPercent}% + ${thumbSize / 2 - (thumbSize * visualStartPercent) / 100}px)`;
  const visualEndPosition = `calc(${visualEndPercent}% + ${thumbSize / 2 - (thumbSize * visualEndPercent) / 100}px)`;
  const newestDraw = draws[start - 1] ?? null;
  const oldestDraw = draws[end - 1] ?? null;
  const canMoveOldestBackward = maximum > 1 && end < maximum;
  const canMoveOldestForward = maximum > 1 && end > start + 1;
  const canMoveNewestBackward = maximum > 1 && start < end - 1;
  const canMoveNewestForward = maximum > 1 && start > 1;

  function updateOldestBoundary(value: number) {
    const nextVisualStart = maximum > 1 ? Math.min(Math.max(value, 1), visualEnd - 1) : 1;
    onRangeChange({ end: maximum - nextVisualStart + 1, start });
  }

  function updateNewestBoundary(value: number) {
    const nextVisualEnd = maximum > 1 ? Math.max(Math.min(value, maximum), visualStart + 1) : 1;
    onRangeChange({ end, start: maximum - nextVisualEnd + 1 });
  }

  function moveOldestBoundary(offset: number) {
    onRangeChange({ end: end + offset, start });
  }

  function moveNewestBoundary(offset: number) {
    onRangeChange({ end, start: start + offset });
  }

  return (
    <div className="period-slider-card">
      <div className="period-slider-meta">
        <span>Ajustar</span>
        <strong>
          {selectedCount} {selectedCount === 1 ? "concurso" : "concursos"}
        </strong>
      </div>
      <div
        className="range-slider-shell"
        style={{
          "--range-end-position": visualEndPosition,
          "--range-start-position": visualStartPosition,
          "--slider-thumb-size": `${thumbSize}px`,
        } as CSSProperties}
      >
        <div className="range-slider-track" aria-hidden="true" />
        <input
          aria-label="Início mais antigo da faixa analisada"
          className="period-slider range-start"
          max={maximum}
          min={1}
          onChange={(event) => updateOldestBoundary(Number.parseInt(event.target.value, 10))}
          step={1}
          type="range"
          value={visualStart}
        />
        <input
          aria-label="Fim mais recente da faixa analisada"
          className="period-slider range-end"
          max={maximum}
          min={1}
          onChange={(event) => updateNewestBoundary(Number.parseInt(event.target.value, 10))}
          step={1}
          type="range"
          value={visualEnd}
        />
      </div>
      <div className="range-slider-values" aria-label="Limites cronológicos da faixa analisada">
        <div className="range-slider-value">
          <div className="range-slider-value-copy">
            <span>Início</span>
            <strong>
              {oldestDraw ? (
                <>
                  <span>{formatStatusDate(oldestDraw)}</span>
                  <span>Concurso {oldestDraw.drawNumber}</span>
                </>
              ) : (
                "Sem data"
              )}
            </strong>
          </div>
          <div className="range-precision-controls" aria-label="Ajuste fino do início">
            <button
              aria-label="Recuar início em 1 concurso"
              disabled={!canMoveOldestBackward}
              onClick={() => moveOldestBoundary(1)}
              title="Recuar início em 1 concurso"
              type="button"
            >
              -1
            </button>
            <button
              aria-label="Avançar início em 1 concurso"
              disabled={!canMoveOldestForward}
              onClick={() => moveOldestBoundary(-1)}
              title="Avançar início em 1 concurso"
              type="button"
            >
              +1
            </button>
          </div>
        </div>
        <div className="range-slider-value">
          <div className="range-slider-value-copy">
            <span>Fim</span>
            <strong>
              {newestDraw ? (
                <>
                  <span>{formatStatusDate(newestDraw)}</span>
                  <span>Concurso {newestDraw.drawNumber}</span>
                </>
              ) : (
                "Sem data"
              )}
            </strong>
          </div>
          <div className="range-precision-controls" aria-label="Ajuste fino do fim">
            <button
              aria-label="Recuar fim em 1 concurso"
              disabled={!canMoveNewestBackward}
              onClick={() => moveNewestBoundary(1)}
              title="Recuar fim em 1 concurso"
              type="button"
            >
              -1
            </button>
            <button
              aria-label="Avançar fim em 1 concurso"
              disabled={!canMoveNewestForward}
              onClick={() => moveNewestBoundary(-1)}
              title="Avançar fim em 1 concurso"
              type="button"
            >
              +1
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisContent({
  data,
  onToggleNumber,
  recentWeightDisplayMode,
  selectedNumbers,
  view,
}: {
  data: AnalysisData;
  onToggleNumber: (number: string) => void;
  recentWeightDisplayMode: RecencyScoreMode;
  selectedNumbers: Set<string>;
  view: AnalysisView;
}) {
  if (view === "map" || view === "recent") {
    return (
      <div className="analysis-scroll-area heat-map-scroll-area">
        <NumberHeatMap
          onToggleNumber={onToggleNumber}
          recentWeightDisplayMode={recentWeightDisplayMode}
          selectedNumbers={selectedNumbers}
          stats={data.stats}
          variant={view}
        />
      </div>
    );
  }

  const groups =
    view === "most"
      ? buildTrendGroups(data.stats, (item) => item.hits, "desc")
      : view === "least"
        ? buildTrendGroups(data.stats, (item) => item.hits, "asc")
        : buildTrendGroups(data.stats, (item) => item.overdue, "desc");

  return <TrendGroups groups={groups} onToggleNumber={onToggleNumber} selectedNumbers={selectedNumbers} view={view} />;
}

function TrendGroups({
  groups,
  onToggleNumber,
  selectedNumbers,
  view,
}: {
  groups: NumberTrendGroup[];
  onToggleNumber: (number: string) => void;
  selectedNumbers: Set<string>;
  view: AnalysisView;
}) {
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
              {group.items.map((item) => {
                const isSelected = selectedNumbers.has(item.number);
                const title = isSelected ? "Desmarcar número" : "Selecionar número";

                return (
                  <span
                    aria-label={`Selecionar número ${item.number}`}
                    aria-pressed={isSelected}
                    className={`trend-number-cloud-item ${isSelected ? "number-selected" : ""}`}
                    key={`${view}-${group.value}-${item.number}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleNumber(item.number);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleNumber(item.number);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={title}
                  >
                    {item.number}
                  </span>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function getHeatNumberStyle(intensity: number, isSelected: boolean) {
  const relativeIntensity = Math.min(Math.max(intensity, 0), 1);
  const hue = 222 - relativeIntensity * 184;
  const saturation = 72 + relativeIntensity * 18;
  const lightness = 14 + relativeIntensity * 48;
  const borderLightness = 34 + relativeIntensity * 32;
  const selectedGlow = 0.18 + relativeIntensity * 0.2;

  return {
    background: `linear-gradient(135deg, hsl(${hue} ${saturation}% ${lightness}%), hsl(${Math.max(18, hue - 18)} ${Math.min(95, saturation + 4)}% ${Math.max(18, lightness - 6)}%))`,
    borderColor: isSelected ? "var(--number-border-active)" : `hsl(${hue} ${Math.min(96, saturation + 6)}% ${borderLightness}%)`,
    boxShadow: isSelected ? `0 10px 24px rgba(251, 191, 36, ${selectedGlow})` : "none",
    color: relativeIntensity > 0.52 ? "#020617" : "#f8fafc",
  };
}

function NumberHeatMap({
  onToggleNumber,
  recentWeightDisplayMode,
  selectedNumbers,
  stats,
  variant,
}: {
  onToggleNumber: (number: string) => void;
  recentWeightDisplayMode: RecencyScoreMode;
  selectedNumbers: Set<string>;
  stats: NumberTrend[];
  variant: "map" | "recent";
}) {
  const getRecentDisplayScore = (item: NumberTrend) =>
    recentWeightDisplayMode === "rounded" ? Math.round(item.recencyScore) : item.recencyScore;
  const scores = stats.map((item) => (variant === "recent" ? getRecentDisplayScore(item) : item.hits));
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const scoreRange = Math.max(maxScore - minScore, 0);

  return (
    <div className="number-heat-map">
      {stats.map((item) => {
        const score = variant === "recent" ? getRecentDisplayScore(item) : item.hits;
        const isSelected = selectedNumbers.has(item.number);
        const relativeIntensity = scoreRange > 0 ? (score - minScore) / scoreRange : score ? 0.58 : 0;
        const recentScoreLabel = formatRecencyScore(item.recencyScore, recentWeightDisplayMode);
        const relativeLabel =
          variant === "recent"
            ? `peso recente ${recentScoreLabel}`
            : scoreRange > 0
              ? `${item.hits - minScore} acima do menor valor (${minScore}x)`
              : "";
        const title =
          variant === "recent"
            ? `${item.number}: ${item.hits} vez(es), ${relativeLabel}, atraso ${item.overdue}`
            : `${item.number}: ${item.hits} vez(es), atraso ${item.overdue}${relativeLabel ? ` · ${relativeLabel}` : ""}`;

        return (
          <div
            aria-label={`Selecionar número ${item.number}`}
            aria-pressed={isSelected}
            className={`heat-number ${isSelected ? "heat-number-selected" : ""}`}
            key={`${variant}-${item.number}`}
            onClick={() => onToggleNumber(item.number)}
            style={getHeatNumberStyle(relativeIntensity, isSelected)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleNumber(item.number);
              }
            }}
            title={isSelected ? "Desmarcar número" : title}
          >
            <strong>{item.number}</strong>
            <small>{variant === "recent" ? recentScoreLabel : `${item.hits}x`}</small>
          </div>
        );
      })}
    </div>
  );
}

function SuggestionPanel({
  activeView,
  data,
  games,
  lottery,
  onClear,
  onAddNumberGroup,
  onLucky,
  onReplaceOrClearNumberGroup,
  onSelectGame,
  selectedGameKey,
  onToggleNumber,
  selectedNumbers,
}: {
  activeView: AnalysisView;
  data: AnalysisData | null;
  games: SuggestedGame[];
  lottery: LotteryDefinition | null;
  onClear: () => void;
  onAddNumberGroup: (numbers: string[]) => void;
  onLucky: () => void;
  onReplaceOrClearNumberGroup: (numbers: string[]) => void;
  onSelectGame: (game: SuggestedGame) => void;
  selectedGameKey: string | null;
  onToggleNumber: (number: string) => void;
  selectedNumbers: Set<string>;
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
      <div className="suggestion-clear-row">
        {games.length ? (
          <button className="clear-suggestions-button" onClick={onClear} type="button">
            Limpar
          </button>
        ) : null}
      </div>
      <p className="suggestion-copy">{getSuggestionDescription(activeView, data)}</p>
      <div className="suggestion-list" aria-label="Sugestões baseadas na análise rápida">
        {games.length ? (
          games.map((game, index) => {
            const gameKey = getSuggestedGameKey(game);
            const selected = selectedGameKey === gameKey;
            const longPressHandlers = createNumberGroupLongPressHandlers(() => onAddNumberGroup(game.numbers));

            return (
              <div
                aria-label={`Selecionar e copiar sugestão ${game.numbers.join(" ")}`}
                aria-pressed={selected}
                className={`suggestion-game ${selected ? "active" : ""}`}
                key={gameKey}
                {...longPressHandlers}
                onClick={() => onSelectGame(game)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onReplaceOrClearNumberGroup(game.numbers);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectGame(game);
                  }
                }}
                tabIndex={0}
                title="Clique para copiar; clique duas vezes para selecionar só esta sugestão; segure para adicionar"
              >
                <div className="suggestion-game-meta">
                  <strong>{`Sugestão ${games.length - index}`}</strong>
                  <span>{game.sourceLabel}</span>
                </div>
                <div className="suggestion-numbers">
                  {game.numbers.map((number) => {
                    const isSelected = selectedNumbers.has(number);

                    return (
                      <button
                        aria-label={`Selecionar número ${number}`}
                        className={`suggestion-number ${isSelected ? "number-selected" : ""}`}
                        key={`${game.combinationKey}-${number}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleNumber(number);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleNumber(number);
                          }
                        }}
                        title={isSelected ? "Desmarcar número" : "Selecionar número"}
                        type="button"
                      >
                        {number}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          <em>
            {activeView === "recent"
              ? "Toque em “Estou com sorte” para usar os números mais recentes."
              : activeView === "map"
                ? "Toque em “Estou com sorte” para usar os números mais quentes do mapa."
                : "Toque em “Estou com sorte” para gerar sugestões únicas."}
          </em>
        )}
      </div>
    </article>
  );
}

function DrawList({
  draws,
  hasMore,
  onLoadMore,
  onSelect,
  onAddNumberGroup,
  onReplaceOrClearNumberGroup,
  onToggleNumber,
  selectedDrawNumber,
  selectedNumbers,
  totalCount,
  visibleCount,
}: {
  draws: Draw[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (draw: Draw) => void;
  onAddNumberGroup: (numbers: string[]) => void;
  onReplaceOrClearNumberGroup: (numbers: string[]) => void;
  onToggleNumber: (number: string) => void;
  selectedDrawNumber: number | null;
  selectedNumbers: Set<string>;
  totalCount: number;
  visibleCount: number;
}) {

  return (
    <div className="draw-list">
      {draws.map((draw, drawIndex) => {
        const groups = getDisplayGroups(draw);
        const drawGroupNumbers = groups.flat();
        const longPressHandlers = createNumberGroupLongPressHandlers(() => onAddNumberGroup(drawGroupNumbers));

        return (
          <div
            aria-label={`Selecionar e copiar concurso ${draw.drawNumber}`}
            aria-pressed={selectedDrawNumber === draw.drawNumber}
            className={`draw-row ${selectedDrawNumber === draw.drawNumber ? "active" : ""}`}
            key={`${draw.lottery}-${draw.drawNumber}`}
            {...longPressHandlers}
            onClick={() => onSelect(draw)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onReplaceOrClearNumberGroup(drawGroupNumbers);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(draw);
              }
            }}
            title="Clique para copiar; clique duas vezes para selecionar só este concurso; segure para adicionar"
            tabIndex={0}
          >
            <span className="draw-row-index">{drawIndex + 1}</span>
            <div className="draw-row-content">
              <div className="draw-row-meta">
                <span className="draw-row-number">#{draw.drawNumber}</span>
                <small className="draw-row-date">{draw.date}</small>
              </div>
              <strong className="draw-row-groups" aria-label={formatDrawNumbers(draw)}>
                {groups.map((group, groupIndex) => (
                  <span className="draw-number-group" key={`${draw.lottery}-${draw.drawNumber}-${groupIndex}`}>
                    {groups.length > 1 ? <span className="draw-group-label">{groupIndex + 1}º</span> : null}
                    <span className="draw-group-values">
                      {group.map((number) => {
                        const isSelected = selectedNumbers.has(number);

                        return (
                          <button
                            aria-label={`Selecionar número ${number}`}
                            className={`draw-number-pill ${isSelected ? "number-selected" : ""}`}
                            key={`${draw.lottery}-${draw.drawNumber}-${groupIndex}-${number}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleNumber(number);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggleNumber(number);
                              }
                            }}
                            title={isSelected ? "Desmarcar número" : "Selecionar número"}
                            type="button"
                          >
                            {number}
                          </button>
                        );
                      })}
                    </span>
                  </span>
                ))}
              </strong>
            </div>
          </div>
        );
      })}
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
