import type { LotteryDefinition } from "@/data/lotteries";
import type { Draw } from "@/lib/types";

export type AnalysisPeriod = 10 | 25 | 50 | 100 | "all";
export type AnalysisView = "most" | "least" | "delayed" | "map";
export type AnalysisDrawRange = {
  end: number;
  start: number;
};
export type DuplaSenaAnalysisScope = "all" | "first" | "second";

export type NumberTrend = {
  number: string;
  value: number;
  hits: number;
  overdue: number;
  lastDrawNumber: number | null;
  intensity: number;
};

export type NumberTrendGroup = {
  value: number;
  items: NumberTrend[];
};

export type SuggestedGame = {
  key: string;
  numbers: string[];
};

export type AnalysisData = {
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

export const ANALYSIS_PERIOD_OPTIONS: Array<{ value: AnalysisPeriod; label: string }> = [
  { value: 10, label: "10" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
  { value: 100, label: "100" },
  { value: "all", label: "Ajustar" },
];

export const ANALYSIS_VIEW_OPTIONS: Array<{ value: AnalysisView; label: string }> = [
  { value: "most", label: "Mais sorteados" },
  { value: "least", label: "Menos sorteados" },
  { value: "delayed", label: "Atrasados" },
  { value: "map", label: "Mapa" },
];

export const DUPLA_SENA_SCOPE_OPTIONS: Array<{ value: DuplaSenaAnalysisScope; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "first", label: "1º sorteio" },
  { value: "second", label: "2º sorteio" },
];

export function getDisplayGroups(draw: Draw): string[][] {
  const groups = draw.numberGroups?.filter((group) => group.length > 0) ?? [];
  return groups.length ? groups : [draw.numbers];
}

export function sortNumbersForDisplay(numbers: string[]): string[] {
  return [...numbers].sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
}

export function parseNumberFilter(input: string, lottery: LotteryDefinition): string[] {
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

export function drawContainsNumbers(draw: Draw, numbers: string[]): boolean {
  if (!numbers.length) {
    return true;
  }

  const drawNumbers = new Set(getDisplayGroups(draw).flat());
  return numbers.every((number) => drawNumbers.has(number));
}

export function getAnalysisViewLabel(view: AnalysisView): string {
  return ANALYSIS_VIEW_OPTIONS.find((option) => option.value === view)?.label ?? "Análise";
}

export function formatHitsLabel(hitCount: number): string {
  return `${hitCount} ${hitCount === 1 ? "vez" : "vezes"}`;
}

export function formatNumberCount(count: number): string {
  return `${count} ${count === 1 ? "número" : "números"}`;
}

export function getAnalysisFilterText(data: AnalysisData): string {
  const periodText = data.periodLabel.toLowerCase();

  if (data.scopeLabel === "Todos os sorteios") {
    return periodText;
  }

  return `${periodText} no ${data.scopeLabel.toLowerCase()}`;
}

export function getAnalysisDescription(view: AnalysisView, data: AnalysisData): string {
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

export function getAnalysisPeriodLabel(period: AnalysisPeriod, drawCount: number, requestedRange?: AnalysisDrawRange): string {
  if (period === "all") {
    if (requestedRange) {
      return `Sorteios ${requestedRange.start} a ${requestedRange.end} do histórico`;
    }

    return `${drawCount} concursos`;
  }

  return `Últimos ${Math.min(period, drawCount)} concursos`;
}

export function getAnalysisScopeLabel(scope: DuplaSenaAnalysisScope): string {
  switch (scope) {
    case "first":
      return "1º sorteio";
    case "second":
      return "2º sorteio";
    default:
      return "Todos os sorteios";
  }
}

export function getNumbersForAnalysis(draw: Draw, scope: DuplaSenaAnalysisScope): string[] {
  const groups = getDisplayGroups(draw);

  if (scope === "first") {
    return groups[0] ?? [];
  }

  if (scope === "second") {
    return groups[1] ?? [];
  }

  return groups.flat();
}

export function buildNumberRange(lottery: LotteryDefinition): string[] {
  if (lottery.slug === "LotoMania") {
    return Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));
  }

  return Array.from({ length: lottery.countNumbers }, (_, index) => String(index + 1).padStart(2, "0"));
}

export function buildTrendGroups(
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

export function getSuggestionSize(lottery: LotteryDefinition): number {
  return lottery.groups?.[0] ?? lottery.numbersPerDraw;
}

export function buildSuggestionKey(lottery: LotteryDefinition, view: AnalysisView, data: AnalysisData): string {
  const fingerprint = data.stats.map((item) => `${item.number}:${item.hits}:${item.overdue}`).join(",");
  return [lottery.slug, view, data.periodLabel, data.scopeLabel, data.drawCount, fingerprint].join("|");
}

export function getAnalysisWeight(item: NumberTrend, view: AnalysisView, data: AnalysisData): number {
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

export function shuffleItems<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }

  return shuffled;
}

export function buildSuggestionGroups(view: AnalysisView, data: AnalysisData): NumberTrendGroup[] {
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

export function buildLuckySuggestion(
  lottery: LotteryDefinition,
  view: AnalysisView,
  data: AnalysisData,
  random: () => number = Math.random,
): string[] {
  const size = Math.min(getSuggestionSize(lottery), data.stats.length);
  const selected: string[] = [];

  for (const group of buildSuggestionGroups(view, data)) {
    if (selected.length >= size) {
      break;
    }

    const availableSlots = size - selected.length;
    const shuffledGroup = shuffleItems(group.items, random);
    selected.push(...shuffledGroup.slice(0, availableSlots).map((item) => item.number));
  }

  return sortNumbersForDisplay(selected);
}

export function formatOverdueLabel(overdue: number): string {
  if (overdue === 0) {
    return "Saiu no último concurso";
  }

  return `${overdue} ${overdue === 1 ? "concurso" : "concursos"} sem sair`;
}

export function getSuggestionDescription(view: AnalysisView, data: AnalysisData): string {
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

function normalizeRequestedRange(range: AnalysisDrawRange, drawCount: number): AnalysisDrawRange {
  const maximum = Math.max(1, drawCount);
  const start = Math.min(Math.max(Math.round(range.start), 1), maximum);
  const end = Math.min(Math.max(Math.round(range.end), 1), maximum);

  if (maximum <= 1) {
    return { end: 1, start: 1 };
  }

  if (start >= end) {
    return start >= maximum ? { end: maximum, start: maximum - 1 } : { end: start + 1, start };
  }

  return { end, start };
}

export function buildAnalysisData(
  draws: Draw[],
  lottery: LotteryDefinition | null,
  period: AnalysisPeriod,
  scope: DuplaSenaAnalysisScope,
  requestedRange?: AnalysisDrawRange,
): AnalysisData | null {
  if (!lottery || !draws.length) {
    return null;
  }

  const normalizedRange = period === "all" && requestedRange ? normalizeRequestedRange(requestedRange, draws.length) : undefined;
  const selectedDraws = (normalizedRange
    ? draws.slice(normalizedRange.start - 1, normalizedRange.end)
    : period === "all"
      ? draws
      : draws.slice(0, period)
  ).filter((draw) => getNumbersForAnalysis(draw, scope).length > 0);

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
    periodLabel: getAnalysisPeriodLabel(period, selectedDraws.length, normalizedRange),
    scopeLabel: getAnalysisScopeLabel(scope),
  };
}
