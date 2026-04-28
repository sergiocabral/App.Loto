"use client";

import Link from "next/link";
import { ResultsChatPanel } from "@/components/ResultsChatPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { LOTTERIES, getLottery, type LotteryDefinition } from "@/data/lotteries";
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
  getAnalysisDescription,
  getAnalysisViewLabel,
  getDisplayGroups,
  getSuggestionDescription,
  parseNumberFilter,
  type AnalysisData,
  type AnalysisPeriod,
  type AnalysisView,
  type DuplaSenaAnalysisScope,
  type NumberTrend,
  type NumberTrendGroup,
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
            draws: payload.draw ? [asClientDraw(payload.draw)] : [],
            selectedDraw: payload.draw ? asClientDraw(payload.draw) : null,
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

function buildUniqueLuckySuggestion(
  lottery: LotteryDefinition,
  view: AnalysisView,
  data: AnalysisData,
  existingKeys: Set<string>,
): string[] | null {
  const maxAttempts = 80;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const numbers = buildLuckySuggestion(lottery, view, data);
    const combinationKey = getCombinationKey(numbers);

    if (!existingKeys.has(combinationKey)) {
      return numbers;
    }
  }

  return null;
}

export function HomePage({ initialLotterySlug, initialDrawNumber }: HomePageProps) {
  const initialLottery = getInitialLottery(initialLotterySlug);
  const [selectedLottery, setSelectedLottery] = useState<LotteryDefinition | null>(initialLottery);
  const [drawNumberInput, setDrawNumberInput] = useState(initialDrawNumber ?? "");
  const [activeDrawNumber, setActiveDrawNumber] = useState(initialDrawNumber ?? "");
  const [draws, setDraws] = useState<Draw[]>([]);
  const [selectedDraw, setSelectedDraw] = useState<Draw | null>(null);
  const [status, setStatus] = useState<LoadState>(initialLottery ? "loading" : "idle");
  const [statusMessage, setStatusMessage] = useState(
    initialLottery ? "Carregando resultados..." : "Escolha uma loteria.",
  );
  const [lookupMode, setLookupMode] = useState<LookupMode>("numbers");
  const [numberFilter, setNumberFilter] = useState<string[]>([]);
  const [visibleDrawState, setVisibleDrawState] = useState({ key: "", limit: DRAW_LIST_PAGE_SIZE });
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>(25);
  const [customAnalysisDrawCount, setCustomAnalysisDrawCount] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("most");
  const [duplaSenaAnalysisScope, setDuplaSenaAnalysisScope] = useState<DuplaSenaAnalysisScope>("all");
  const [syncInfo, setSyncInfo] = useState<SyncInfo>(INITIAL_SYNC_INFO);
  const [suggestedGames, setSuggestedGames] = useState<SuggestedGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const syncStopRef = useRef(false);
  const syncSessionRef = useRef(0);
  const syncBaseFromCaixaRef = useRef<() => void>(() => {});
  const autoSyncStartedRef = useRef(new Set<string>());

  const isSyncing = syncInfo.running;
  const latestDraw = draws[0] ?? selectedDraw;
  const drawCount = draws.length || (selectedDraw ? 1 : 0);
  const canSyncFromCaixa = Boolean(selectedLottery && status !== "loading" && (isSyncing || !activeDrawNumber.trim()));
  const canClearLookupFilter = Boolean(drawNumberInput.trim() || activeDrawNumber.trim() || numberFilter.length);

  const filteredDraws = useMemo(() => draws.filter((draw) => drawContainsNumbers(draw, numberFilter)), [draws, numberFilter]);
  const numberFilterKey = numberFilter.join("|");
  const drawListKey = `${selectedLottery?.slug ?? ""}|${activeDrawNumber}|${numberFilterKey}`;
  const visibleDrawLimit = visibleDrawState.key === drawListKey ? visibleDrawState.limit : DRAW_LIST_PAGE_SIZE;
  const visibleDraws = useMemo(() => filteredDraws.slice(0, visibleDrawLimit), [filteredDraws, visibleDrawLimit]);
  const hasMoreDraws = visibleDrawLimit < filteredDraws.length;
  const analysisSourceDraws = numberFilter.length || activeDrawNumber.trim() ? filteredDraws : draws;
  const availableAnalysisDrawCount = Math.max(1, analysisSourceDraws.length || drawCount);
  const effectiveCustomAnalysisDrawCount = Math.min(
    Math.max(customAnalysisDrawCount ?? availableAnalysisDrawCount, 1),
    availableAnalysisDrawCount,
  );
  const analysisData = useMemo(
    () =>
      buildAnalysisData(
        analysisSourceDraws,
        selectedLottery,
        analysisPeriod,
        selectedLottery?.slug === "DuplaSena" ? duplaSenaAnalysisScope : "all",
        analysisPeriod === "all" ? effectiveCustomAnalysisDrawCount : undefined,
      ),
    [analysisPeriod, analysisSourceDraws, duplaSenaAnalysisScope, effectiveCustomAnalysisDrawCount, selectedLottery],
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
  const visibleSuggestedGames = useMemo(
    () => suggestedGames.filter((game) => selectedLottery && game.lotterySlug === selectedLottery.slug),
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
        setStatusMessage(requestedDrawNumber ? `Consultando concurso ${requestedDrawNumber}...` : "Carregando resultados...");
      }

      try {
        const loadedData = await loadLotteryDataOnce(lottery.slug, requestedDrawNumber);

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

  function selectLottery(lottery: LotteryDefinition) {
    syncStopRef.current = true;
    syncSessionRef.current += 1;
    setSelectedLottery(lottery);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setDraws([]);
    setSelectedDraw(null);
    setError(null);
    setStatus("loading");
    setStatusMessage("Preparando...");
    setLookupMode("numbers");
    setNumberFilter([]);
    setCustomAnalysisDrawCount(null);
    setSyncInfo(INITIAL_SYNC_INFO);
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
        setStatusMessage("Informe números válidos para filtrar.");
        return;
      }

      setNumberFilter(parsedNumbers);
      setSelectedDraw(null);
      setActiveDrawNumber("");
      updateLegacyUrl(selectedLottery.slug);
      setStatusMessage(`Filtro aplicado: ${parsedNumbers.join(", ")}.`);
      return;
    }

    setNumberFilter([]);
    setActiveDrawNumber(trimmed);
    updateLegacyUrl(selectedLottery.slug, trimmed || undefined);
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

    const history = asClientDraws(payload.draws ?? payload.sync.draws ?? []);
    const loadedData = cacheHistoryData(lottery.slug, history, payload.text ?? "", getHistoryStatusMessage(history));
    setDraws(loadedData.draws);
    setSelectedDraw((current) => {
      if (!current) {
        return loadedData.selectedDraw;
      }

      return loadedData.draws.find((draw) => draw.drawNumber === current.drawNumber) ?? loadedData.selectedDraw;
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

  useEffect(() => {
    syncBaseFromCaixaRef.current = syncBaseFromCaixa;
  });

  useEffect(() => {
    if (!selectedLottery || activeDrawNumber.trim() || status === "loading" || status === "error" || syncInfo.running) {
      return;
    }

    if (autoSyncStartedRef.current.has(selectedLottery.slug)) {
      return;
    }

    autoSyncStartedRef.current.add(selectedLottery.slug);
    void syncBaseFromCaixaRef.current();
  }, [activeDrawNumber, selectedLottery, status, syncInfo.running]);

  function changeAnalysisPeriod(period: AnalysisPeriod) {
    setAnalysisPeriod(period);
  }

  function changeCustomAnalysisDrawCount(count: number) {
    const normalizedCount = Number.isFinite(count) ? Math.round(count) : availableAnalysisDrawCount;
    setCustomAnalysisDrawCount(Math.min(Math.max(normalizedCount, 1), availableAnalysisDrawCount));
  }

  function changeAnalysisView(view: AnalysisView) {
    setAnalysisView(view);
  }

  function changeDuplaSenaAnalysisScope(scope: DuplaSenaAnalysisScope) {
    setDuplaSenaAnalysisScope(scope);
  }

  function generateLuckySuggestion() {
    if (!selectedLottery || !analysisData || !suggestionKey) {
      return;
    }

    const existingKeys = new Set(
      suggestedGames
        .filter((game) => game.lotterySlug === selectedLottery.slug)
        .map((game) => game.combinationKey),
    );
    const numbers = buildUniqueLuckySuggestion(selectedLottery, analysisView, analysisData, existingKeys);

    if (!numbers) {
      setStatusMessage("Não encontrei uma nova combinação diferente para este filtro.");
      return;
    }

    setSuggestedGames((current) => [
      {
        combinationKey: getCombinationKey(numbers),
        filterKey: suggestionKey,
        lotterySlug: selectedLottery.slug,
        numbers,
        sourceLabel: getSuggestionSourceLabel(analysisView, analysisData),
      },
      ...current,
    ]);
    setStatusMessage("Nova sugestão adicionada.");
  }

  function clearSuggestedGames() {
    if (!selectedLottery) {
      setSuggestedGames([]);
      return;
    }

    setSuggestedGames((current) => current.filter((game) => game.lotterySlug !== selectedLottery.slug));
    setStatusMessage("Sugestões limpas.");
  }

  function returnToHome() {
    syncStopRef.current = true;
    syncSessionRef.current += 1;
    autoSyncStartedRef.current.clear();
    setSelectedLottery(null);
    setDrawNumberInput("");
    setActiveDrawNumber("");
    setDraws([]);
    setSelectedDraw(null);
    setStatus("idle");
    setStatusMessage("Escolha uma loteria.");
    setLookupMode("numbers");
    setNumberFilter([]);
    setVisibleDrawState({ key: "", limit: DRAW_LIST_PAGE_SIZE });
    setAnalysisPeriod(25);
    setCustomAnalysisDrawCount(null);
    setAnalysisView("most");
    setDuplaSenaAnalysisScope("all");
    setSyncInfo(INITIAL_SYNC_INFO);
    setError(null);
    updateLegacyUrl();
  }

  return (
    <>
      <div className="dashboard">
      <section className="hero-card">
        <div>
          <Link aria-label="Voltar para o início sem loteria selecionada" className="brand-home" href="/" onClick={returnToHome}>
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

          <div className={`sync-panel ${syncInfo.running ? "running" : ""}`}>
            <button
              className="sync-button"
              disabled={!canSyncFromCaixa || syncInfo.stopRequested}
              onClick={syncInfo.running ? requestStopSyncFromCaixa : syncBaseFromCaixa}
              type="button"
            >
              {syncInfo.running ? (syncInfo.stopRequested ? "Pausando..." : "Pausar carregamento") : "Carregar resultados"}
            </button>
            <div className="sync-latest-result">
              <span>Último</span>
              <strong>{latestDraw ? `${latestDraw.drawNumber} · ${formatStatusDate(latestDraw)}` : "nenhum resultado carregado"}</strong>
            </div>
          </div>

          <ResultsChatPanel
            activeDrawNumber={activeDrawNumber}
            analysisData={analysisData}
            analysisViewLabel={getAnalysisViewLabel(analysisView)}
            draws={analysisData?.selectedDraws ?? []}
            isLoading={status === "loading"}
            lottery={selectedLottery}
            numberFilter={numberFilter}
          />
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
            <div className="results-actions">
              <a className="legacy-link results-link" href={legacyHref} rel="noreferrer" target="_blank">
                Ver todos os sorteios
              </a>
              {statusMessage ? <div className={`status-badge ${status}`}>{statusMessage}</div> : null}
            </div>
          </div>

          {status === "loading" ? <LoadingState /> : null}
          {status === "error" ? <ErrorState message={error ?? "Erro ao carregar."} /> : null}
          {status !== "loading" && status !== "error" && draws.length === 0 ? (
            <NoResultsState isSyncing={isSyncing} onStartSync={syncBaseFromCaixa} />
          ) : null}
          {status !== "loading" && status !== "error" && draws.length > 0 ? (
            <>
              <SuggestionPanel
                activeView={analysisView}
                data={analysisData}
                lottery={selectedLottery}
                games={visibleSuggestedGames}
                onClear={clearSuggestedGames}
                onLucky={generateLuckySuggestion}
              />
              <AnalysisPanel
                activeView={analysisView}
                availableDrawCount={availableAnalysisDrawCount}
                customDrawCount={effectiveCustomAnalysisDrawCount}
                data={analysisData}
                isDuplaSena={selectedLottery?.slug === "DuplaSena"}
                onCustomDrawCountChange={changeCustomAnalysisDrawCount}
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
  availableDrawCount,
  customDrawCount,
  data,
  isDuplaSena,
  onCustomDrawCountChange,
  onPeriodChange,
  onScopeChange,
  onViewChange,
  period,
  scope,
}: {
  activeView: AnalysisView;
  availableDrawCount: number;
  customDrawCount: number;
  data: AnalysisData | null;
  isDuplaSena: boolean;
  onCustomDrawCountChange: (count: number) => void;
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
          <span className="analysis-click-hint">Toque para abrir ou fechar</span>
          <strong>Análise rápida</strong>
          <p>{data ? getAnalysisDescription(activeView, data) : "Carregue resultados para ver a análise."}</p>
        </div>
      </summary>
      <div className="analysis-body" aria-label="Análise rápida dos resultados">
        <details className="analysis-options" open>
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
              {period === "all" ? (
                <div className="period-slider-card">
                  <div className="period-slider-meta">
                    <span>Quantidade de sorteios</span>
                    <strong>{customDrawCount} de {availableDrawCount} concursos</strong>
                  </div>
                  <input
                    aria-label="Quantidade de sorteios analisados"
                    className="period-slider"
                    max={availableDrawCount}
                    min={1}
                    onChange={(event) => onCustomDrawCountChange(Number.parseInt(event.target.value, 10))}
                    type="range"
                    value={customDrawCount}
                  />
                  <p>Arraste para escolher qualquer quantidade dentro do histórico carregado.</p>
                </div>
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
  games,
  lottery,
  onClear,
  onLucky,
}: {
  activeView: AnalysisView;
  data: AnalysisData | null;
  games: SuggestedGame[];
  lottery: LotteryDefinition | null;
  onClear: () => void;
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
        <div className="suggestion-actions">
          {games.length ? (
            <button className="clear-suggestions-button" onClick={onClear} type="button">
              Limpar
            </button>
          ) : null}
          <button className="lucky-button" onClick={onLucky} type="button">
            Estou com sorte
          </button>
        </div>
      </div>
      <p className="suggestion-copy">{getSuggestionDescription(activeView, data)}</p>
      <div className="suggestion-list" aria-label="Sugestões baseadas na análise rápida">
        {games.length ? (
          games.map((game, index) => (
            <div className="suggestion-game" key={`${game.lotterySlug}-${game.combinationKey}`}>
              <div className="suggestion-game-meta">
                <strong>{index === 0 ? "Nova sugestão" : `Sugestão ${games.length - index}`}</strong>
                <span>{game.sourceLabel}</span>
              </div>
              <div className="suggestion-numbers">
                {game.numbers.map((number) => (
                  <span key={`${game.combinationKey}-${number}`}>{number}</span>
                ))}
              </div>
            </div>
          ))
        ) : (
          <em>Toque em “Estou com sorte” para gerar sugestões únicas.</em>
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
      {draws.map((draw) => {
        const groups = getDisplayGroups(draw);

        return (
          <button
            className={`draw-row ${selectedDrawNumber === draw.drawNumber ? "active" : ""}`}
            key={`${draw.lottery}-${draw.drawNumber}`}
            onClick={() => onSelect(draw)}
            type="button"
          >
            <span className="draw-row-number">#{draw.drawNumber}</span>
            <strong className="draw-row-groups" aria-label={formatDrawNumbers(draw)}>
              {groups.map((group, groupIndex) => (
                <span className="draw-number-group" key={`${draw.lottery}-${draw.drawNumber}-${groupIndex}`}>
                  {groups.length > 1 ? <span className="draw-group-label">{groupIndex + 1}º</span> : null}
                  <span className="draw-group-values">
                    {group.map((number) => (
                      <span className="draw-number-pill" key={`${draw.lottery}-${draw.drawNumber}-${groupIndex}-${number}`}>
                        {number}
                      </span>
                    ))}
                  </span>
                </span>
              ))}
            </strong>
            <small className="draw-row-date">{draw.date}</small>
          </button>
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
