"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { DEFAULT_CHAT_SUGGESTIONS, type ChatSuggestion } from "@/lib/chatSuggestions";
import { getDisplayGroups, type AnalysisData } from "@/lib/analysis";
import type { Draw } from "@/lib/types";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  contextKey?: string;
  id: string;
  role: ChatRole;
  content: string;
};

type ChatContextDraw = {
  drawNumber: number;
  date: string;
  numbers: string[];
  numberGroups?: string[][];
};

type ChatNumberStat = {
  hits: number;
  lastDrawNumber: number | null;
  number: string;
  overdue: number;
};

type ChatAnalysisSummary = {
  delayed: ChatNumberStat[];
  drawCount: number;
  least: ChatNumberStat[];
  most: ChatNumberStat[];
  numbers: ChatNumberStat[];
  periodLabel: string;
  scopeLabel: string;
  viewLabel: string;
};

type ChatApiPayload = {
  reply?: string;
  error?: string;
};

type ChatSuggestionsPayload = {
  suggestions?: ChatSuggestion[];
};

type ChatError = {
  contextKey: string;
  message: string;
};

type ResultsChatPanelProps = {
  activeDrawNumber: string;
  analysisData: AnalysisData | null;
  analysisViewLabel: string;
  draws: Draw[];
  isLoading: boolean;
  lottery: LotteryDefinition;
  numberFilter: string[];
};

type ResultsChatPanelSessionProps = ResultsChatPanelProps & {
  analysisSummary: ChatAnalysisSummary | null;
  contextDraws: ChatContextDraw[];
  contextKey: string;
  contextLabel: string;
  introMessage: string;
  isOpen: boolean;
  lotteryName: string;
  onOpenChange: (isOpen: boolean) => void;
};

const CHAT_CONTEXT_DRAW_LIMIT = 120;
const CHAT_HISTORY_LIMIT = 12;

function createMessage(role: ChatRole, content: string, contextKey?: string): ChatMessage {
  return {
    content,
    contextKey,
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
  };
}

