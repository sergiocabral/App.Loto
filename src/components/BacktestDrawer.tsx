"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import {
  ANALYSIS_VIEW_OPTIONS,
  buildBacktestSnapshot,
  getAnalysisViewLabel,
  type AnalysisDrawRange,
  type AnalysisPeriod,
  type AnalysisView,
  type DuplaSenaAnalysisScope,
  type RecencyScoreMode,
} from "@/lib/analysis";
import type { Draw } from "@/lib/types";

type BacktestDrawerProps = {
  open: boolean;
  onClose: () => void;
  draws: Draw[];
  lottery: LotteryDefinition | null;
  view: AnalysisView;
  period: AnalysisPeriod;
  customRange?: AnalysisDrawRange;
  scope: DuplaSenaAnalysisScope;
  recencyScoreMode: RecencyScoreMode;
};

type RankingEntry = {
  view: AnalysisView;
  label: string;
  hitCount: number;
};

type BacktestScanResults = {
  cutoffsCount: number;
  rankings: Array<{ view: AnalysisView; label: string; totalHits: number; bestHits: number }>;
};

const MAX_CUTOFFS_FOR_SCAN = 50;

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function getEligibleCutoffs(draws: Draw[]): Draw[] {
  if (draws.length < 2) {
    return [];
  }

  return draws.slice(1);
}

function formatHitCountLabel(hitCount: number): string {
  return `${hitCount} ${hitCount === 1 ? "acerto" : "acertos"}`;
}

