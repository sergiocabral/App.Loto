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
      "Priorize as dezenas de maior frequência no recorte, usando a lista 'Mais sorteados'. Separe em Quentes (topo da frequência), Apoio (frequência média) e Evitar (frias do período), citando ao lado de cada dezena quantas vezes saiu. Feche com uma Combinação sugerida válida para a loteria atual, equilibrando pares e ímpares e as faixas baixa/média/alta.",
  },
  {
    id: "chatgpt-button-2",
    label: "Surpresas",
    message: "Aponte números surpresa.",
    prompt:
      "Aponte dezenas fora do óbvio no recorte: frias começando a voltar, atrasadas com aparição recente e faixas pouco exploradas. Liste cada candidata com um motivo de uma linha baseado nos dados enviados. Feche com uma Combinação surpresa válida para a loteria atual, misturando 1 ou 2 dezenas quentes com o restante de baixa probabilidade aparente.",
  },
  {
    id: "chatgpt-button-3",
    label: "Ciclos",
    message: "Mostre números por ciclos e atrasos.",
    prompt:
      "Cruze atraso e recência usando 'Mais atrasados' e 'Mais recentes'. Separe em Atrasados úteis (atraso alto já com sinal de retomada), Em ritmo (recorrência recente forte) e Neutros. Diga o atraso de cada dezena citada. Feche com uma Combinação sugerida válida para a loteria atual, priorizando atrasados prestes a retornar sem abrir mão de 1 ou 2 dezenas em ritmo.",
  },
  {
    id: "chatgpt-button-4",
    label: "Estratégia",
    message: "Monte uma estratégia de números.",
    prompt:
      "Monte uma estratégia combinando frequência, atraso, recência e distribuição por faixas do recorte. Entregue Base (dezenas mais consistentes), Complementares (equilíbrio de faixas e de pares/ímpares) e Ousadia (1 ou 2 apostas contra a tendência). Explique em uma linha o critério de cada bloco. Feche com a Combinação final válida para a loteria atual, ordenada de forma crescente.",
  },
];
