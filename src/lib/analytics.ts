export const ANALYTICS_EVENTS = {
  accessActivated: "Ativou acesso",
  accessLoggedOut: "Saiu do acesso",
  accessStatusShown: "Exibiu status de acesso",
  chatAnswerReceived: "Recebeu resposta chat",
  chatClosed: "Fechou chat",
  chatFailed: "Falhou chat",
  chatLimitReached: "Atingiu limite chat",
  chatOpened: "Abriu chat",
  chatQuestionSent: "Enviou pergunta chat",
  chatSuggestionUsed: "Usou sugestão chat",
  checkoutReturned: "Retornou do checkout",
  clearedFilter: "Limpou filtro",
  copyDraw: "Copiou sorteio",
  copySuggestion: "Copiou sugestão",
  donationLinkClicked: "Clicou idontneedit.org",
  downloadResults: "Download resultados",
  generatedSuggestion: "Gerou sugestão",
  loadMoreDraws: "Carregou mais resultados",
  lotterySelected: "Selecionou loteria",
  luckyButtonClicked: "Clicou Estou com sorte",
  newAccess: "Novo acesso",
  openRawResults: "Abriu todos sorteios",
  paywallCheckoutFailed: "Falhou checkout",
  paywallCheckoutStarted: "Iniciou checkout",
  paywallClosed: "Fechou paywall",
  paywallEmailMissing: "Paywall sem e-mail",
  paywallLinkAccepted: "Pedido de link aceito",
  paywallLinkFailed: "Falhou pedido de link",
  paywallLinkRequested: "Pediu link de acesso",
  paywallOpened: "Abriu paywall",
  premiumCtaClicked: "Clicou CTA premium",
  premiumCtaShown: "Exibiu CTA premium",
  premiumFeatureBlocked: "Bloqueou recurso premium",
  searchedDraw: "Consultou concurso",
  searchedNumbers: "Pesquisou números",
  simulatorAnalysisChanged: "Mudou análise simulador",
  simulatorAutoAdvanceChanged: "Alternou retrocesso simulador",
  simulatorClosed: "Fechou simulador",
  simulatorCopyReport: "Copiou relatório simulador",
  simulatorCopySuggestion: "Copiou sugestão simulador",
  simulatorCutoffChanged: "Mudou corte simulador",
  simulatorGroupToggled: "Alternou concurso simulador",
  simulatorLimitReached: "Atingiu limite simulador",
  simulatorOpened: "Abriu simulador",
  simulatorPeriodChanged: "Mudou período simulador",
  simulatorRangeChanged: "Ajustou período simulador",
  simulatorSpeedChanged: "Mudou velocidade simulador",
  simulatorStarted: "Iniciou simulação",
  simulatorStopped: "Parou simulação",
  simulatorSuggestionSizeChanged: "Mudou tamanho sugestão simulador",
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

export type UmamiSessionInfo = {
  cache?: string;
  website?: string;
};

declare global {
  interface Window {
    umami?: {
      getSession?: () => UmamiSessionInfo | undefined;
      identify?: (data: Record<string, AnalyticsPrimitive>) => unknown;
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

export function getAnalyticsWebsiteId(): string | null {
  return process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim() || null;
}

/**
 * Devolve o `window.umami` somente quando ele pertence ao website deste app. O proxy de produção injeta
 * um segundo script do Umami (website global); se ele assumir o `window.umami`, os eventos seriam
 * contabilizados no website errado — nesse caso é melhor descartá-los.
 */
export function getOwnUmami(): NonNullable<Window["umami"]> | null {
  if (typeof window === "undefined" || !window.umami) {
    return null;
  }

  const umami = window.umami;
  const expectedWebsiteId = getAnalyticsWebsiteId();

  if (expectedWebsiteId && typeof umami.getSession === "function") {
    try {
      const website = umami.getSession()?.website;

      if (website && website !== expectedWebsiteId) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return umami;
}

export function trackEvent(eventName: string, data?: AnalyticsEventData): boolean {
  const name = eventName.trim().slice(0, 50);
  const umami = getOwnUmami();

  if (!name || typeof umami?.track !== "function") {
    return false;
  }

  try {
    const sanitizedData = sanitizeEventData(data);

    if (sanitizedData) {
      umami.track(name, sanitizedData);
      return true;
    }

    umami.track(name);
    return true;
  } catch {
    // Analytics must never affect the app flow.
    return false;
  }
}

/**
 * Grava dados da sessão no Umami (sem distinct id, para não trocar o id da sessão). Atenção: o identify
 * do Umami descarta o token de sessão até a resposta chegar, então não deve rodar com o gravador de
 * replay ativo — ver UmamiSession.
 */
export async function identifySession(data: AnalyticsEventData): Promise<boolean> {
  const umami = getOwnUmami();
  const sanitizedData = sanitizeEventData(data);

  if (!sanitizedData || typeof umami?.identify !== "function") {
    return false;
  }

  try {
    await umami.identify(sanitizedData);
    return true;
  } catch {
    return false;
  }
}

export type DebouncedTracker = {
  cancel: () => void;
  flush: () => void;
  track: (data?: AnalyticsEventData) => void;
};

/** Agrupa rajadas (sliders, digitação) num único evento com os dados mais recentes. */
export function createDebouncedTracker(eventName: string, delayMs = 800): DebouncedTracker {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingData: AnalyticsEventData | undefined;

  const send = () => {
    timer = undefined;
    const data = pendingData;
    pendingData = undefined;
    trackEvent(eventName, data);
  };

  return {
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }

      timer = undefined;
      pendingData = undefined;
    },
    flush() {
      if (timer === undefined) {
        return;
      }

      clearTimeout(timer);
      send();
    },
    track(data) {
      pendingData = data;

      if (timer !== undefined) {
        clearTimeout(timer);
      }

      timer = setTimeout(send, delayMs);
    },
  };
}
