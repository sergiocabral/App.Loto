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
          <h1>Resultados das Loterias da Caixa.</h1>
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
                <strong>{drawCount ? "Buscar próximos" : "Montar base"}</strong>
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
                <span>Atual</span>
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
              <DrawSpotlight draw={selectedDraw ?? draws[0]} />
              <DrawList draws={visibleDraws} onSelect={setSelectedDraw} selectedDrawNumber={selectedDraw?.drawNumber ?? null} />
              {rawText ? (
                <details className="raw-output">
                  <summary>Ver formato texto legado</summary>
                  <div className="raw-output-actions">
                    <span>Texto gerado com os resultados salvos.</span>
                    <a className="legacy-link" href={legacyHref} rel="noreferrer" target="_blank">
                      Abrir em nova aba
                    </a>
                  </div>
                  <pre>{rawText}</pre>
                </details>
              ) : null}
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
