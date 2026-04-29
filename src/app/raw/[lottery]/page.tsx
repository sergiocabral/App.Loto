import Image from "next/image";
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

function formatDateForDownloadName(value: string | undefined): string | null {
  const date = value?.trim();

  if (!date) {
    return null;
  }

  const brazilianDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);

  if (brazilianDate) {
    const [, day, month, year] = brazilianDate;
    return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);

  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  return null;
}

function buildDownloadFileName(lotterySlug: string, date: string | undefined): string {
  const formattedDate = formatDateForDownloadName(date);
  return `luckygames-resultados-${lotterySlug}${formattedDate ? `-${formattedDate}` : ""}.txt`;
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
          <Link aria-label="Voltar para o início" className="brand-home raw-page-brand" href="/">
            <Image alt="Luckygames" className="brand-icon" height={56} priority src="/gohorse.png" width={56} />
            <span>Luckygames</span>
          </Link>
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
  const latestDownloadDate = draw?.date || history[0]?.date;
  const legacyApiUrl = `/api/lotteries/${lottery.slug}?format=legacy${hasValidDraw && drawNumber ? `&draw=${drawNumber}` : ""}`;
  const legacyDownloadName = buildDownloadFileName(lottery.slug, latestDownloadDate);

  return (
    <main className="raw-page-shell">
      <section className="raw-page-card">
        <header className="raw-page-header">
          <Link aria-label="Voltar para o início" className="brand-home raw-page-brand" href="/">
            <Image alt="Luckygames" className="brand-icon" height={56} priority src="/gohorse.png" width={56} />
            <span>Luckygames</span>
          </Link>
          <div className="raw-page-title-row">
            <div>
              <h1>{title}</h1>
              <span>
                {hasValidDraw ? (draw ? "1 concurso" : "0 concursos") : `${totalDraws} concurso${totalDraws === 1 ? "" : "s"}`}
              </span>
            </div>
            <a
              className="raw-page-link raw-page-link-download"
              data-umami-event="Download resultados"
              data-umami-event-has-draw-number={String(hasValidDraw)}
              data-umami-event-lottery={lottery.slug}
              data-umami-event-total-draws={String(totalDraws)}
              download={legacyDownloadName}
              href={legacyApiUrl}
            >
              Download
            </a>
          </div>
        </header>

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