function formatLotteryName(slug: string): string {
  return slug.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function toContextDraw(draw: Draw): ChatContextDraw {
  return {
    date: draw.date,
    drawNumber: draw.drawNumber,
    numberGroups: getDisplayGroups(draw),
    numbers: draw.numbers,
  };
}

function buildContextLabel(data: AnalysisData | null): string {
  if (!data) {
    return "Sem contexto carregado";
  }

  if (data.scopeLabel === "Todos os sorteios") {
    return data.periodLabel;
  }

  return `${data.periodLabel} · ${data.scopeLabel}`;
}

function buildIntroMessage(lotteryName: string, contextLabel: string, drawCount: number, numberFilter: string[], activeDrawNumber: string): string {
  if (!drawCount) {
    return "Carregue ou pesquise resultados para conversar comigo sobre os concursos encontrados.";
  }

  if (activeDrawNumber.trim()) {
    return `Estou pronto para conversar sobre o concurso ${activeDrawNumber.trim()} da ${lotteryName}.`;
  }

  const filterText = numberFilter.length ? ` com filtro ${numberFilter.join(", ")}` : "";
  return `Estou pronto para conversar sobre ${contextLabel.toLowerCase()} da ${lotteryName}${filterText}. Pergunte sobre padrões, atrasos, repetições ou hipóteses estatísticas.`;
}

function buildContextKey(
  lottery: LotteryDefinition,
  draws: Draw[],
  numberFilter: string[],
  activeDrawNumber: string,
  contextLabel: string,
  analysisViewLabel: string,
): string {
  const firstDrawNumber = draws[0]?.drawNumber ?? "none";
  const lastDrawNumber = draws[draws.length - 1]?.drawNumber ?? "none";
  return [
    lottery.slug,
    activeDrawNumber.trim(),
    contextLabel,
    analysisViewLabel,
    numberFilter.join("-"),
    draws.length,
    firstDrawNumber,
    lastDrawNumber,
  ].join("|");
}

function toChatNumberStat(item: AnalysisData["stats"][number]): ChatNumberStat {
  return {
    hits: item.hits,
    lastDrawNumber: item.lastDrawNumber,
    number: item.number,
    overdue: item.overdue,
  };
}

function buildAnalysisSummary(data: AnalysisData | null, viewLabel: string): ChatAnalysisSummary | null {
  if (!data) {
    return null;
  }

  return {
    delayed: data.delayed.slice(0, 18).map(toChatNumberStat),
    drawCount: data.drawCount,
    least: data.least.slice(0, 18).map(toChatNumberStat),
    most: data.most.slice(0, 18).map(toChatNumberStat),
    numbers: data.stats.map(toChatNumberStat),
    periodLabel: data.periodLabel,
    scopeLabel: data.scopeLabel,
    viewLabel,
  };
}

function buildContextCardText(
  lotteryName: string,
  contextLabel: string,
  drawCount: number,
  sentDrawCount: number,
  numberFilter: string[],
  activeDrawNumber: string,
): string {
  if (!drawCount) {
    return `${lotteryName} · carregue resultados para ativar o chat.`;
  }

  const parts = [`${lotteryName}`, `${drawCount} concurso(s)`];

  if (sentDrawCount && sentDrawCount < drawCount) {
    parts.push(`resumo completo + ${sentDrawCount} recentes`);
  } else {
    parts.push("resultados completos no contexto");
  }

  if (numberFilter.length) {
    parts.push(`números: ${numberFilter.join(" · ")}`);
  }

  if (activeDrawNumber.trim()) {
    parts.push(`concurso ${activeDrawNumber.trim()}`);
  }

  return `${contextLabel} · ${parts.join(" · ")}`;
}

function getChatAnalyticsData({
  activeDrawNumber,
  analysisSummary,
  contextDrawCount,
  contextDrawsSent,
  contextLabel,
  lottery,
  numberFilter,
}: {
  activeDrawNumber: string;
  analysisSummary: ChatAnalysisSummary | null;
  contextDrawCount: number;
  contextDrawsSent: number;
  contextLabel: string;
  lottery: LotteryDefinition;
  numberFilter: string[];
}) {
  return {
    analysisViewLabel: analysisSummary?.viewLabel ?? "",
    contextDrawCount,
    contextDrawsSent,
    contextLabel,
    hasDrawNumber: Boolean(activeDrawNumber.trim()),
    hasNumberFilter: numberFilter.length > 0,
    lottery: lottery.slug,
    numberFilterCount: numberFilter.length,
    numbersPerDraw: lottery.numbersPerDraw,
    totalNumbers: lottery.countNumbers,
  };
}

type MarkdownBlock =
  | { text: string; type: "code" | "heading" | "paragraph" }
  | { items: string[]; ordered: boolean; type: "list" };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const paragraphLines: string[] = [];
  let codeLines: string[] | null = null;

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    blocks.push({ text: paragraphLines.join(" "), type: "paragraph" });
    paragraphLines.length = 0;
  }

  function pushListItem(ordered: boolean, item: string) {
    const previous = blocks[blocks.length - 1];

    if (previous?.type === "list" && previous.ordered === ordered) {
      previous.items.push(item);
      return;
    }

    blocks.push({ items: [item], ordered, type: "list" });
  }

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (codeLines) {
        blocks.push({ text: codeLines.join("\n"), type: "code" });
        codeLines = null;
      } else {
        flushParagraph();
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ text: heading[2], type: "heading" });
      continue;
    }

    const unorderedItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (unorderedItem) {
      flushParagraph();
      pushListItem(false, unorderedItem[1]);
      continue;
    }

    const orderedItem = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (orderedItem) {
      flushParagraph();
      pushListItem(true, orderedItem[1]);
      continue;
    }

    paragraphLines.push(trimmed);
  }

  if (codeLines) {
    blocks.push({ text: codeLines.join("\n"), type: "code" });
  }

  flushParagraph();
  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return part;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className="chat-markdown">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <strong className="chat-markdown-heading" key={`${block.type}-${index}`}>
              {renderInlineMarkdown(block.text)}
            </strong>
          );
        }

        if (block.type === "code") {
          return (
            <pre key={`${block.type}-${index}`}>
              <code>{block.text}</code>
            </pre>
          );
        }

        if (block.type === "list") {
          const items = block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>);
          return block.ordered ? <ol key={`${block.type}-${index}`}>{items}</ol> : <ul key={`${block.type}-${index}`}>{items}</ul>;
        }

        return <p key={`${block.type}-${index}`}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

