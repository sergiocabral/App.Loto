"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import {
  ANALYSIS_VIEW_OPTIONS,
  buildAnalysisData,
  buildLuckySuggestion,
  getNumbersForAnalysis,
  getSuggestionSize,
  type AnalysisData,
  type AnalysisDrawRange,
  type AnalysisPeriod,
  type AnalysisView,
  type DuplaSenaAnalysisScope,
  type RecencyScoreMode,
} from "@/lib/analysis";
import { ANALYTICS_EVENTS, type AnalyticsEventData, trackEvent } from "@/lib/analytics";
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
type SimulationSpeed = 1 | 2 | 3;

const SIMULATOR_PERIOD_OPTIONS: Array<{ value: SimulatorPeriodPreset; label: string }> = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "custom", label: "Ajustar" },
];

const SIMULATION_DUPLICATE_ATTEMPT_LIMIT = 80;
const SIMULATION_NUMBER_LINE_SIZE = 7;
const SIMULATION_SPEED_DELAYS: Record<SimulationSpeed, number> = {
  1: 250,
  2: 80,
  3: 10,
};
const SIMULATION_SPEED_OPTIONS: Array<{ value: SimulationSpeed; label: string }> = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 3, label: "3x" },
];

type SimulationSuggestion = {
  cutoffDate: string;
  cutoffDrawNumber: number;
  drawnNumbersCount: number;
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

function clampSuggestionNumberCount(value: number, minimum: number): number {
  const normalizedMinimum = Math.max(1, Math.round(minimum));
  const roundedValue = Number.isFinite(value) ? Math.round(value) : normalizedMinimum;
  return Math.max(roundedValue, normalizedMinimum);
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

function isWinningSimulationSuggestion(suggestion: SimulationSuggestion): boolean {
  return suggestion.drawnNumbersCount > 0 && suggestion.hitCount >= suggestion.drawnNumbersCount;
}

function getSimulationGroups(suggestions: SimulationSuggestion[]): SimulationGroup[] {
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
    .sort((left, right) => right.targetDrawNumber - left.targetDrawNumber);
}

function buildSimulationReport(suggestions: SimulationSuggestion[], groups: SimulationGroup[]): string {
  if (!suggestions.length) {
    return `Total de sugestoes simuladas: 0
Concursos processados: 0

Melhores sugestoes:
  aguardando processamento

Concursos:
  nenhum`;
  }

  const hitSuggestions = [...suggestions].filter((suggestion) => suggestion.hitCount > 0);
  const sortedHitSuggestions = hitSuggestions.sort((left, right) => right.hitCount - left.hitCount || right.sequence - left.sequence);
  const highlightedSuggestions = sortedHitSuggestions.filter(
    (suggestion) => suggestion.drawnNumbersCount > 0 && suggestion.hitCount / suggestion.drawnNumbersCount > 0.67,
  );
  const bestSuggestions = getUniqueSuggestions([...sortedHitSuggestions.slice(0, 5), ...highlightedSuggestions]).sort(
    (left, right) => right.hitCount - left.hitCount || right.sequence - left.sequence,
  );
  const winners = suggestions.filter(isWinningSimulationSuggestion);
  const processedDraws = groups
    .map(
      (group) =>
        `- Concurso ${group.targetDrawNumber} em ${group.targetDate}: ${group.suggestions.length} ${
          group.suggestions.length === 1 ? "sugestao" : "sugestoes"
        }`,
    )
    .join("\n");
  const bestLines = bestSuggestions
    .map((suggestion, index) => {
      const winnerSuffix = isWinningSimulationSuggestion(suggestion) ? " GANHOU!" : "";

      return `${index + 1}. concurso ${suggestion.targetDrawNumber}  ${suggestion.targetDate}
   sugestao ${suggestion.sequence} (${suggestion.hitCount} ${suggestion.hitCount === 1 ? "acerto" : "acertos"})${winnerSuffix}
${formatReportNumberLines(suggestion)}`;
    })
    .join("\n");
  const noHitLine = "Nenhuma sugestao acertou numero ainda.\nO simulador segue procurando uma pista boa.";
  const winnerLines = winners.length
    ? `\n\n*** GANHOU! ***\n${winners
        .map(
          (suggestion) => `  concurso ${suggestion.targetDrawNumber}  ${suggestion.targetDate}
    sugestao ${suggestion.sequence} (${suggestion.hitCount} acertos) GANHOU!
${formatReportNumberLines(suggestion, "    numeros  ")}
***`,
        )
        .join("\n")}`
    : "";

  return `Total de sugestoes simuladas: ${suggestions.length}
Concursos processados: ${groups.length}

Melhores sugestoes:
${bestLines || noHitLine}${winnerLines}

Concursos:
${processedDraws}`;
}

function formatReportNumberLines(suggestion: SimulationSuggestion, firstLinePrefix = "   numeros  "): string {
  const tokens = suggestion.numbers.map((number) => (suggestion.hitNumbers.includes(number) ? `(${number})` : ` ${number} `));
  const continuationPrefix = " ".repeat(firstLinePrefix.length);
  const lines: string[] = [];

  for (let index = 0; index < tokens.length; index += SIMULATION_NUMBER_LINE_SIZE) {
    const prefix = index === 0 ? firstLinePrefix : continuationPrefix;
    lines.push(`${prefix}${tokens.slice(index, index + SIMULATION_NUMBER_LINE_SIZE).join(" ")}`);
  }

  return lines.join("\n");
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

function buildUniqueSimulationSuggestion(
  lottery: LotteryDefinition,
  view: AnalysisView,
  data: AnalysisData,
  existingKeys: Set<string>,
  recencyScoreMode: RecencyScoreMode,
  suggestionSize: number,
): string[] | null {
  function findUniqueByRecencyScoreMode(mode: RecencyScoreMode): string[] | null {
    for (let attempt = 0; attempt < SIMULATION_DUPLICATE_ATTEMPT_LIMIT; attempt += 1) {
      const numbers = buildLuckySuggestion(lottery, view, data, Math.random, mode, suggestionSize);
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
  const seen = new Set<string>();
  const unique: SimulationSuggestion[] = [];

  for (const suggestion of suggestions) {
    const suggestionKey = `${suggestion.cutoffDrawNumber}:${suggestion.sequence}:${suggestion.key}`;

    if (seen.has(suggestionKey)) {
      continue;
    }

    seen.add(suggestionKey);
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
  const minimumSuggestionNumberCount = useMemo(() => (lottery ? getSuggestionSize(lottery) : 1), [lottery]);
  const [cutoffDrawNumber, setCutoffDrawNumber] = useState<number | null>(null);
  const [analysisView, setAnalysisView] = useState<AnalysisView>(quickAnalysisView);
  const [periodPreset, setPeriodPreset] = useState<SimulatorPeriodPreset>(() => getSimulatorPeriodPreset(quickAnalysisPeriod));
  const [customPeriodCount, setCustomPeriodCount] = useState(() => (quickAnalysisPeriod === "all" ? getCustomRangeCount(quickCustomRange) : 1));
  const [autoAdvanceCutoff, setAutoAdvanceCutoff] = useState(true);
  const [simulationSpeed, setSimulationSpeed] = useState<SimulationSpeed>(2);
  const [suggestionNumberCount, setSuggestionNumberCount] = useState(minimumSuggestionNumberCount);
  const [simulationCurrentCutoffDrawNumber, setSimulationCurrentCutoffDrawNumber] = useState<number | null>(null);
  const [simulationResults, setSimulationResults] = useState<SimulationSuggestion[]>([]);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationStatusMessage, setSimulationStatusMessage] = useState("Pronto para iniciar.");
  const [closedSimulationGroups, setClosedSimulationGroups] = useState<Set<string>>(() => new Set());
  const [openSimulationGroups, setOpenSimulationGroups] = useState<Set<string>>(() => new Set());
  const effectiveSuggestionNumberCount = clampSuggestionNumberCount(suggestionNumberCount, minimumSuggestionNumberCount);

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

  const simulationGroups = useMemo(() => getSimulationGroups(simulationResults), [simulationResults]);

  const simulationReport = useMemo(() => buildSimulationReport(simulationResults, simulationGroups), [simulationGroups, simulationResults]);

  function getSimulatorAnalyticsData(extra?: AnalyticsEventData): AnalyticsEventData {
    return {
      lottery: lottery?.slug,
      numbersPerDraw: lottery?.numbersPerDraw,
      totalNumbers: lottery?.countNumbers,
      cutoffDrawNumber: activeCutoffDrawNumber ?? undefined,
      analysisView,
      period: periodPreset === "custom" ? "ajustar" : periodPreset,
      periodCount: selectedSimulationPeriodCount,
      autoAdvanceCutoff,
      speed: simulationSpeed,
      suggestionNumberCount: effectiveSuggestionNumberCount,
      simulatedSuggestions: simulationResults.length,
      ...extra,
    };
  }

  useEffect(() => {
    if (!simulationRunning) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
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

      function advanceToCutoff(nextCutoffDrawNumber: number) {
        setClosedSimulationGroups((current) => {
          const next = new Set(current);
          const currentKey = String(simulationCurrentCutoffDrawNumber);
          const nextKey = String(nextCutoffDrawNumber);

          if (current.has(currentKey)) {
            next.add(nextKey);
          } else {
            next.delete(nextKey);
          }

          return next;
        });
        setSimulationCurrentCutoffDrawNumber(nextCutoffDrawNumber);
        setSimulationStatusMessage(`Avançando para o corte do concurso ${nextCutoffDrawNumber}.`);
      }

      const historicalDraws = draws.slice(cutoffIndex);
      const analysisPeriod: AnalysisPeriod = periodPreset === "custom" ? "all" : periodPreset;
      const requestedRange = periodPreset === "custom" ? { end: selectedSimulationPeriodCount, start: 1 } : undefined;
      const analysisData = buildAnalysisData(historicalDraws, lottery, analysisPeriod, quickAnalysisScope, requestedRange);

      if (!analysisData) {
        const nextCutoffDrawNumber = autoAdvanceCutoff ? getNextOlderCutoffDrawNumber(eligibleCutoffs, simulationCurrentCutoffDrawNumber) : null;

        if (nextCutoffDrawNumber !== null) {
          advanceToCutoff(nextCutoffDrawNumber);
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

      const numbers = buildUniqueSimulationSuggestion(lottery, analysisView, analysisData, existingKeys, quickRecencyScoreMode, effectiveSuggestionNumberCount);

      if (numbers) {
        const key = getSuggestionKey(numbers);
        const actualNumbers = new Set(getNumbersForAnalysis(targetDraw, quickAnalysisScope));
        const hitNumbers = numbers.filter((number) => actualNumbers.has(number));
        const sequence = simulationResults.filter((suggestion) => suggestion.cutoffDrawNumber === simulationCurrentCutoffDrawNumber).length + 1;
        const suggestion: SimulationSuggestion = {
          cutoffDate: cutoffDraw.date,
          cutoffDrawNumber: cutoffDraw.drawNumber,
          drawnNumbersCount: actualNumbers.size,
          hitCount: hitNumbers.length,
          hitNumbers,
          key,
          numbers,
          sequence,
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
        advanceToCutoff(nextCutoffDrawNumber);
        return;
      }

      setSimulationRunning(false);
      setSimulationStatusMessage(autoAdvanceCutoff ? "Todos os concursos disponíveis foram processados." : "Sugestões diferentes esgotadas para este corte.");
    }, SIMULATION_SPEED_DELAYS[simulationSpeed]);

    return () => {
      window.clearTimeout(timeoutId);
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
    simulationSpeed,
    effectiveSuggestionNumberCount,
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
    trackEvent(
      ANALYTICS_EVENTS.simulatorCutoffChanged,
      getSimulatorAnalyticsData({
        availableDrawCount: nextAvailableDrawCount,
        cutoffDrawNumber: numeric,
      }),
    );
  }

  function handleCustomPeriodCountChange(value: number) {
    const nextCount = clampPeriodCount(value, availableAnalysisDrawCount);
    setPeriodPreset("custom");
    setCustomPeriodCount(nextCount);
    trackEvent(
      ANALYTICS_EVENTS.simulatorRangeChanged,
      getSimulatorAnalyticsData({
        period: "ajustar",
        periodCount: nextCount,
      }),
    );
  }

  function handlePeriodPresetChange(value: SimulatorPeriodPreset) {
    setPeriodPreset(value);
    trackEvent(
      ANALYTICS_EVENTS.simulatorPeriodChanged,
      getSimulatorAnalyticsData({
        period: value === "custom" ? "ajustar" : value,
        periodCount: value === "custom" ? effectiveCustomPeriodCount : Math.min(value, Math.max(1, availableAnalysisDrawCount)),
      }),
    );
  }

  function handleAnalysisViewChange(value: AnalysisView) {
    setAnalysisView(value);
    trackEvent(
      ANALYTICS_EVENTS.simulatorAnalysisChanged,
      getSimulatorAnalyticsData({
        analysisView: value,
      }),
    );
  }

  function handleAutoAdvanceCutoffChange(value: boolean) {
    setAutoAdvanceCutoff(value);
    trackEvent(
      ANALYTICS_EVENTS.simulatorAutoAdvanceChanged,
      getSimulatorAnalyticsData({
        autoAdvanceCutoff: value,
      }),
    );
  }

  function handleSimulationSpeedChange(value: SimulationSpeed) {
    setSimulationSpeed(value);
    trackEvent(
      ANALYTICS_EVENTS.simulatorSpeedChanged,
      getSimulatorAnalyticsData({
        speed: value,
      }),
    );
  }

  function handleSuggestionNumberCountChange(value: number) {
    const nextCount = clampSuggestionNumberCount(value, minimumSuggestionNumberCount);
    setSuggestionNumberCount(nextCount);
    trackEvent(
      ANALYTICS_EVENTS.simulatorSuggestionSizeChanged,
      getSimulatorAnalyticsData({
        suggestionNumberCount: nextCount,
      }),
    );
  }

  function handleReportCopy() {
    trackEvent(ANALYTICS_EVENTS.simulatorCopyReport, getSimulatorAnalyticsData());
  }

  function handleSuggestionCopy(suggestion: SimulationSuggestion) {
    setSimulationStatusMessage(`Sugestão ${suggestion.sequence} copiada.`);
    trackEvent(
      ANALYTICS_EVENTS.simulatorCopySuggestion,
      getSimulatorAnalyticsData({
        cutoffDrawNumber: suggestion.cutoffDrawNumber,
        hitCount: suggestion.hitCount,
        sequence: suggestion.sequence,
        suggestionNumberCount: suggestion.numbers.length,
        targetDrawNumber: suggestion.targetDrawNumber,
      }),
    );
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
    trackEvent(
      ANALYTICS_EVENTS.simulatorStarted,
      getSimulatorAnalyticsData({
        cutoffDrawNumber: activeCutoffDrawNumber,
        simulatedSuggestions: 0,
      }),
    );
  }

  function stopSimulation() {
    setSimulationRunning(false);
    setSimulationStatusMessage("Simulação pausada.");
    trackEvent(ANALYTICS_EVENTS.simulatorStopped, getSimulatorAnalyticsData());
  }

  function toggleSimulationGroup(key: string) {
    if (key === String(simulationCurrentCutoffDrawNumber)) {
      const nextOpen = closedSimulationGroups.has(key);
      setClosedSimulationGroups((current) => {
        const next = new Set(current);

        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }

        return next;
      });
      trackEvent(
        ANALYTICS_EVENTS.simulatorGroupToggled,
        getSimulatorAnalyticsData({
          activeGroup: true,
          groupDrawNumber: Number.parseInt(key, 10),
          open: nextOpen,
        }),
      );
      return;
    }

    const nextOpen = !openSimulationGroups.has(key);
    setOpenSimulationGroups((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
    trackEvent(
      ANALYTICS_EVENTS.simulatorGroupToggled,
      getSimulatorAnalyticsData({
        activeGroup: false,
        groupDrawNumber: Number.parseInt(key, 10),
        open: nextOpen,
      }),
    );
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
                onAnalysisViewChange={handleAnalysisViewChange}
                onCustomPeriodCountChange={handleCustomPeriodCountChange}
                onPeriodPresetChange={handlePeriodPresetChange}
                periodPreset={periodPreset}
              />
              <BacktestSimulationPanel
                activeCutoffDrawNumber={simulationCurrentCutoffDrawNumber}
                autoAdvanceCutoff={autoAdvanceCutoff}
                closedGroupKeys={closedSimulationGroups}
                groups={simulationGroups}
                onAutoAdvanceCutoffChange={handleAutoAdvanceCutoffChange}
                onGroupToggle={toggleSimulationGroup}
                onReportCopy={handleReportCopy}
                onSuggestionCopy={handleSuggestionCopy}
                onSuggestionNumberCountChange={handleSuggestionNumberCountChange}
                onStart={startSimulation}
                onStop={stopSimulation}
                onSpeedChange={handleSimulationSpeedChange}
                openGroupKeys={openSimulationGroups}
                report={simulationReport}
                running={simulationRunning}
                speed={simulationSpeed}
                statusMessage={simulationStatusMessage}
                minimumSuggestionNumberCount={minimumSuggestionNumberCount}
                suggestionNumberCount={effectiveSuggestionNumberCount}
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
  minimumSuggestionNumberCount: number;
  onAutoAdvanceCutoffChange: (checked: boolean) => void;
  onGroupToggle: (key: string) => void;
  onReportCopy: () => void;
  onSuggestionCopy: (suggestion: SimulationSuggestion) => void;
  onSuggestionNumberCountChange: (count: number) => void;
  onStart: () => void;
  onStop: () => void;
  onSpeedChange: (speed: SimulationSpeed) => void;
  openGroupKeys: Set<string>;
  report: string;
  running: boolean;
  speed: SimulationSpeed;
  statusMessage: string;
  suggestionNumberCount: number;
  suggestions: SimulationSuggestion[];
};

function BacktestSimulationPanel({
  activeCutoffDrawNumber,
  autoAdvanceCutoff,
  closedGroupKeys,
  groups,
  minimumSuggestionNumberCount,
  onAutoAdvanceCutoffChange,
  onGroupToggle,
  onReportCopy,
  onSuggestionCopy,
  onSuggestionNumberCountChange,
  onStart,
  onStop,
  onSpeedChange,
  openGroupKeys,
  report,
  running,
  speed,
  statusMessage,
  suggestionNumberCount,
  suggestions,
}: BacktestSimulationPanelProps) {
  const [reportCopied, setReportCopied] = useState(false);
  const [copiedSuggestionKey, setCopiedSuggestionKey] = useState<string | null>(null);

  const handleCopyReport = useCallback(() => {
    void copyTextToClipboard(buildCopyableSimulationReport(report)).then((copied) => {
      if (copied) {
        setReportCopied(true);
        onReportCopy();
      } else {
        setReportCopied(false);
      }
    });
  }, [onReportCopy, report]);

  const handleCopySuggestion = useCallback(
    (suggestion: SimulationSuggestion) => {
      void copyTextToClipboard(suggestion.numbers.join(" ")).then((copied) => {
        if (!copied) {
          return;
        }

        setCopiedSuggestionKey(`${suggestion.cutoffDrawNumber}:${suggestion.key}`);
        onSuggestionCopy(suggestion);
      });
    },
    [onSuggestionCopy],
  );

  useEffect(() => {
    if (!reportCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setReportCopied(false), 1600);

    return () => window.clearTimeout(timeoutId);
  }, [reportCopied]);

  useEffect(() => {
    if (!copiedSuggestionKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopiedSuggestionKey(null), 1600);

    return () => window.clearTimeout(timeoutId);
  }, [copiedSuggestionKey]);

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

      <div className="backtest-drawer__suggestion-size-control">
        <div className="backtest-drawer__suggestion-size-header">
          <span>Números por sugestão</span>
          <strong>{suggestionNumberCount}</strong>
        </div>
        <div className="backtest-drawer__period-controls">
          <div className="range-precision-controls" aria-label="Ajuste fino da quantidade de números sugeridos">
            <button
              aria-label="Reduzir quantidade de números sugeridos"
              disabled={running || suggestionNumberCount <= minimumSuggestionNumberCount}
              onClick={() => onSuggestionNumberCountChange(suggestionNumberCount - 1)}
              title="Reduzir quantidade de números sugeridos"
              type="button"
            >
              -1
            </button>
            <button
              aria-label="Aumentar quantidade de números sugeridos"
              disabled={running}
              onClick={() => onSuggestionNumberCountChange(suggestionNumberCount + 1)}
              title="Aumentar quantidade de números sugeridos"
              type="button"
            >
              +1
            </button>
          </div>
          <label className="backtest-drawer__period-input">
            <span>Unidades</span>
            <input
              aria-label="Quantidade de números por sugestão"
              disabled={running}
              min={minimumSuggestionNumberCount}
              onChange={(event) => onSuggestionNumberCountChange(Number.parseInt(event.target.value, 10))}
              step={1}
              type="number"
              value={suggestionNumberCount}
            />
          </label>
        </div>
        <p className="backtest-drawer__period-summary">
          Mínimo desta loteria: {minimumSuggestionNumberCount} {minimumSuggestionNumberCount === 1 ? "número" : "números"}.
        </p>
      </div>

      <div className="backtest-drawer__speed-control">
        <span>Velocidade</span>
        <div aria-label="Velocidade da simulação" className="backtest-drawer__speed-options" role="group">
          {SIMULATION_SPEED_OPTIONS.map((option) => (
            <button
              aria-pressed={speed === option.value}
              className={`backtest-drawer__speed-button ${speed === option.value ? "is-active" : ""}`}
              key={option.value}
              onClick={() => onSpeedChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

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
                      const isWinner = isWinningSimulationSuggestion(suggestion);
                      const renderedSuggestionKey = `${suggestion.cutoffDrawNumber}:${suggestion.key}`;
                      const wasCopied = copiedSuggestionKey === renderedSuggestionKey;

                      return (
                        <article className={`backtest-drawer__suggestion-item ${isWinner ? "is-winner" : ""}`} key={suggestion.key}>
                          <header>
                            <strong>Sugestão {suggestion.sequence}</strong>
                            <span>
                              {wasCopied
                                ? "Copiado"
                                : `${suggestion.hitCount}/${suggestion.drawnNumbersCount} acertos${isWinner ? " · GANHOU" : ""}`}
                            </span>
                          </header>
                          <button
                            aria-label={`Copiar números da sugestão ${suggestion.sequence}`}
                            className="backtest-drawer__suggestion-numbers"
                            onClick={() => handleCopySuggestion(suggestion)}
                            title="Copiar sugestão"
                            type="button"
                          >
                            {suggestion.numbers.map((number) => {
                              const isHit = suggestion.hitNumbers.includes(number);

                              return (
                                <span className={isHit ? "is-hit" : ""} key={number}>
                                  {number}
                                </span>
                              );
                            })}
                          </button>
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
