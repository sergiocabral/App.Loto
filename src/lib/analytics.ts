export const ANALYTICS_EVENTS = {
  chatAnswerReceived: "Recebeu resposta chat",
  chatClosed: "Fechou chat",
  chatFailed: "Falhou chat",
  chatOpened: "Abriu chat",
  chatQuestionSent: "Enviou pergunta chat",
  chatSuggestionUsed: "Usou sugestão chat",
  clearedFilter: "Limpou filtro",
  copyDraw: "Copiou sorteio",
  copySuggestion: "Copiou sugestão",
  donationLinkClicked: "Clicou idontneedit.org",
  downloadResults: "Download resultados",
  generatedSuggestion: "Gerou sugestão",
  loadMoreDraws: "Carregou mais resultados",
  lotterySelected: "Selecionou loteria",
  luckyButtonClicked: "Clicou Estou com sorte",
  openRawResults: "Abriu todos sorteios",
  searchedDraw: "Consultou concurso",
  searchedNumbers: "Pesquisou números",
  syncFailed: "Falhou sincronização",
  syncFinished: "Finalizou sincronização",
  syncPaused: "Pausou sincronização",
  syncStarted: "Iniciou sincronização",
  updatedAnalysisPeriod: "Mudou período análise",
  updatedAnalysisRange: "Ajustou faixa análise",
  updatedAnalysisScope: "Mudou sorteio análise",
  updatedAnalysisView: "Mudou análise rápida",
} as const;

type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsEventData = Record<string, AnalyticsPrimitive | undefined>;

declare global {
  interface Window {
    umami?: {
      track?: (eventName: string, data?: Record<string, AnalyticsPrimitive>) => unknown;
    };
  }
}

function sanitizeEventData(data?: AnalyticsEventData): Record<string, AnalyticsPrimitive> | undefined {
  if (!data) {
    return undefined;
  }

  const entries = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .slice(0, 24)
    .map(([key, value]) => {
      if (typeof value === "string") {
        return [key, value.trim().slice(0, 180)] as const;
      }

      if (typeof value === "number") {
        return [key, Number.isFinite(value) ? value : 0] as const;
      }

      return [key, value ?? null] as const;
    });

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function trackEvent(eventName: string, data?: AnalyticsEventData): void {
  if (typeof window === "undefined") {
    return;
  }

  const name = eventName.trim().slice(0, 50);
  const umami = window.umami;

  if (!name || typeof umami?.track !== "function") {
    return;
  }

  try {
    const sanitizedData = sanitizeEventData(data);

    if (sanitizedData) {
      umami.track(name, sanitizedData);
      return;
    }

    umami.track(name);
  } catch {
    // Analytics must never affect the app flow.
  }
}