export function ResultsChatPanel({
  activeDrawNumber,
  analysisData,
  analysisViewLabel,
  draws,
  isLoading,
  lottery,
  numberFilter,
}: ResultsChatPanelProps) {
  const lotteryName = useMemo(() => formatLotteryName(lottery.slug), [lottery.slug]);
  const contextDraws = useMemo(() => draws.slice(0, CHAT_CONTEXT_DRAW_LIMIT).map(toContextDraw), [draws]);
  const contextLabel = useMemo(() => buildContextLabel(analysisData), [analysisData]);
  const analysisSummary = useMemo(() => buildAnalysisSummary(analysisData, analysisViewLabel), [analysisData, analysisViewLabel]);
  const [isOpen, setIsOpen] = useState(false);
  const contextKey = useMemo(
    () => buildContextKey(lottery, draws, numberFilter, activeDrawNumber, contextLabel, analysisViewLabel),
    [activeDrawNumber, analysisViewLabel, contextLabel, draws, lottery, numberFilter],
  );
  const introMessage = useMemo(
    () => buildIntroMessage(lotteryName, contextLabel, analysisSummary?.drawCount ?? draws.length, numberFilter, activeDrawNumber),
    [activeDrawNumber, analysisSummary?.drawCount, contextLabel, draws.length, lotteryName, numberFilter],
  );

  return (
    <ResultsChatPanelSession
      activeDrawNumber={activeDrawNumber}
      analysisData={analysisData}
      analysisSummary={analysisSummary}
      analysisViewLabel={analysisViewLabel}
      contextDraws={contextDraws}
      contextKey={contextKey}
      contextLabel={contextLabel}
      draws={draws}
      introMessage={introMessage}
      isLoading={isLoading}
      isOpen={isOpen}
      lottery={lottery}
      lotteryName={lotteryName}
      numberFilter={numberFilter}
      onOpenChange={setIsOpen}
    />
  );
}

