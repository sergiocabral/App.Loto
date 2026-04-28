"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { LotteryDefinition } from "@/data/lotteries";
import { getDisplayGroups } from "@/lib/analysis";
import type { Draw } from "@/lib/types";

type ChatRole = "assistant" | "user";

type ChatMessage = {
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

type ChatApiPayload = {
  reply?: string;
  error?: string;
};

type ResultsChatPanelProps = {
  activeDrawNumber: string;
  draws: Draw[];
  isLoading: boolean;
  lottery: LotteryDefinition;
  numberFilter: string[];
};

type ResultsChatPanelSessionProps = ResultsChatPanelProps & {
  contextDraws: ChatContextDraw[];
  introMessage: string;
  lotteryName: string;
};

const CHAT_CONTEXT_DRAW_LIMIT = 40;
const CHAT_HISTORY_LIMIT = 12;

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    content,
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

function buildIntroMessage(lotteryName: string, drawCount: number, numberFilter: string[], activeDrawNumber: string): string {
  if (!drawCount) {
    return "Carregue ou pesquise resultados para conversar comigo sobre os concursos encontrados.";
  }

  if (numberFilter.length) {
    return `Encontrei ${drawCount} concurso(s) com ${numberFilter.join(", ")}. Abra a conversa e pergunte sobre padrões, repetição, atraso ou ideias para analisar esses resultados.`;
  }

  if (activeDrawNumber.trim()) {
    return `Estou pronto para conversar sobre o concurso ${activeDrawNumber.trim()} da ${lotteryName}.`;
  }

  return `Estou pronto para conversar sobre os ${drawCount} resultado(s) carregados da ${lotteryName}.`;
}

function buildContextKey(lottery: LotteryDefinition, draws: Draw[], numberFilter: string[], activeDrawNumber: string): string {
  const firstDrawNumber = draws[0]?.drawNumber ?? "none";
  const lastDrawNumber = draws[draws.length - 1]?.drawNumber ?? "none";
  return [lottery.slug, activeDrawNumber.trim(), numberFilter.join("-"), draws.length, firstDrawNumber, lastDrawNumber].join("|");
}

export function ResultsChatPanel({ activeDrawNumber, draws, isLoading, lottery, numberFilter }: ResultsChatPanelProps) {
  const lotteryName = useMemo(() => formatLotteryName(lottery.slug), [lottery.slug]);
  const contextDraws = useMemo(() => draws.slice(0, CHAT_CONTEXT_DRAW_LIMIT).map(toContextDraw), [draws]);
  const contextKey = useMemo(
    () => buildContextKey(lottery, draws, numberFilter, activeDrawNumber),
    [activeDrawNumber, draws, lottery, numberFilter],
  );
  const introMessage = useMemo(
    () => buildIntroMessage(lotteryName, draws.length, numberFilter, activeDrawNumber),
    [activeDrawNumber, draws.length, lotteryName, numberFilter],
  );

  return (
    <ResultsChatPanelSession
      activeDrawNumber={activeDrawNumber}
      contextDraws={contextDraws}
      draws={draws}
      introMessage={introMessage}
      isLoading={isLoading}
      key={contextKey}
      lottery={lottery}
      lotteryName={lotteryName}
      numberFilter={numberFilter}
    />
  );
}

function ResultsChatPanelSession({
  activeDrawNumber,
  contextDraws,
  draws,
  introMessage,
  isLoading,
  lottery,
  lotteryName,
  numberFilter,
}: ResultsChatPanelSessionProps) {
  const canChat = draws.length > 0 && !isLoading;
  const chatStatusLabel = canChat ? `${draws.length} resultado(s)` : isLoading ? "carregando" : "sem dados";
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createMessage("assistant", introMessage)]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = input.trim();

    if (!question || !canChat || isSending) {
      return;
    }

    const userMessage = createMessage("user", question);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setChatError(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        body: JSON.stringify({
          context: {
            activeDrawNumber: activeDrawNumber.trim(),
            filterNumbers: numberFilter,
            lotteryName,
            lotterySlug: lottery.slug,
            totalFilteredDraws: draws.length,
            visibleDraws: contextDraws,
          },
          messages: nextMessages
            .slice(-CHAT_HISTORY_LIMIT)
            .map((message) => ({ content: message.content, role: message.role })),
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

      setMessages((current) => [
        ...current,
        createMessage("assistant", payload.reply || "Não recebi uma resposta do Chat GPT agora."),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não consegui conversar com o Chat GPT agora.";
      setChatError(message);
      setMessages((current) => [
        ...current,
        createMessage("assistant", "Não consegui responder agora. Tente novamente em instantes ou ajuste o filtro de resultados."),
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function applySuggestedPrompt(prompt: string) {
    if (!canChat || isSending) {
      return;
    }

    setInput(prompt);
  }

  return (
    <details className="results-chat-panel">
      <summary className="results-chat-summary">
        <div>
          <span className="chat-click-hint">Toque para abrir ou fechar</span>
          <strong>Chat GPT</strong>
          <p>Converse sobre os resultados filtrados.</p>
        </div>
        <span className={`chat-status-pill ${canChat ? "ready" : "waiting"}`}>{chatStatusLabel}</span>
      </summary>

      <div className="results-chat-body" aria-label="Chat GPT sobre os resultados filtrados">
        <div className="chat-context-card">
          <span>Contexto atual</span>
          <strong>{lotteryName}</strong>
          <p>
            {numberFilter.length
              ? `Filtro: ${numberFilter.join(" · ")}`
              : activeDrawNumber.trim()
                ? `Concurso: ${activeDrawNumber.trim()}`
                : `Histórico carregado: ${draws.length} resultado(s)`}
          </p>
        </div>

        <div className="chat-message-list" ref={messageListRef}>
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <span>{message.role === "assistant" ? "Chat GPT" : "Você"}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {isSending ? (
            <article className="chat-message assistant pending">
              <span>Chat GPT</span>
              <p>Analisando os concursos filtrados...</p>
            </article>
          ) : null}
        </div>

        <div className="chat-suggestions" aria-label="Sugestões de perguntas">
          <button disabled={!canChat || isSending} onClick={() => applySuggestedPrompt("Resuma os principais padrões desses resultados.")} type="button">
            Resumir padrões
          </button>
          <button disabled={!canChat || isSending} onClick={() => applySuggestedPrompt("Quais números aparecem com mais destaque nesse filtro?")} type="button">
            Destaques
          </button>
          <button disabled={!canChat || isSending} onClick={() => applySuggestedPrompt("Existe algum atraso ou repetição interessante para observar?")} type="button">
            Atrasos
          </button>
        </div>

        {chatError ? <p className="chat-error">{chatError}</p> : null}

        <form className="chat-input-form" onSubmit={sendMessage}>
          <label htmlFor="results-chat-input">Mensagem para o Chat GPT</label>
          <textarea
            disabled={!canChat || isSending}
            id="results-chat-input"
            maxLength={900}
            onChange={(event) => setInput(event.target.value)}
            placeholder={canChat ? "Pergunte sobre padrões, números, atrasos..." : "Carregue resultados para ativar o chat"}
            rows={3}
            value={input}
          />
          <button disabled={!canChat || isSending || !input.trim()} type="submit">
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </form>
      </div>
    </details>
  );
}
