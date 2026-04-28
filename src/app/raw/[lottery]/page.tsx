import Link from "next/link";
import { getLottery } from "@/data/lotteries";
import { loadLotteryHistory, getStoredDraw } from "@/lib/server/service";
import { parsePositiveInteger } from "@/lib/server/security";
import { renderDrawText, renderHistoryText } from "@/lib/render";

export const dynamic = "force-dynamic";

type RawPageProps = {
  params: Promise<{ lottery: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function readSingleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RawLotteryPage({ params, searchParams }: RawPageProps) {
  const { lottery: lotteryParam } = await params;
  const lottery = getLottery(lotteryParam);
  const query = await searchParams;
  const drawParam = readSingleParam(query.draw);
  const hasDrawParam = drawParam.trim().length > 0;
  const drawNumber = hasDrawParam ? parsePositiveInteger(drawParam) : null;
  const hasValidDraw = Boolean(drawNumber);
  const hasInvalidDraw = hasDrawParam && !drawNumber;

  if (!lottery) {
    return (
      <main className="raw-page-shell">
        <section className="raw-page-card">
          <span className="eyebrow">Luckygames</span>
          <h1>Jogo não encontrado</h1>
          <p>Volte para a consulta principal e selecione uma loteria disponível.</p>
          <Link className="raw-page-link" href="/">
            Voltar para o Luckygames
          </Link>
        </section>
      </main>
    );
  }

  const draw = hasValidDraw && drawNumber ? await getStoredDraw(lottery.slug, drawNumber) : null;
  const history = !hasValidDraw && !hasInvalidDraw ? await loadLotteryHistory(lottery.slug) : [];
  const text = hasValidDraw ? (draw ? renderDrawText(draw, false) : "") : hasInvalidDraw ? "" : renderHistoryText(history);
  const title = hasValidDraw && drawNumber
    ? `${formatLotteryName(lottery.slug)} — concurso ${drawNumber}`
    : hasInvalidDraw
      ? `${formatLotteryName(lottery.slug)} — concurso inválido`
      : formatLotteryName(lottery.slug);
  const totalDraws = hasValidDraw ? (draw ? 1 : 0) : history.length;
  const legacyApiUrl = `/api/lotteries/${lottery.slug}?format=legacy${hasValidDraw && drawNumber ? `&draw=${drawNumber}` : ""}`;

  return (
    <main className="raw-page-shell">
      <section className="raw-page-card">
        <div className="raw-page-header">
          <div>
            <span className="eyebrow">Luckygames</span>
            <h1>Visão crua dos resultados</h1>
            <p>
              {title} em formato de texto, com espaçamento preservado para facilitar a leitura visual dos padrões. Dados gerados a partir do banco do Luckygames.
            </p>
          </div>
          <div className="raw-page-actions">
            <a className="raw-page-link raw-page-link-download" href={legacyApiUrl} rel="noreferrer" target="_blank">
              Abrir TXT puro
              <small>para salvar como .txt</small>
            </a>
          </div>
        </div>

        <div className="raw-page-meta" aria-label="Resumo da visão crua">
          <div>
            <span>Jogo</span>
            <strong>{formatLotteryName(lottery.slug)}</strong>
          </div>
          <div>
            <span>{hasValidDraw ? "Concurso" : "Concursos"}</span>
            <strong>{hasValidDraw ? drawNumber : totalDraws}</strong>
          </div>
          <div>
            <span>Formato</span>
            <strong>Texto bruto</strong>
          </div>
        </div>

        {text ? (
          <pre className="raw-page-pre">{text}</pre>
        ) : (
          <div className="empty-state compact">
            <strong>{hasInvalidDraw ? "Concurso inválido" : "Nenhum resultado salvo"}</strong>
            <p>{hasInvalidDraw ? "Informe apenas números positivos para abrir um concurso específico." : "Sincronize os resultados no Luckygames para preencher esta visão."}</p>
          </div>
        )}
      </section>
    </main>
  );
}
