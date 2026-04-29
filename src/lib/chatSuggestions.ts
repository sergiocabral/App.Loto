export type ChatSuggestion = {
  id: string;
  label: string;
  message: string;
  prompt: string;
};

export const DEFAULT_CHAT_SUGGESTIONS: ChatSuggestion[] = [
  {
    id: "chatgpt-button-1",
    label: "Mapa quente",
    message: "Identifique números pelo mapa quente.",
    prompt:
      "Use o mapa de calor/frequência do recorte para identificar números candidatos. Responda direto em tópicos: Quentes, Apoio, Fracos/evitar e Combinação sugerida compatível com a loteria. Foque em números e chance relativa no recorte, sem introdução, conclusão ou alertas.",
  },
  {
    id: "chatgpt-button-2",
    label: "Surpresas",
    message: "Aponte números surpresa.",
    prompt:
      "Identifique números surpresa no recorte: pouco óbvios, frios retomando, atrasados com sinal recente ou faixas fora do padrão. Responda direto com números, motivo curto e uma combinação surpresa compatível com a loteria. Sem introdução, conclusão ou alertas.",
  },
  {
    id: "chatgpt-button-3",
    label: "Ciclos",
    message: "Mostre números por ciclos e atrasos.",
    prompt:
      "Analise ciclos, atrasos e recorrência para identificar números candidatos. Separe em Recorrentes, Atrasados úteis, Retomada recente e Combinação sugerida compatível com a loteria. Foque em números e critérios curtos, sem introdução, conclusão ou alertas.",
  },
  {
    id: "chatgpt-button-4",
    label: "Estratégia",
    message: "Monte uma estratégia de números.",
    prompt:
      "Monte uma estratégia objetiva de números combinando frequência, atraso, recência e distribuição por faixas. Entregue Base, Complementares, Ousadia e Combinação sugerida compatível com a loteria. Use critérios curtos e diretos, sem introdução, conclusão ou alertas.",
  },
];
