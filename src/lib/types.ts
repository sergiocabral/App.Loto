export type CaixaLotteryResponse = {
  numero?: number;
  numeroConcursoAnterior?: number;
  numeroConcursoProximo?: number;
  dataApuracao?: string;
  dezenasSorteadasOrdemSorteio?: string[] | string;
  listaDezenas?: string[];
  listaDezenasSegundoSorteio?: string[];
};

export type Draw = {
  lottery: string;
  drawNumber: number;
  date: string;
  numbers: string[];
  numberGroups?: string[][];
  previousDrawNumber: number | null;
  nextDrawNumber: number | null;
  raw: CaixaLotteryResponse;
};

export type DrawTextOptions = {
  extended?: boolean;
};
