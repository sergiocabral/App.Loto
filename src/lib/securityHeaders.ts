export type SecurityHeader = {
  key: string;
  value: string;
};

/** Origens que podem exibir o site em iframe: o próprio site e o painel do Umami (heatmap). */
export function getFrameAncestorSources(umamiScriptUrl?: string): string[] {
  const sources = ["'self'"];
  const rawUrl = umamiScriptUrl?.trim();

  if (!rawUrl) {
    return sources;
  }

  try {
    const url = new URL(rawUrl);

    if (url.protocol === "https:" || url.protocol === "http:") {
      sources.push(url.origin);
    }
  } catch {
    // URL inválida: mantém apenas o próprio site.
  }

  return sources;
}

// Importado pelo next.config.ts: use apenas imports relativos (sem o alias "@/").
export function buildSecurityHeaders(umamiScriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL): SecurityHeader[] {
  return [
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    // O heatmap do Umami exibe a página real num iframe do painel, então não há X-Frame-Options: DENY
    // (bloquearia o painel). frame-ancestors restringe quem pode embutir o site; em produção, porém, o
    // nginx-proxy-manager substitui a CSP do app pela dele, e o site fica embutível por qualquer origem
    // — risco de clickjacking aceito para este projeto.
    {
      key: "Content-Security-Policy",
      value: `frame-ancestors ${getFrameAncestorSources(umamiScriptUrl).join(" ")}`,
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}
