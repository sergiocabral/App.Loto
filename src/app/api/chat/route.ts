import { NextResponse } from "next/server";
import { getLottery } from "@/data/lotteries";
import { getServerEnvValue } from "@/lib/server/env";
import { checkMutationRateLimit, readJsonObjectBody } from "@/lib/server/security";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatDraw = {
  drawNumber: number;
  date: string;
  numbers: string[];
  numberGroups?: string[][];
};

type ChatContext = {
  activeDrawNumber?: string;
  filterNumbers: string[];
  lotteryName: string;
  lotterySlug: string;
  totalFilteredDraws: number;
  visibleDraws: ChatDraw[];
};

type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export const dynamic = "force-dynamic";

const CHAT_LOG_PREFIX = "[app-loto-next][chat]";
const MAX_CHAT_BODY_BYTES = 18_000;
const MAX_CONTEXT_DRAWS = 40;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 900;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

function logChat(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(CHAT_LOG_PREFIX, message, details);
    return;
  }

  console.info(CHAT_LOG_PREFIX, message);
}

function logChatError(message: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(CHAT_LOG_PREFIX, message, {
    ...details,
    error: error instanceof Error ? { name: error.name, message: error.message } : error,
  });
}

function sanitizeText(value: unknown, maxLength = MAX_MESSAGE_CHARS): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeText(item, 12))
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeDraw(value: unknown): ChatDraw | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const drawNumber = typeof record.drawNumber === "number" && Number.isSafeInteger(record.drawNumber) ? record.drawNumber : null;

  if (!drawNumber) {
    return null;
  }

  const numberGroups = Array.isArray(record.numberGroups)
    ? record.numberGroups
        .map((group) => sanitizeNumbers(group))
        .filter((group) => group.length)
        .slice(0, 4)
    : undefined;

  return {
    date: sanitizeText(record.date, 40) || "Sem data",
    drawNumber,
    numberGroups,
    numbers: sanitizeNumbers(record.numbers),
  };
}

function sanitizeContext(value: unknown): ChatContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const lotterySlug = sanitizeText(record.lotterySlug, 64);
  const lottery = getLottery(lotterySlug);

  if (!lottery) {
    return null;
  }

  const visibleDraws = Array.isArray(record.visibleDraws)
    ? record.visibleDraws.map(sanitizeDraw).filter((draw): draw is ChatDraw => Boolean(draw)).slice(0, MAX_CONTEXT_DRAWS)
    : [];
  const totalFilteredDraws =
    typeof record.totalFilteredDraws === "number" && Number.isSafeInteger(record.totalFilteredDraws) && record.totalFilteredDraws >= 0
      ? Math.min(record.totalFilteredDraws, 1_000_000)
      : visibleDraws.length;

  return {
    activeDrawNumber: sanitizeText(record.activeDrawNumber, 32) || undefined,
    filterNumbers: sanitizeNumbers(record.filterNumbers),
    lotteryName: sanitizeText(record.lotteryName, 80) || lottery.slug,
    lotterySlug: lottery.slug,
    totalFilteredDraws,
    visibleDraws,
  };
}

function sanitizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" || record.role === "user" ? record.role : null;
      const content = sanitizeText(record.content);

      return role && content ? { role, content } : null;
    })
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-MAX_MESSAGES);
}

function formatDrawForPrompt(draw: ChatDraw): string {
  const groups = draw.numberGroups?.length
    ? draw.numberGroups.map((group, index) => `${index + 1}º: ${group.join("-")}`).join(" | ")
    : draw.numbers.join("-");

  return `#${draw.drawNumber} (${draw.date}): ${groups}`;
}

function buildSystemPrompt(context: ChatContext): string {
  const filterDescription = context.filterNumbers.length
    ? `Filtro aplicado: concursos que contêm ${context.filterNumbers.join(", ")}.`
    : context.activeDrawNumber
      ? `Consulta focada no concurso ${context.activeDrawNumber}.`
      : "Sem filtro numérico ativo; considere o histórico visível enviado.";
  const drawLines = context.visibleDraws.length
    ? context.visibleDraws.map(formatDrawForPrompt).join("\n")
    : "Nenhum concurso visível foi enviado no contexto.";

  return [
    "Você é o assistente Chat GPT do Luckygames.tips para conversar sobre resultados de loterias.",
    "Responda em português do Brasil, com tom claro, útil e direto.",
    "Use somente o contexto de concursos enviado pelo app; se faltar dado, diga que precisa carregar ou filtrar mais resultados.",
    "Não prometa ganhos, não incentive aposta irresponsável e deixe claro quando algo for apenas observação estatística.",
    "Quando fizer listas, seja breve e priorize insights acionáveis sobre os resultados filtrados.",
    `Loteria: ${context.lotteryName} (${context.lotterySlug}).`,
    filterDescription,
    `Total de concursos filtrados no app: ${context.totalFilteredDraws}. Concursos enviados para análise nesta chamada: ${context.visibleDraws.length}.`,
    "Concursos visíveis:",
    drawLines,
  ].join("\n");
}

async function requestOpenAI(messages: OpenAIChatMessage[]): Promise<string> {
  const apiKey = getServerEnvValue("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = getServerEnvValue("OPENAI_CHAT_MODEL") || "gpt-4o-mini";
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    body: JSON.stringify({
      messages,
      model,
      temperature: 0.35,
    }),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as OpenAIChatCompletionResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenAI response did not include a message.");
  }

  return content;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimit = checkMutationRateLimit(request, "chat");

  if (!rateLimit.ok) {
    return NextResponse.json({ error: rateLimit.error }, { status: rateLimit.status });
  }

  const bodyResult = await readJsonObjectBody(request, MAX_CHAT_BODY_BYTES);

  if (!bodyResult.ok) {
    return NextResponse.json({ error: bodyResult.error }, { status: bodyResult.status });
  }

  const context = sanitizeContext(bodyResult.body.context);
  const messages = sanitizeMessages(bodyResult.body.messages);

  if (!context) {
    return NextResponse.json({ error: "Chat context is invalid or missing." }, { status: 400 });
  }

  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "A user message is required." }, { status: 400 });
  }

  try {
    logChat("POST:start", {
      lottery: context.lotterySlug,
      messageCount: messages.length,
      totalFilteredDraws: context.totalFilteredDraws,
      visibleDraws: context.visibleDraws.length,
    });

    const reply = await requestOpenAI([
      { role: "system", content: buildSystemPrompt(context) },
      ...messages.map((message) => ({ role: message.role, content: message.content }) satisfies OpenAIChatMessage),
    ]);

    logChat("POST:done", { elapsedMs: Date.now() - startedAt, lottery: context.lotterySlug });
    return NextResponse.json({ reply });
  } catch (error) {
    logChatError("POST:error", error, { elapsedMs: Date.now() - startedAt, lottery: context.lotterySlug });
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.includes("OPENAI_API_KEY")
            ? "Chat GPT ainda não está configurado no servidor."
            : "Não consegui responder agora. Tente novamente em instantes.",
      },
      { status: 500 },
    );
  }
}
