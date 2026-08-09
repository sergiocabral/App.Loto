import { buildAccessClearCookieHeader } from "@/lib/server/accessCookie";

export const dynamic = "force-dynamic";

// Remove o acesso apenas DESTE dispositivo (limpa o cookie). A licença continua
// válida no servidor — útil para sair de um computador de outra pessoa.
export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": buildAccessClearCookieHeader(),
    },
    status: 200,
  });
}