function ResultsChatPanelSession({
  activeDrawNumber,
  analysisSummary,
  contextDraws,
  contextKey,
  contextLabel,
  draws,
  introMessage,
  isLoading,
  isOpen,
  lottery,
  lotteryName,
  numberFilter,
  onOpenChange,
}: ResultsChatPanelSessionProps) {
  const contextDrawCount = analysisSummary?.drawCount ?? draws.length;
  const canChat = contextDrawCount > 0 && !isLoading;
  const contextCardText = buildContextCardText(
    lotteryName,
    contextLabel,
    contextDrawCount,
    contextDraws.length,
    numberFilter,
    activeDrawNumber,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createMessage("assistant", introMessage, contextKey)]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>(DEFAULT_CHAT_SUGGESTIONS);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  function getCurrentChatAnalyticsData() {
    return getChatAnalyticsData({
      activeDrawNumber,
      analysisSummary,
      contextDrawCount,
      contextDrawsSent: contextDraws.length,
      contextLabel,
      lottery,
      numberFilter,
    });
  }

  useEffect(() => {
    let isMounted = true;

    async function loadSuggestions() {
      try {
        const response = await fetch("/api/chat/suggestions", { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as ChatSuggestionsPayload;

        if (isMounted && Array.isArray(payload.suggestions) && payload.suggestions.length) {
          setSuggestions(payload.suggestions.slice(0, 4));
        }
      } catch {
        // Keep client-side defaults when runtime suggestions cannot be loaded.
      }
    }

    void loadSuggestions();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = input.trim();

    if (!question || !canChat || isSending) {
      return;
    }

    const matchedSuggestion = suggestions.find((suggestion) => suggestion.message === question);
    const requestContextKey = contextKey;
    const promptForModel = matchedSuggestion?.prompt ?? question;
    const userMessage = createMessage("user", question, requestContextKey);
    const apiUserMessage = createMessage("user", promptForModel, requestContextKey);
    const nextMessages = [...messages, userMessage];
    const apiMessages = [...messages, apiUserMessage]
      .filter((message) => message.contextKey === requestContextKey)
      .slice(-CHAT_HISTORY_LIMIT)
      .map((message) => ({ content: message.content, role: message.role }));

    setMessages(nextMessages);
    setInput("");
    setChatError(null);
    setIsSending(true);
    trackEvent(ANALYTICS_EVENTS.chatQuestionSent, {
      ...getCurrentChatAnalyticsData(),
      questionLength: question.length,
      source: matchedSuggestion ? "suggestion" : "manual",
    });

    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({
          context: {
            activeDrawNumber: activeDrawNumber.trim(),
            analysisSummary,
            analysisViewLabel: analysisSummary?.viewLabel,
            contextLabel,
            filterNumbers: numberFilter,
            lotteryName,
            lotterySlug: lottery.slug,
            totalFilteredDraws: contextDrawCount,
            visibleDraws: contextDraws,
          },
          messages: apiMessages,
        }),
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as ChatApiPayload;

      if (!response.ok) {
        throw new Error(payload.error || `Falha HTTP ${response.status}`);
      }

      const reply = payload.reply || "Não recebi uma resposta do Chat GPT agora.";
      setMessages((current) => [
        ...current,
        createMessage("assistant", reply, requestContextKey),
      ]);
      trackEvent(ANALYTICS_EVENTS.chatAnswerReceived, {
        ...getCurrentChatAnalyticsData(),
        replyLength: reply.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não consegui conversar com o Chat GPT agora.";
      setChatError({ contextKey: requestContextKey, message });
      setMessages((current) => [
        ...current,
        createMessage("assistant", "Não consegui responder agora. Tente novamente em instantes ou ajuste o filtro de resultados.", requestContextKey),
      ]);
      trackEvent(ANALYTICS_EVENTS.chatFailed, {
        ...getCurrentChatAnalyticsData(),
        source: matchedSuggestion ? "suggestion" : "manual",
      });
    } finally {
      setIsSending(false);
    }
  }

  function applySuggestedPrompt(suggestion: ChatSuggestion) {
    if (!canChat || isSending) {
      return;
    }

    setInput(suggestion.message);
    trackEvent(ANALYTICS_EVENTS.chatSuggestionUsed, {
      ...getCurrentChatAnalyticsData(),
      suggestionId: suggestion.id,
      suggestionLabel: suggestion.label,
    });
  }

  return (
    <details
      className="results-chat-panel"
      onToggle={(event) => {
        const nextIsOpen = event.currentTarget.open;
        onOpenChange(nextIsOpen);

        if (nextIsOpen) {
          trackEvent(ANALYTICS_EVENTS.chatOpened, getCurrentChatAnalyticsData());
        } else {
          trackEvent(ANALYTICS_EVENTS.chatClosed, getCurrentChatAnalyticsData());
        }
      }}
      open={isOpen}
    >
      <summary className="results-chat-summary">
        <strong>Chat GPT</strong>
      </summary>

      <div className="results-chat-body" aria-label="Chat GPT sobre os resultados filtrados">
        <div className="chat-context-card">
          <span>Contexto da conversa</span>
          <strong>{contextLabel}</strong>
          <p>{contextCardText}</p>
        </div>

        <div className="chat-message-list" ref={messageListRef}>
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <span>{message.role === "assistant" ? "Chat GPT" : "Você"}</span>
              <div className="chat-message-content">
                <MarkdownMessage content={message.content} />
              </div>
            </article>
          ))}
          {isSending ? (
            <article className="chat-message assistant pending">
              <span>Chat GPT</span>
              <div className="chat-message-content">
                <p>Analisando os concursos filtrados...</p>
              </div>
            </article>
          ) : null}
        </div>

        <div className="chat-suggestions" aria-label="Sugestões de perguntas">
          {suggestions.map((suggestion) => (
            <button disabled={!canChat || isSending} key={suggestion.id} onClick={() => applySuggestedPrompt(suggestion)} type="button">
              {suggestion.label}
            </button>
          ))}
        </div>

        {chatError?.contextKey === contextKey ? <p className="chat-error">{chatError.message}</p> : null}

        <form className="chat-input-form" onSubmit={sendMessage}>
          <textarea
            aria-label="Mensagem para o Chat GPT"
            disabled={!canChat || isSending}
            id="results-chat-input"
            maxLength={900}
            onChange={(event) => setInput(event.target.value)}
            placeholder={canChat ? "Pergunte sobre padrões, números, atrasos..." : "Carregue resultados para ativar o chat"}
            rows={3}
            value={input}
          />
          <button className={isSending ? "sending" : undefined} disabled={!canChat || isSending || !input.trim()} type="submit">
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </div>
    </details>
  );
}
