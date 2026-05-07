"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import { ANALYSIS_VIEW_OPTIONS, type AnalysisDrawRange, type AnalysisPeriod, type AnalysisView } from "@/lib/analysis";
import type { Draw } from "@/lib/types";

type BacktestDrawerProps = {
  open: boolean;
  onClose: () => void;
  draws: Draw[];
  lottery: LotteryDefinition | null;
  quickAnalysisPeriod: AnalysisPeriod;
  quickAnalysisView: AnalysisView;
  quickCustomRange: AnalysisDrawRange;
};

type SimulatorPeriodPreset = 10 | 25 | 50 | 100 | "custom";

const SIMULATOR_PERIOD_OPTIONS: Array<{ value: SimulatorPeriodPreset; label: string }> = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "custom", label: "Ajustar" },
];

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function getEligibleCutoffs(draws: Draw[]): Draw[] {
  if (draws.length < 2) {
    return [];
  }

  return draws.slice(1);
}

function clampPeriodCount(value: number, maximum: number): number {
  const normalizedMaximum = Math.max(1, maximum);
  const roundedValue = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(Math.max(roundedValue, 1), normalizedMaximum);
}

function getCustomRangeCount(range: AnalysisDrawRange): number {
  return Math.max(1, Math.round(range.end) - Math.round(range.start) + 1);
}

