import { getCanonicalRedirectUrl } from "@/lib/siteUrl";

type WorkerEnv = {
  OFFICIAL_DOMAIN_NAME?: string;
};

type WorkerContext = {
  passThroughOnException(): void;
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerHandler = {
  fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Response | Promise<Response>;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function createCanonicalRedirectResponse(redirectUrl: URL): Response {
  const redirectHref = redirectUrl.href;
  const safeScriptHref = JSON.stringify(redirectHref).replace(/</g, "\\u003c");
  const safeHtmlHref = escapeHtml(redirectHref);

  return new Response(
    `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0;url=${safeHtmlHref}">
    <link rel="canonical" href="${safeHtmlHref}">
    <title>Redirecionando para Luckygames</title>
    <script>window.location.replace(${safeScriptHref});</script>
  </head>
  <body>
    <p>Redirecionando para <a href="${safeHtmlHref}">${safeHtmlHref}</a>...</p>
  </body>
</html>`,
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 200,
    },
  );
}

export function createWorker(handler: WorkerHandler) {
  return {
    fetch(request: Request, env: WorkerEnv, ctx: WorkerContext): Response | Promise<Response> {
      const redirectUrl = getCanonicalRedirectUrl(new URL(request.url), env.OFFICIAL_DOMAIN_NAME);

      if (redirectUrl) {
        return createCanonicalRedirectResponse(redirectUrl);
      }

      return handler.fetch(request, env, ctx);
    },
  };
}
