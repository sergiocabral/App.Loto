"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import {
  ANALYSIS_VIEW_OPTIONS,
  buildAnalysisData,
  buildLuckySuggestion,
  getNumbersForAnalysis,
  type AnalysisData,
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
  quickAnalysisPeriod: AnalysisPeriod;
  quickAnalysisScope: DuplaSenaAnalysisScope;
  quickAnalysisView: AnalysisView;
  quickCustomRange: AnalysisDrawRange;
  quickRecencyScoreMode: RecencyScoreMode;
};

type SimulatorPeriodPreset = 10 | 25 | 50 | 100 | "custom";

const SIMULATOR_PERIOD_OPTIONS: Array<{ value: SimulatorPeriodPreset; label: string }> = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "custom", label: "Ajustar" },
];

const SIMULATION_DUPLICATE_ATTEMPT_LIMIT = 80;
const SIMULATION_INTERVAL_MS = 200;

type SimulationSuggestion = {
  cutoffDate: string;
  cutoffDrawNumber: number;
  hitCount: number;
  hitNumbers: string[];
  key: string;
  numbers: string[];
  sequence: number;
  targetDate: string;
  targetDrawNumber: number;
  totalNumbers: number;
};

type SimulationGroup = {
  cutoffDate: string;
  cutoffDrawNumber: number;
  key: string;
  latestSequence: number;
  suggestions: SimulationSuggestion[];
  targetDate: string;
  targetDrawNumber: number;
};

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

function getSimulatorPeriodPreset(period: AnalysisPeriod): SimulatorPeriodPreset {
  return period === "all" ? "custom" : period;
}

function getAvailableDrawCountForCutoff(draws: Draw[], cutoffDrawNumber: number | null): number {
  if (cutoffDrawNumber === null) {
    return 0;
  }

  const cutoffIndex = draws.findIndex((draw) => draw.drawNumber === cutoffDrawNumber);
  return cutoffIndex >= 0 ? draws.length - cutoffIndex : 0;
}

function getNextOlderCutoffDrawNumber(cutoffs: Draw[], drawNumber: number): number | null {
  const currentIndex = cutoffs.findIndex((draw) => draw.drawNumber === drawNumber);
  return currentIndex >= 0 ? cutoffs[currentIndex + 1]?.drawNumber ?? null : null;
}

function getSuggestionKey(numbers: string[]): string {
  return numbers.join("-");
}

function getSimulationGroups(suggestions: SimulationSuggestion[], activeCutoffDrawNumber: number | null): SimulationGroup[] {
  const groups = new Map<number, SimulationGroup>();

  for (const suggestion of suggestions) {
    const existing = groups.get(suggestion.cutoffDrawNumber);

    if (existing) {
      existing.latestSequence = Math.max(existing.latestSequence, suggestion.sequence);
      existing.suggestions.push(suggestion);
      continue;
    }

    groups.set(suggestion.cutoffDrawNumber, {
      cutoffDate: suggestion.cutoffDate,
      cutoffDrawNumber: suggestion.cutoffDrawNumber,
      key: String(suggestion.cutoffDrawNumber),
      latestSequence: suggestion.sequence,
      suggestions: [suggestion],
      targetDate: suggestion.targetDate,
      targetDrawNumber: suggestion.targetDrawNumber,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      suggestions: [...group.suggestions].sort((left, right) => right.hitCount - left.hitCount || right.sequence - left.sequence),
    }))
    .sort((left, right) => {
      if (left.cutoffDrawNumber === activeCutoffDrawNumber) {
        return -1;
      }

      if (right.cutoffDrawNumber === activeCutoffDrawNumber) {
        return 1;
      }

      return right.latestSequence - left.latestSequence;
    });
}

