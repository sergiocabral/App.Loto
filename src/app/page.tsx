import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { HomePage } from "@/components/HomePage";
import { getLottery } from "@/data/lotteries";
import { collectMissingDraws, getOrFetchDraw, loadLotteryHistory } from "@/lib/server/service";
import { renderDrawText, renderHistoryText } from "@/lib/render";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseLegacyQuery(searchParams: Record<string, string | string[] | undefined>): string[] {
  const entries = Object.entries(searchParams);

  if (!entries.length) {
    return [];
  }

  const [key, value] = entries[0];
  const raw = value === "" || value === undefined ? key : `${key}/${Array.isArray(value) ? value[0] : value}`;

  return raw.split("/").filter(Boolean);
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = parseLegacyQuery(await searchParams);
  const lotterySlug = params[0];
  const drawNumber = params[1];

  return (
    <AppShell>
      {!lotterySlug ? <HomePage /> : <LotteryPage lotterySlug={lotterySlug} drawNumber={drawNumber} />}
    </AppShell>
  );
}

async function LotteryPage({ lotterySlug, drawNumber }: { lotterySlug: string; drawNumber?: string }) {
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    return <HomePage />;
  }

  if (drawNumber) {
    return <DrawLookup lotterySlug={lottery.slug} drawNumber={drawNumber} />;
  }

  return <LotteryHistory lotterySlug={lottery.slug} />;
}

async function DrawLookup({ lotterySlug, drawNumber }: { lotterySlug: string; drawNumber: string }) {
  const numericDrawNumber = Number.parseInt(drawNumber, 10);

  if (!Number.isFinite(numericDrawNumber) || numericDrawNumber < 1) {
    return (
      <>
        <h2>Loteria: {lotterySlug}</h2>
        <div className="label error">O sorteio deve ser numérico e maior que zero.</div>
      </>
    );
  }

  const draw = await getOrFetchDraw(lotterySlug, numericDrawNumber);
  const text = draw ? renderDrawText(draw, false) : "";

  return (
    <>
      <h2>Loteria: {lotterySlug}</h2>
      <div className="label loaded">Consulta do sorteio {numericDrawNumber}:</div>
      <pre>{text}</pre>
      {!draw ? <div className="label error">Sem resultados.</div> : null}
    </>
  );
}

async function LotteryHistory({ lotterySlug }: { lotterySlug: string }) {
  const collection = await collectMissingDraws(lotterySlug, 10);
  const history = await loadLotteryHistory(lotterySlug);
  const text = renderHistoryText(history);

  return (
    <>
      <h2>Loteria: {lotterySlug}</h2>
      {collection.hasMore ? (
        <>
          <div className="label loading">Coletando resultados...</div>
          <AutoRefresh />
        </>
      ) : (
        <div className="label loaded">Todos os resultados foram carregados.</div>
      )}
      <pre>{text}</pre>
    </>
  );
}
