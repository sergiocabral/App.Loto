import { AppShell } from "@/components/AppShell";
import { HomePage } from "@/components/HomePage";
import { isOpenAIChatConfigured } from "@/lib/server/env";

export const dynamic = "force-dynamic";

const PAGE_LOG_PREFIX = "[app-loto-next][page]";

function logPage(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(PAGE_LOG_PREFIX, message, details);
    return;
  }

  console.info(PAGE_LOG_PREFIX, message);
}

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

  const isChatEnabled = isOpenAIChatConfigured();

  logPage("Home:start", { drawNumber: drawNumber ?? null, isChatEnabled, lotterySlug: lotterySlug ?? null, params });

  return (
    <AppShell>
      <HomePage initialLotterySlug={lotterySlug} initialDrawNumber={drawNumber} isChatEnabled={isChatEnabled} />
    </AppShell>
  );
}