export function BacktestDrawer({
  customRange,
  draws,
  lottery,
  onClose,
  open,
  period,
  recencyScoreMode,
  scope,
  view,
}: BacktestDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  const eligibleCutoffs = useMemo(() => getEligibleCutoffs(draws), [draws]);
  const [cutoffDrawNumber, setCutoffDrawNumber] = useState<number | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanResults, setScanResults] = useState<(BacktestScanResults & { contextKey: string }) | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      previousActiveElement?.focus();
    };
  }, [open]);

  const activeCutoffDrawNumber = useMemo(() => {
    if (!eligibleCutoffs.length) {
      return null;
    }

    const exists = eligibleCutoffs.some((draw) => draw.drawNumber === cutoffDrawNumber);

    if (exists) {
      return cutoffDrawNumber;
    }

    return eligibleCutoffs[0].drawNumber;
  }, [cutoffDrawNumber, eligibleCutoffs]);

  const scanContextKey = useMemo(() => {
    const newestDrawNumber = draws[0]?.drawNumber ?? "none";
    const oldestDrawNumber = draws[draws.length - 1]?.drawNumber ?? "none";
    const rangeKey = customRange ? `${customRange.start}-${customRange.end}` : "default";

    return [lottery?.slug ?? "none", draws.length, newestDrawNumber, oldestDrawNumber, period, rangeKey, scope, recencyScoreMode].join("|");
  }, [customRange, draws, lottery, period, recencyScoreMode, scope]);

  const visibleScanResults = scanResults?.contextKey === scanContextKey ? scanResults : null;

  const activeSnapshot = useMemo(() => {
    if (!lottery || activeCutoffDrawNumber === null) {
      return null;
    }

    return buildBacktestSnapshot(draws, lottery, activeCutoffDrawNumber, view, period, scope, () => 0, recencyScoreMode, customRange);
  }, [activeCutoffDrawNumber, customRange, draws, lottery, period, recencyScoreMode, scope, view]);

  const ranking = useMemo<RankingEntry[]>(() => {
    if (!lottery || activeCutoffDrawNumber === null) {
      return [];
    }

    return ANALYSIS_VIEW_OPTIONS.map((option) => {
      const snapshot = buildBacktestSnapshot(
        draws,
        lottery,
        activeCutoffDrawNumber,
        option.value,
        period,
        scope,
        () => 0,
        recencyScoreMode,
        customRange,
      );

      return {
        view: option.value,
        label: option.label,
        hitCount: snapshot?.hits.length ?? 0,
      };
    }).sort((left, right) => right.hitCount - left.hitCount || left.label.localeCompare(right.label));
  }, [activeCutoffDrawNumber, customRange, draws, lottery, period, recencyScoreMode, scope]);

  const bestRankingHits = ranking[0]?.hitCount ?? 0;

  function handleCutoffChange(value: string) {
    const numeric = Number.parseInt(value, 10);
    setCutoffDrawNumber(Number.isFinite(numeric) ? numeric : null);
  }

  function handleScan() {
    if (!lottery || !eligibleCutoffs.length) {
      return;
    }

    setScanRunning(true);

    const cutoffSlice = eligibleCutoffs.slice(0, MAX_CUTOFFS_FOR_SCAN);
    const totals = new Map<AnalysisView, { totalHits: number; bestHits: number }>();

    for (const option of ANALYSIS_VIEW_OPTIONS) {
      totals.set(option.value, { totalHits: 0, bestHits: 0 });
    }

    for (const draw of cutoffSlice) {
      for (const option of ANALYSIS_VIEW_OPTIONS) {
        const snapshot = buildBacktestSnapshot(
          draws,
          lottery,
          draw.drawNumber,
          option.value,
          period,
          scope,
          () => 0,
          recencyScoreMode,
          customRange,
        );

        if (!snapshot || !snapshot.actualNextDraw) {
          continue;
        }

        const hits = snapshot.hits.length;
        const previous = totals.get(option.value) ?? { totalHits: 0, bestHits: 0 };
        totals.set(option.value, {
          totalHits: previous.totalHits + hits,
          bestHits: Math.max(previous.bestHits, hits),
        });
      }
    }

    const rankings = ANALYSIS_VIEW_OPTIONS.map((option) => {
      const totalsForView = totals.get(option.value) ?? { totalHits: 0, bestHits: 0 };
      return {
        view: option.value,
        label: option.label,
        totalHits: totalsForView.totalHits,
        bestHits: totalsForView.bestHits,
      };
    }).sort((left, right) => right.totalHits - left.totalHits || right.bestHits - left.bestHits);

    setScanResults({ contextKey: scanContextKey, cutoffsCount: cutoffSlice.length, rankings });
    setScanRunning(false);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="backtest-drawer__root">
      <button aria-label="Fechar teste histórico" className="backtest-drawer__backdrop" onClick={onClose} type="button" />
      <div aria-labelledby="backtest-title" aria-modal="true" className="backtest-drawer__panel" role="dialog">
        <header className="backtest-drawer__header">
          <div>
            <span className="eyebrow">Backtest</span>
            <h2 id="backtest-title">Testar no passado</h2>
            {lottery ? <p>{formatLotteryName(lottery.slug)}</p> : null}
          </div>
          <button aria-label="Fechar teste histórico" className="backtest-drawer__close" onClick={onClose} ref={closeButtonRef} type="button">
            X
          </button>
        </header>
        <div className="backtest-drawer__body">
          {!eligibleCutoffs.length ? (
            <div className="backtest-drawer__placeholder">
              <strong>Sem concursos suficientes para testar</strong>
              <span className="backtest-drawer__meta">Carregue mais resultados para usar o teste histórico.</span>
            </div>
          ) : (
            <>
              <BacktestCutoffPicker
                cutoffs={eligibleCutoffs}
                onChange={handleCutoffChange}
                value={activeCutoffDrawNumber}
              />
              {activeSnapshot ? (
                <BacktestSnapshotCard
                  bestRankingHits={bestRankingHits}
                  ranking={ranking}
                  snapshot={activeSnapshot}
                  view={view}
                />
              ) : null}
              <BacktestScanCard
                cutoffsAvailable={Math.min(eligibleCutoffs.length, MAX_CUTOFFS_FOR_SCAN)}
                eligibleTotal={eligibleCutoffs.length}
                onRun={handleScan}
                results={visibleScanResults}
                running={scanRunning}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type BacktestCutoffPickerProps = {
  cutoffs: Draw[];
  onChange: (value: string) => void;
  value: number | null;
};

function BacktestCutoffPicker({ cutoffs, onChange, value }: BacktestCutoffPickerProps) {
  return (
    <section aria-label="Selecionar concurso de corte" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Voltar para</h3>
        <span className="backtest-drawer__section-hint">
          Posicione-se em um concurso passado: a sugestão será baseada apenas nos resultados anteriores e o resultado seguinte real é usado para conferir os acertos.
        </span>
      </header>
      <label className="backtest-drawer__field">
        <span>Concurso de corte</span>
        <select
          aria-label="Concurso de corte"
          className="backtest-drawer__select"
          onChange={(event) => onChange(event.target.value)}
          value={value ?? ""}
        >
          {cutoffs.map((draw) => (
            <option key={draw.drawNumber} value={draw.drawNumber}>
              Concurso {draw.drawNumber} · {draw.date}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

type BacktestSnapshotCardProps = {
  bestRankingHits: number;
  ranking: RankingEntry[];
  snapshot: NonNullable<ReturnType<typeof buildBacktestSnapshot>>;
  view: AnalysisView;
};

function BacktestSnapshotCard({ bestRankingHits, ranking, snapshot, view }: BacktestSnapshotCardProps) {
  const activeViewLabel = getAnalysisViewLabel(view);
  const actualNextDraw = snapshot.actualNextDraw;
  const analysisLabel = snapshot.analysisData
    ? `${snapshot.analysisData.periodLabel} · ${snapshot.analysisData.scopeLabel}`
    : "sem histórico suficiente";
  const hitCount = snapshot.hits.length;
  const suggestionEmpty = snapshot.suggestion.length === 0;

  return (
    <section aria-label="Sugestão e conferência" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Sugestão para o concurso seguinte</h3>
        <span className="backtest-drawer__section-hint">
          Filtro ativo: <strong>{activeViewLabel}</strong>. Parâmetros: <strong>{analysisLabel}</strong>.
        </span>
      </header>

      {suggestionEmpty ? (
        <p className="backtest-drawer__empty">Não há histórico suficiente até esse concurso para gerar sugestão.</p>
      ) : (
        <>
          <div className="backtest-drawer__numbers" aria-label="Números sugeridos">
            {snapshot.suggestion.map((number) => {
              const isHit = snapshot.hits.includes(number);
              return (
                <span
                  key={number}
                  aria-label={isHit ? `${number} (acertou)` : `${number} (não saiu)`}
                  className={`suggestion-number backtest-drawer__number ${isHit ? "is-hit" : "is-miss"}`}
                >
                  {number}
                </span>
              );
            })}
          </div>

          {actualNextDraw ? (
            <p className="backtest-drawer__result">
              Próximo sorteio real: <strong>concurso {actualNextDraw.drawNumber}</strong> em {actualNextDraw.date}. Acertos:{" "}
              <strong>{formatHitCountLabel(hitCount)}</strong>
              {bestRankingHits > 0 ? ` · melhor visão neste corte: ${formatHitCountLabel(bestRankingHits)}` : ""}.
            </p>
          ) : (
            <p className="backtest-drawer__result">Esse é o último concurso conhecido — não há próximo sorteio para conferir.</p>
          )}
        </>
      )}

      {ranking.length ? (
        <div className="backtest-drawer__ranking" aria-label="Ranking de visões neste corte">
          <h4>Ranking neste corte</h4>
          <ol>
            {ranking.map((entry) => (
              <li key={entry.view} className={entry.view === view ? "is-active" : ""}>
                <span className="backtest-drawer__ranking-label">{entry.label}</span>
                <span className="backtest-drawer__ranking-hits">{formatHitCountLabel(entry.hitCount)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

type BacktestScanCardProps = {
  cutoffsAvailable: number;
  eligibleTotal: number;
  onRun: () => void;
  results: {
    cutoffsCount: number;
    rankings: Array<{ view: AnalysisView; label: string; totalHits: number; bestHits: number }>;
  } | null;
  running: boolean;
};

function BacktestScanCard({ cutoffsAvailable, eligibleTotal, onRun, results, running }: BacktestScanCardProps) {
  return (
    <section aria-label="Varredura em vários concursos" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Qual filtro foi mais eficaz?</h3>
        <span className="backtest-drawer__section-hint">
          Aplica cada visão (Mais sorteados, Menos sorteados, Atrasados, Mais frequentes, Mais recentes) em até{" "}
          <strong>{cutoffsAvailable}</strong> concursos passados {eligibleTotal > cutoffsAvailable ? `(de ${eligibleTotal} disponíveis)` : ""} e soma os
          acertos.
        </span>
      </header>

      <button
        className="backtest-drawer__run"
        disabled={running || cutoffsAvailable === 0}
        onClick={onRun}
        type="button"
      >
        {running ? "Calculando..." : results ? "Recalcular ranking" : "Calcular ranking"}
      </button>

      {results ? (
        <div className="backtest-drawer__ranking" aria-label="Ranking acumulado de visões">
          <h4>Resultado em {results.cutoffsCount} concursos</h4>
          <ol>
            {results.rankings.map((entry, index) => {
              const average = results.cutoffsCount ? entry.totalHits / results.cutoffsCount : 0;
              const averageLabel = average ? average.toFixed(2).replace(".", ",") : "0";
              return (
                <li key={entry.view} className={index === 0 ? "is-active" : ""}>
                  <span className="backtest-drawer__ranking-label">{entry.label}</span>
                  <span className="backtest-drawer__ranking-hits">
                    {formatHitCountLabel(entry.totalHits)} · média {averageLabel} · melhor {formatHitCountLabel(entry.bestHits)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
