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
    message: "Mostre o mapa quente desse filtro.",
    prompt:
      "Analise os concursos filtrados como um mapa quente da loteria. Identifique os números mais ativos, os mais frios, possíveis concentrações por faixa numérica, repetições recentes e qualquer mudança de comportamento dentro do recorte atual. Explique em português claro, sem prometer previsão ou ganho, e destaque apenas padrões observáveis nos dados enviados.",
  },
  {
    id: "chatgpt-button-2",
    label: "Surpresas",
    message: "Quais surpresas aparecem aqui?",
    prompt:
      "Procure achados contraintuitivos nos resultados filtrados: números que parecem fortes mas estão perdendo ritmo, números pouco lembrados que começaram a aparecer, combinações ou faixas que fogem do esperado visualmente e atrasos relevantes. Responda de forma objetiva, mostrando por que cada achado é interessante para análise estatística, sem sugerir aposta garantida.",
  },
  {
    id: "chatgpt-button-3",
    label: "Ciclos",
    message: "Analise ciclos e atrasos.",
    prompt:
      "Faça uma análise de ciclos, atrasos e recorrência nos concursos filtrados. Compare números recorrentes, números atrasados, possíveis alternâncias entre faixas e sinais de retomada recente. Separe a resposta em tópicos curtos com observações práticas para o usuário entender o comportamento histórico do filtro, deixando claro que loterias são aleatórias.",
  },
  {
    id: "chatgpt-button-4",
    label: "Estratégia",
    message: "Monte uma estratégia de leitura dos dados.",
    prompt:
      "Crie uma estratégia de leitura dos dados filtrados para ajudar o usuário a interpretar os sorteios. Combine frequência, atraso, repetição, distribuição por faixas e consistência recente. Não gere promessa de resultado nem diga que há método infalível; entregue um roteiro analítico que o usuário dificilmente faria manualmente, com passos claros e critérios para observar os próximos concursos.",
  },
];
