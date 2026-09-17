"use client";

import { useEffect } from "react";
import { identifySession } from "@/lib/analytics";
import { loadInitialAccessStatus } from "@/lib/client/accessStatus";
import { UMAMI_DISABLED_STORAGE_KEY } from "@/lib/umamiBootstrap";

export const UMAMI_RECORDER_SCRIPT_ID = "umami-recorder";

const SESSION_POLL_INTERVAL_MS = 250;
const SESSION_WAIT_TIMEOUT_MS = 20_000;

type UmamiSessionProps = {
  recorderEnabled?: boolean;
  scriptUrl: string;
  websiteId: string;
};

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isTrackingDisabled(): boolean {
  try {
    return Boolean(window.localStorage.getItem(UMAMI_DISABLED_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Token de sessão do tracker deste website (nunca o do website global injetado pelo proxy). */
function readSessionToken(websiteId: string): string | null {
  try {
    const session = window.umami?.getSession?.();
    return session?.website === websiteId && session.cache ? session.cache : null;
  } catch {
    return null;
  }
}

function waitForSessionToken(websiteId: string, isCancelled: () => boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const check = () => {
      if (isCancelled()) {
        resolve(null);
        return;
      }

      const token = readSessionToken(websiteId);

      if (token) {
        resolve(token);
        return;
      }

      if (Date.now() - startedAt >= SESSION_WAIT_TIMEOUT_MS) {
        resolve(null);
        return;
      }

      window.setTimeout(check, SESSION_POLL_INTERVAL_MS);
    };

    check();
  });
}

function injectRecorderScript(scriptUrl: string, websiteId: string): void {
  if (document.getElementById(UMAMI_RECORDER_SCRIPT_ID)) {
    return;
  }

  let src: string;

  try {
    src = new URL("recorder.js", new URL(scriptUrl, window.location.href)).href;
  } catch {
    return;
  }

  const script = document.createElement("script");
  script.dataset.websiteId = websiteId;
  script.defer = true;
  script.id = UMAMI_RECORDER_SCRIPT_ID;
  script.src = src;
  document.head.appendChild(script);
}

/**
 * Enriquece a sessão do Umami e liga o replay/heatmap (recorder.js, rrweb) na ordem certa:
 *
 * 1. espera o tracker deste website obter o token de sessão (o recorder o reutiliza em cada envio);
 * 2. grava o tipo de acesso na sessão (identify) para segmentar replays e sessões por plano;
 * 3. só então carrega o recorder — o identify do Umami limpa o token até a resposta chegar e, com o
 *    recorder ativo, os trechos gravados nesse intervalo seriam descartados.
 *
 * Nada acontece dentro de iframe (pré-visualização do heatmap) ou com o rastreamento desligado
 * (`?analytics=off`). Amostragem, máscara e duração máxima vêm da configuração do website no Umami.
 */
export function UmamiSession({ recorderEnabled = true, scriptUrl, websiteId }: UmamiSessionProps) {
  useEffect(() => {
    if (!scriptUrl || !websiteId || isFramed() || isTrackingDisabled()) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    void (async () => {
      if (!(await waitForSessionToken(websiteId, isCancelled))) {
        return;
      }

      const { known, status } = await loadInitialAccessStatus();

      if (cancelled) {
        return;
      }

      if (known) {
        await identifySession({ accessPlan: status.licensed ? (status.plan ?? "licensed") : "free" });
      }

      if (!recorderEnabled || !(await waitForSessionToken(websiteId, isCancelled))) {
        return;
      }

      injectRecorderScript(scriptUrl, websiteId);
    })();

    return () => {
      cancelled = true;
    };
  }, [recorderEnabled, scriptUrl, websiteId]);

  return null;
}