function buildSimulationReport(suggestions: SimulationSuggestion[], groups: SimulationGroup[]): string {
  if (!suggestions.length) {
    return `Total de sugestoes simuladas: 0
Concursos processados: 0

Concursos:
  nenhum

Melhores sugestoes:
  aguardando processamento`;
  }

  const hitSuggestions = [...suggestions].filter((suggestion) => suggestion.hitCount > 0);
  const sortedHitSuggestions = hitSuggestions.sort((left, right) => right.hitCount - left.hitCount || right.sequence - left.sequence);
  const highlightedSuggestions = sortedHitSuggestions.filter((suggestion) => suggestion.hitCount / suggestion.totalNumbers > 0.67);
  const bestSuggestions = getUniqueSuggestions([...sortedHitSuggestions.slice(0, 5), ...highlightedSuggestions]).sort(
    (left, right) => right.hitCount - left.hitCount || right.sequence - left.sequence,
  );
  const winners = suggestions.filter((suggestion) => suggestion.hitCount === suggestion.totalNumbers && suggestion.totalNumbers > 0);
  const processedDraws = groups
    .map(
      (group) =>
        `- Concurso ${group.targetDrawNumber} em ${group.targetDate}: ${group.suggestions.length} ${
          group.suggestions.length === 1 ? "sugestao" : "sugestoes"
        }`,
    )
    .join("\n");
  const bestLines = bestSuggestions
    .map(
      (suggestion, index) =>
        `${index + 1}. concurso ${suggestion.targetDrawNumber}  ${suggestion.targetDate}
   sugestao ${suggestion.sequence} (${suggestion.hitCount} ${suggestion.hitCount === 1 ? "acerto" : "acertos"})
   numeros  ${formatReportNumbers(suggestion)}`,
    )
    .join("\n");
  const noHitLine = "Nenhuma sugestao acertou numero ainda.\nO simulador segue procurando uma pista boa.";
  const winnerLines = winners.length
    ? `\n\n*** PREMIO MAXIMO SIMULADO ***\n${winners
        .map(
          (suggestion) => `  concurso ${suggestion.targetDrawNumber}  ${suggestion.targetDate}
    sugestao ${suggestion.sequence} (${suggestion.hitCount} acertos)
    numeros  ${formatReportNumbers(suggestion)}
    GANHARIA o premio maximo simulado
***`,
        )
        .join("\n")}`
    : "";

  return `Total de sugestoes simuladas: ${suggestions.length}
Concursos processados: ${groups.length}

Concursos:
${processedDraws}

Melhores sugestoes:
${bestLines || noHitLine}${winnerLines}`;
}

function formatReportNumbers(suggestion: SimulationSuggestion): string {
  return suggestion.numbers.map((number) => (suggestion.hitNumbers.includes(number) ? `(${number})` : ` ${number} `)).join(" ");
}

function buildCopyableSimulationReport(report: string): string {
  const domain = getCurrentDomain();
  return `Simulador de sorteios anteriores\n\n${report}\n\nSite: ${domain}`;
}

function getCurrentDomain(): string {
  try {
    return new URL(window.location.href).hostname;
  } catch {
    return window.location.hostname;
  }
}

function buildUniqueSimulationSuggestion(
  lottery: LotteryDefinition,
  view: AnalysisView,
  data: AnalysisData,
  existingKeys: Set<string>,
  recencyScoreMode: RecencyScoreMode,
): string[] | null {
  function findUniqueByRecencyScoreMode(mode: RecencyScoreMode): string[] | null {
    for (let attempt = 0; attempt < SIMULATION_DUPLICATE_ATTEMPT_LIMIT; attempt += 1) {
      const numbers = buildLuckySuggestion(lottery, view, data, Math.random, mode);
      const key = getSuggestionKey(numbers);

      if (numbers.length && !existingKeys.has(key)) {
        return numbers;
      }
    }

    return null;
  }

  if (view === "recent") {
    return findUniqueByRecencyScoreMode("float") ?? findUniqueByRecencyScoreMode("rounded");
  }

  return findUniqueByRecencyScoreMode(recencyScoreMode);
}

function getUniqueSuggestions(suggestions: SimulationSuggestion[]): SimulationSuggestion[] {
  const seen = new Set<number>();
  const unique: SimulationSuggestion[] = [];

  for (const suggestion of suggestions) {
    if (seen.has(suggestion.sequence)) {
      continue;
    }

    seen.add(suggestion.sequence);
    unique.push(suggestion);
  }

  return unique;
}