export function BacktestDrawer({
  draws,
  lottery,
  onClose,
  open,
  quickAnalysisPeriod,
  quickAnalysisView,
  quickCustomRange,
}: BacktestDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);

  const eligibleCutoffs = useMemo(() => getEligibleCutoffs(draws), [draws]);
  const [cutoffDrawNumber, setCutoffDrawNumber] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>("most");
  const [periodPreset, setPeriodPreset] = useState<SimulatorPeriodPreset>(10);
  const [customPeriodCount, setCustomPeriodCount] = useState(1);

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

  const availableAnalysisDrawCount = useMemo(() => {
    if (activeCutoffDrawNumber === null) {
      return 0;
    }

    const cutoffIndex = draws.findIndex((draw) => draw.drawNumber === activeCutoffDrawNumber);
    return cutoffIndex >= 0 ? draws.length - cutoffIndex : 0;
  }, [activeCutoffDrawNumber, draws]);

  useEffect(() => {
    setCustomPeriodCount(clampPeriodCount(availableAnalysisDrawCount, availableAnalysisDrawCount));
  }, [availableAnalysisDrawCount]);

  useEffect(() => {
    const isOpening = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (!isOpening) {
      return;
    }

    setAnalysisView(quickAnalysisView);

    if (quickAnalysisPeriod === "all") {
      setPeriodPreset("custom");
      setCustomPeriodCount(clampPeriodCount(getCustomRangeCount(quickCustomRange), availableAnalysisDrawCount));
      return;
    }

    setPeriodPreset(quickAnalysisPeriod);
    setCustomPeriodCount(clampPeriodCount(availableAnalysisDrawCount, availableAnalysisDrawCount));
  }, [availableAnalysisDrawCount, open, quickAnalysisPeriod, quickAnalysisView, quickCustomRange]);

  function handleCutoffChange(value: string) {
    const numeric = Number.parseInt(value, 10);
    setCutoffDrawNumber(Number.isFinite(numeric) ? numeric : null);
  }

  function handleCustomPeriodCountChange(value: number) {
    setPeriodPreset("custom");
    setCustomPeriodCount(clampPeriodCount(value, availableAnalysisDrawCount));
  }

  if (!open) {
    return null;
  }

  return (
    <div className="backtest-drawer__root">
      <button aria-label="Fechar simulador" className="backtest-drawer__backdrop" onClick={onClose} type="button" />
      <div aria-labelledby="backtest-title" aria-modal="true" className="backtest-drawer__panel" role="dialog">
        <header className="backtest-drawer__header">
          <div>
            <span className="eyebrow">Simulador</span>
            <h2 id="backtest-title">Sorteios anteriores</h2>
            {lottery ? <p>{formatLotteryName(lottery.slug)}</p> : null}
          </div>
          <button aria-label="Fechar simulador" className="backtest-drawer__close" onClick={onClose} ref={closeButtonRef} type="button">
            X
          </button>
        </header>
        <div className="backtest-drawer__body">
          {!eligibleCutoffs.length ? (
            <div className="backtest-drawer__placeholder">
              <strong>Sem concursos anteriores suficientes</strong>
              <span className="backtest-drawer__meta">Carregue mais resultados para usar o simulador.</span>
            </div>
          ) : (
            <>
              <BacktestCutoffPicker
                cutoffs={eligibleCutoffs}
                onChange={handleCutoffChange}
                value={activeCutoffDrawNumber}
              />
              <BacktestAnalysisParameters
                analysisView={analysisView}
                availableDrawCount={availableAnalysisDrawCount}
                customPeriodCount={customPeriodCount}
                onAnalysisViewChange={setAnalysisView}
                onCustomPeriodCountChange={handleCustomPeriodCountChange}
                onPeriodPresetChange={setPeriodPreset}
                periodPreset={periodPreset}
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
          Posicione-se em um concurso passado para consultar a lista de sorteios anteriores.
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

type BacktestAnalysisParametersProps = {
  analysisView: AnalysisView;
  availableDrawCount: number;
  customPeriodCount: number;
  onAnalysisViewChange: (view: AnalysisView) => void;
  onCustomPeriodCountChange: (count: number) => void;
  onPeriodPresetChange: (period: SimulatorPeriodPreset) => void;
  periodPreset: SimulatorPeriodPreset;
};

function BacktestAnalysisParameters({
  analysisView,
  availableDrawCount,
  customPeriodCount,
  onAnalysisViewChange,
  onCustomPeriodCountChange,
  onPeriodPresetChange,
  periodPreset,
}: BacktestAnalysisParametersProps) {
  const maximum = Math.max(1, availableDrawCount);
  const selectedPeriodCount = periodPreset === "custom" ? customPeriodCount : Math.min(periodPreset, maximum);
  const canDecrease = customPeriodCount > 1;
  const canIncrease = customPeriodCount < maximum;

  function handlePeriodPresetChange(value: SimulatorPeriodPreset) {
    onPeriodPresetChange(value);

    if (value !== "custom") {
      return;
    }

    onCustomPeriodCountChange(maximum);
  }

  return (
    <section aria-label="Parâmetros da análise" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Parâmetros da análise</h3>
        <span className="backtest-drawer__section-hint">
          Janela anterior ao concurso de corte e visão estatística para a próxima etapa.
        </span>
      </header>

      <div className="backtest-drawer__control-stack">
        <div className="control-group">
          <span>Período</span>
          <div className="segmented-control compact" aria-label="Quantidade de concursos anteriores">
            {SIMULATOR_PERIOD_OPTIONS.map((option) => (
              <button
                className={periodPreset === option.value ? "active" : ""}
                key={String(option.value)}
                onClick={() => handlePeriodPresetChange(option.value)}
                type="button"
              >
                <span className={option.value === "custom" ? "period-option-range" : undefined}>{option.label}</span>
              </button>
            ))}
          </div>

          {periodPreset === "custom" ? (
            <div className="period-slider-card">
              <div className="period-slider-meta">
                <span>Ajustar</span>
                <strong>
                  {customPeriodCount} {customPeriodCount === 1 ? "concurso" : "concursos"}
                </strong>
              </div>
              <input
                aria-label="Quantidade de concursos anteriores ao corte"
                className="period-slider"
                max={maximum}
                min={1}
                onChange={(event) => onCustomPeriodCountChange(Number.parseInt(event.target.value, 10))}
                step={1}
                type="range"
                value={customPeriodCount}
              />
              <div className="backtest-drawer__period-controls">
                <div className="range-precision-controls" aria-label="Ajuste fino do período">
                  <button
                    aria-label="Reduzir período em 1 concurso"
                    disabled={!canDecrease}
                    onClick={() => onCustomPeriodCountChange(customPeriodCount - 1)}
                    title="Reduzir período em 1 concurso"
                    type="button"
                  >
                    -1
                  </button>
                  <button
                    aria-label="Aumentar período em 1 concurso"
                    disabled={!canIncrease}
                    onClick={() => onCustomPeriodCountChange(customPeriodCount + 1)}
                    title="Aumentar período em 1 concurso"
                    type="button"
                  >
                    +1
                  </button>
                </div>
                <label className="backtest-drawer__period-input">
                  <span>Unidades</span>
                  <input
                    aria-label="Quantidade exata de concursos anteriores"
                    max={maximum}
                    min={1}
                    onChange={(event) => onCustomPeriodCountChange(Number.parseInt(event.target.value, 10))}
                    step={1}
                    type="number"
                    value={customPeriodCount}
                  />
                </label>
              </div>
            </div>
          ) : null}
          <p className="backtest-drawer__period-summary">
            Usando até {selectedPeriodCount} {selectedPeriodCount === 1 ? "concurso anterior" : "concursos anteriores"} ao corte.
          </p>
        </div>

        <label className="backtest-drawer__field">
          <span>Tipo de Análise</span>
          <select
            aria-label="Tipo de Análise"
            className="backtest-drawer__select"
            onChange={(event) => onAnalysisViewChange(event.target.value as AnalysisView)}
            value={analysisView}
          >
            {ANALYSIS_VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
