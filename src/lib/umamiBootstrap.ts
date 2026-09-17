export const UMAMI_BEFORE_SEND_HANDLER = "luckygamesUmamiBeforeSend";

export const UMAMI_DISABLED_STORAGE_KEY = "umami.disabled";

export const ANALYTICS_QUERY_PARAM = "analytics";

type UmamiPayload = Record<string, unknown>;

type BootstrapWindow = Pick<Window, "history" | "location" | "self" | "top"> & {
  localStorage?: Storage;
};

/**
 * Preparação do Umami executada inline no <head>, antes de qualquer script do Umami — inclusive o que o
 * proxy injeta no fim do <body> para o website global. Precisa ser autocontida: é serializada com
 * toString(), então não pode usar imports, constantes do módulo nem helpers externos.
 *
 * - `?analytics=off|on` liga/desliga o rastreamento neste navegador (flag nativa `umami.disabled`,
 *   respeitada por todos os scripts do Umami) e sai da URL antes de qualquer tracker lê-la.
 * - Dentro de iframe (ex.: visualização do heatmap no painel do Umami) nada é rastreado.
 * - O hook `data-before-send` corrige URLs no formato `/https://host/caminho`, geradas pelo script.js
 *   customizado do servidor, para que pageviews batam com os caminhos do heatmap e do replay.
 */
export function installUmamiBootstrap(win: BootstrapWindow): void {
  const disabledKey = "umami.disabled";
  const queryParam = "analytics";
  let framed = false;

  try {
    framed = win.self !== win.top;
  } catch {
    framed = true;
  }

  const setTrackingDisabled = (disabled: boolean) => {
    try {
      if (disabled) {
        win.localStorage?.setItem(disabledKey, "1");
      } else {
        win.localStorage?.removeItem(disabledKey);
      }
    } catch {
      // Armazenamento bloqueado: segue sem a preferência persistida.
    }
  };

  try {
    const url = new URL(win.location.href);
    let choice: string | null = null;
    const keptSegments: string[] = [];

    // Remove só o parâmetro de controle, preservando os demais segmentos crus (ex.: `/?Megasena`).
    for (const segment of url.search.slice(1).split("&")) {
      if (!segment) {
        continue;
      }

      const separatorIndex = segment.indexOf("=");
      const rawKey = separatorIndex === -1 ? segment : segment.slice(0, separatorIndex);
      let key = rawKey;

      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        // Mantém a chave crua quando a decodificação falha.
      }

      if (key === queryParam) {
        choice = separatorIndex === -1 ? "" : segment.slice(separatorIndex + 1).toLowerCase();
        continue;
      }

      keptSegments.push(segment);
    }

    if (choice !== null) {
      if (choice === "off") {
        setTrackingDisabled(true);
      } else if (choice === "on") {
        setTrackingDisabled(false);
      }

      const query = keptSegments.join("&");
      win.history.replaceState(win.history.state, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
    }
  } catch {
    // Melhor esforço: nunca deve impedir a página de carregar.
  }

  if (framed) {
    setTrackingDisabled(true);
  }

  const normalizeUrl = (value: unknown) => {
    if (typeof value !== "string" || !value) {
      return value;
    }

    try {
      const parsed = new URL(value, win.location.href);
      const nestedUrl = /^\/(https?:\/\/.+)$/i.exec(parsed.pathname);

      return nestedUrl ? `${nestedUrl[1]}${parsed.search}${parsed.hash}` : value;
    } catch {
      return value;
    }
  };

  let lastPageviewUrl: unknown = null;

  (win as unknown as Record<string, unknown>)["luckygamesUmamiBeforeSend"] = (type: string, payload: UmamiPayload) => {
    if (framed) {
      return false;
    }

    if (!payload || typeof payload !== "object") {
      return payload;
    }

    const nextPayload: UmamiPayload = { ...payload };

    if (typeof nextPayload.url === "string") {
      nextPayload.url = normalizeUrl(nextPayload.url);
    }

    if (typeof nextPayload.referrer === "string") {
      nextPayload.referrer = normalizeUrl(nextPayload.referrer);
    }

    // Pageview = evento sem nome. Como a URL inicial do script customizado difere da real, o
    // replaceState que o Next faz na hidratação parece uma navegação e gera um segundo pageview da
    // mesma página (com ela mesma como referrer): esse é descartado.
    if (type === "event" && !nextPayload.name && typeof nextPayload.url === "string") {
      if (nextPayload.url === lastPageviewUrl && nextPayload.referrer === nextPayload.url) {
        return false;
      }

      lastPageviewUrl = nextPayload.url;
    }

    return nextPayload;
  };
}

export function getUmamiBootstrapScript(): string {
  return `(${installUmamiBootstrap.toString()})(window);`;
}