export function BacktestDrawer({
  draws,
  lottery,
  onClose,
  open,
  quickAnalysisPeriod,
  quickAnalysisScope,
  quickAnalysisView,
  quickCustomRange,
  quickRecencyScoreMode,
}: BacktestDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  const eligibleCutoffs = useMemo(() => getEligibleCutoffs(draws), [draws]);
  const [cutoffDrawNumber, setCutoffDrawNumber] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>(quickAnalysisView);
  const [periodPreset, setPeriodPreset] = useState<SimulatorPeriodPreset>(() => getSimulatorPeriodPreset(quickAnalysisPeriod));
  const [customPeriodCount, setCustomPeriodCount] = useState(() => (quickAnalysisPeriod === "all" ? getCustomRangeCount(quickCustomRange) : 1));
  const [autoAdvanceCutoff, setAutoAdvanceCutoff] = useState(false);
  const [simulationCurrentCutoffDrawNumber, setSimulationCurrentCutoffDrawNumber] = useState<number | null>(null);
  const [simulationResults, setSimulationResults] = useState<SimulationSuggestion[]>([]);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationStatusMessage, setSimulationStatusMessage] = useState("Pronto para iniciar.");
  const [closedSimulationGroups, setClosedSimulationGroups] = useState<Set<string>>(() => new Set());
  const [openSimulationGroups, setOpenSimulationGroups] = useState<Set<string>>(() => new Set());

  const handleClose = useCallback(() => {
    setSimulationRunning(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    onCloseRef.current = handleClose;
  }, [handleClose]);

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
    return getAvailableDrawCountForCutoff(draws, activeCutoffDrawNumber);
  }, [activeCutoffDrawNumber, draws]);

  const effectiveCustomPeriodCount = clampPeriodCount(customPeriodCount, availableAnalysisDrawCount);

  const selectedSimulationPeriodCount = useMemo(
    () => (periodPreset === "custom" ? effectiveCustomPeriodCount : Math.min(periodPreset, Math.max(1, availableAnalysisDrawCount))),
    [availableAnalysisDrawCount, effectiveCustomPeriodCount, periodPreset],
  );

  const simulationGroups = useMemo(
    () => getSimulationGroups(simulationResults, simulationCurrentCutoffDrawNumber),
    [simulationCurrentCutoffDrawNumber, simulationResults],
  );

  const simulationReport = useMemo(() => buildSimulationReport(simulationResults, simulationGroups), [simulationGroups, simulationResults]);

  useEffect(() => {
    if (!simulationRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!lottery || simulationCurrentCutoffDrawNumber === null) {
        setSimulationRunning(false);
        setSimulationStatusMessage("Sem concurso de corte para processar.");
        return;
      }

      const cutoffIndex = draws.findIndex((draw) => draw.drawNumber === simulationCurrentCutoffDrawNumber);
      const cutoffDraw = cutoffIndex >= 0 ? draws[cutoffIndex] : null;
      const targetDraw = cutoffIndex > 0 ? draws[cutoffIndex - 1] : null;

      if (!cutoffDraw || !targetDraw) {
        setSimulationRunning(false);
        setSimulationStatusMessage("Sem concurso seguinte para conferir.");
        return;
      }

      const historicalDraws = draws.slice(cutoffIndex);
      const analysisPeriod: AnalysisPeriod = periodPreset === "custom" ? "all" : periodPreset;
      const requestedRange = periodPreset === "custom" ? { end: selectedSimulationPeriodCount, start: 1 } : undefined;
      const analysisData = buildAnalysisData(historicalDraws, lottery, analysisPeriod, quickAnalysisScope, requestedRange);

      if (!analysisData) {
        const nextCutoffDrawNumber = autoAdvanceCutoff ? getNextOlderCutoffDrawNumber(eligibleCutoffs, simulationCurrentCutoffDrawNumber) : null;

        if (nextCutoffDrawNumber !== null) {
          setSimulationCurrentCutoffDrawNumber(nextCutoffDrawNumber);
          setSimulationStatusMessage(`Avançando para o corte do concurso ${nextCutoffDrawNumber}.`);
          return;
        }

        setSimulationRunning(false);
        setSimulationStatusMessage(autoAdvanceCutoff ? "Todos os concursos disponíveis foram processados." : "Sem dados suficientes para gerar análise neste corte.");
        return;
      }

      const existingKeys = new Set(
        simulationResults
          .filter((suggestion) => suggestion.cutoffDrawNumber === simulationCurrentCutoffDrawNumber)
          .map((suggestion) => suggestion.key),
      );

      const numbers = buildUniqueSimulationSuggestion(lottery, analysisView, analysisData, existingKeys, quickRecencyScoreMode);

      if (numbers) {
        const key = getSuggestionKey(numbers);
        const actualNumbers = new Set(getNumbersForAnalysis(targetDraw, quickAnalysisScope));
        const hitNumbers = numbers.filter((number) => actualNumbers.has(number));
        const suggestion: SimulationSuggestion = {
          cutoffDate: cutoffDraw.date,
          cutoffDrawNumber: cutoffDraw.drawNumber,
          hitCount: hitNumbers.length,
          hitNumbers,
          key,
          numbers,
          sequence: simulationResults.length + 1,
          targetDate: targetDraw.date,
          targetDrawNumber: targetDraw.drawNumber,
          totalNumbers: numbers.length,
        };

        setSimulationResults((current) => [...current, suggestion]);
        setSimulationStatusMessage(`Sugestão ${suggestion.sequence} conferida para o concurso ${targetDraw.drawNumber}.`);
        return;
      }

      const nextCutoffDrawNumber = autoAdvanceCutoff ? getNextOlderCutoffDrawNumber(eligibleCutoffs, simulationCurrentCutoffDrawNumber) : null;

      if (nextCutoffDrawNumber !== null) {
        setSimulationCurrentCutoffDrawNumber(nextCutoffDrawNumber);
        setSimulationStatusMessage(`Avançando para o corte do concurso ${nextCutoffDrawNumber}.`);
        return;
      }

      setSimulationRunning(false);
      setSimulationStatusMessage(autoAdvanceCutoff ? "Todos os concursos disponíveis foram processados." : "Sugestões diferentes esgotadas para este corte.");
    }, SIMULATION_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    analysisView,
    autoAdvanceCutoff,
    draws,
    eligibleCutoffs,
    lottery,
    periodPreset,
    quickAnalysisScope,
    quickRecencyScoreMode,
    selectedSimulationPeriodCount,
    simulationCurrentCutoffDrawNumber,
    simulationResults,
    simulationRunning,
  ]);

  function handleCutoffChange(value: string) {
    const numeric = Number.parseInt(value, 10);

    if (!Number.isFinite(numeric)) {
      setCutoffDrawNumber(null);
      return;
    }

    const nextAvailableDrawCount = getAvailableDrawCountForCutoff(draws, numeric);
    setCutoffDrawNumber(numeric);
    setCustomPeriodCount(clampPeriodCount(nextAvailableDrawCount, nextAvailableDrawCount));
  }

  function handleCustomPeriodCountChange(value: number) {
    setPeriodPreset("custom");
    setCustomPeriodCount(clampPeriodCount(value, availableAnalysisDrawCount));
  }

  function startSimulation() {
    if (activeCutoffDrawNumber === null) {
      setSimulationStatusMessage("Selecione um concurso de corte para iniciar.");
      return;
    }

    setSimulationResults([]);
    setSimulationCurrentCutoffDrawNumber(activeCutoffDrawNumber);
    setClosedSimulationGroups(new Set());
    setOpenSimulationGroups(new Set());
    setSimulationStatusMessage("Preparando a primeira sugestão.");
    setSimulationRunning(true);
  }

  function stopSimulation() {
    setSimulationRunning(false);
    setSimulationStatusMessage("Simulação pausada.");
  }

  function toggleSimulationGroup(key: string) {
    if (key === String(simulationCurrentCutoffDrawNumber)) {
      setClosedSimulationGroups((current) => {
        const next = new Set(current);

        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }

        return next;
      });
      return;
    }

    setOpenSimulationGroups((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  if (!open) {
    return null;
  }

  return (
    <div className="backtest-drawer__root">
      <button aria-label="Fechar simulador" className="backtest-drawer__backdrop" onClick={handleClose} type="button" />
      <div aria-labelledby="backtest-title" aria-modal="true" className="backtest-drawer__panel" role="dialog">
        <header className="backtest-drawer__header">
          <div>
            <span className="eyebrow">Simulador</span>
            <h2 id="backtest-title">Sorteios anteriores</h2>
            {lottery ? <p>{formatLotteryName(lottery.slug)}</p> : null}
          </div>
          <button aria-label="Fechar simulador" className="backtest-drawer__close" onClick={handleClose} ref={closeButtonRef} type="button">
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
                disabled={simulationRunning}
                onChange={handleCutoffChange}
                value={activeCutoffDrawNumber}
              />
              <BacktestAnalysisParameters
                analysisView={analysisView}
                availableDrawCount={availableAnalysisDrawCount}
                customPeriodCount={effectiveCustomPeriodCount}
                disabled={simulationRunning}
                onAnalysisViewChange={setAnalysisView}
                onCustomPeriodCountChange={handleCustomPeriodCountChange}
                onPeriodPresetChange={setPeriodPreset}
                periodPreset={periodPreset}
              />
              <BacktestSimulationPanel
                activeCutoffDrawNumber={simulationCurrentCutoffDrawNumber}
                autoAdvanceCutoff={autoAdvanceCutoff}
                closedGroupKeys={closedSimulationGroups}
                groups={simulationGroups}
                onAutoAdvanceCutoffChange={setAutoAdvanceCutoff}
                onGroupToggle={toggleSimulationGroup}
                onStart={startSimulation}
                onStop={stopSimulation}
                openGroupKeys={openSimulationGroups}
                report={simulationReport}
                running={simulationRunning}
                statusMessage={simulationStatusMessage}
                suggestions={simulationResults}
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
  disabled: boolean;
  onChange: (value: string) => void;
  value: number | null;
};

function BacktestCutoffPicker({ cutoffs, disabled, onChange, value }: BacktestCutoffPickerProps) {
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
          disabled={disabled}
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
  disabled: boolean;
  onAnalysisViewChange: (view: AnalysisView) => void;
  onCustomPeriodCountChange: (count: number) => void;
  onPeriodPresetChange: (period: SimulatorPeriodPreset) => void;
  periodPreset: SimulatorPeriodPreset;
};

function BacktestAnalysisParameters({
  analysisView,
  availableDrawCount,
  customPeriodCount,
  disabled,
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
                disabled={disabled}
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
                disabled={disabled}
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
                    disabled={disabled || !canDecrease}
                    onClick={() => onCustomPeriodCountChange(customPeriodCount - 1)}
                    title="Reduzir período em 1 concurso"
                    type="button"
                  >
                    -1
                  </button>
                  <button
                    aria-label="Aumentar período em 1 concurso"
                    disabled={disabled || !canIncrease}
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
                    disabled={disabled}
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
            disabled={disabled}
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

type BacktestSimulationPanelProps = {
  activeCutoffDrawNumber: number | null;
  autoAdvanceCutoff: boolean;
  closedGroupKeys: Set<string>;
  groups: SimulationGroup[];
  onAutoAdvanceCutoffChange: (checked: boolean) => void;
  onGroupToggle: (key: string) => void;
  onStart: () => void;
  onStop: () => void;
  openGroupKeys: Set<string>;
  report: string;
  running: boolean;
  statusMessage: string;
  suggestions: SimulationSuggestion[];
};

function BacktestSimulationPanel({
  activeCutoffDrawNumber,
  autoAdvanceCutoff,
  closedGroupKeys,
  groups,
  onAutoAdvanceCutoffChange,
  onGroupToggle,
  onStart,
  onStop,
  openGroupKeys,
  report,
  running,
  statusMessage,
  suggestions,
}: BacktestSimulationPanelProps) {
  const [reportCopied, setReportCopied] = useState(false);

  const handleCopyReport = useCallback(() => {
    if (!navigator.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(buildCopyableSimulationReport(report)).then(() => setReportCopied(true)).catch(() => setReportCopied(false));
  }, [report]);

  useEffect(() => {
    if (!reportCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setReportCopied(false), 1600);

    return () => window.clearTimeout(timeoutId);
  }, [reportCopied]);

  return (
    <section aria-label="Simulação" className="backtest-drawer__section">
      <header className="backtest-drawer__section-header">
        <h3>Simulação</h3>
      </header>

      <div className="backtest-drawer__simulation-actions">
        <button className="backtest-drawer__simulation-button is-start" disabled={running} onClick={onStart} type="button">
          Iniciar
        </button>
        <button className="backtest-drawer__simulation-button is-stop" disabled={!running} onClick={onStop} type="button">
          Parar
        </button>
      </div>

      <label className="backtest-drawer__checkbox-field">
        <input
          checked={autoAdvanceCutoff}
          disabled={running}
          onChange={(event) => onAutoAdvanceCutoffChange(event.target.checked)}
          type="checkbox"
        />
        <span>Retroceder concurso de corte ao esgotar sugestões</span>
      </label>

      <div
        aria-live="polite"
        className={`backtest-drawer__simulation-status ${running ? "is-running" : ""}`}
      >
        <span aria-hidden="true" className="backtest-drawer__spinner" />
        <div>
          <strong>{running ? "Rodando ensaio técnico" : "Laboratório em aquecimento"}</strong>
          <span>
            {running
              ? `${suggestions.length} ${suggestions.length === 1 ? "sugestão analisada" : "sugestões analisadas"}`
              : statusMessage}
          </span>
        </div>
      </div>

      <div className="backtest-drawer__simulation-report" aria-label="Relatório da simulação">
        <div className="backtest-drawer__simulation-report-header">
          <button className="backtest-drawer__copy-button" disabled={!report.trim()} onClick={handleCopyReport} type="button">
            {reportCopied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <pre>{report}</pre>
      </div>

      <div className="backtest-drawer__simulation-results" aria-label="Sugestões simuladas">
        {suggestions.length ? (
          groups.map((group) => {
            const isActiveGroup = group.cutoffDrawNumber === activeCutoffDrawNumber;
            const isOpen = isActiveGroup ? !closedGroupKeys.has(group.key) : openGroupKeys.has(group.key);

            return (
              <section className="backtest-drawer__result-group" key={group.key}>
                <button
                  aria-expanded={isOpen}
                  className="backtest-drawer__result-group-toggle"
                  onClick={() => onGroupToggle(group.key)}
                  type="button"
                >
                  <span>
                    Concurso {group.targetDrawNumber} · {group.targetDate}
                  </span>
                  <strong>
                    {group.suggestions.length} {group.suggestions.length === 1 ? "sugestão" : "sugestões"}
                  </strong>
                </button>

                {isOpen ? (
                  <div className="backtest-drawer__suggestion-list">
                    {group.suggestions.map((suggestion) => {
                      const isWinner = suggestion.hitCount === suggestion.totalNumbers && suggestion.totalNumbers > 0;

                      return (
                        <article className={`backtest-drawer__suggestion-item ${isWinner ? "is-winner" : ""}`} key={suggestion.key}>
                          <header>
                            <strong>Sugestão {suggestion.sequence}</strong>
                            <span>
                              {suggestion.hitCount}/{suggestion.totalNumbers} acertos
                            </span>
                          </header>
                          <div className="backtest-drawer__suggestion-numbers" aria-label={`Números da sugestão ${suggestion.sequence}`}>
                            {suggestion.numbers.map((number) => {
                              const isHit = suggestion.hitNumbers.includes(number);

                              return (
                                <span className={isHit ? "is-hit" : ""} key={number}>
                                  {number}
                                </span>
                              );
                            })}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        ) : (
          <p className="backtest-drawer__period-summary">Nenhuma sugestão simulada ainda.</p>
        )}
      </div>
    </section>
  );
}
