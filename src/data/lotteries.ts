export type LotterySlug =
  | "DiaDeSorte"
  | "DuplaSena"
  | "LotoFacil"
  | "LotoMania"
  | "MegaSena"
  | "Quina"
  | "TimeMania";

export type LotteryDefinition = {
  slug: LotterySlug;
  apiSlug: string;
  countNumbers: number;
  numbersPerDraw: number;
  groups?: number[];
};

export const LOTTERIES: LotteryDefinition[] = [
  {
    slug: "DiaDeSorte",
    apiSlug: "diadesorte",
    countNumbers: 31,
    numbersPerDraw: 7,
  },
  {
    slug: "DuplaSena",
    apiSlug: "duplasena",
    countNumbers: 50,
    numbersPerDraw: 12,
    groups: [6, 6],
  },
  {
    slug: "LotoFacil",
    apiSlug: "lotofacil",
    countNumbers: 25,
    numbersPerDraw: 15,
  },
  {
    slug: "LotoMania",
    apiSlug: "lotomania",
    countNumbers: 99,
    numbersPerDraw: 20,
  },
  {
    slug: "MegaSena",
    apiSlug: "megasena",
    countNumbers: 60,
    numbersPerDraw: 6,
  },
  {
    slug: "Quina",
    apiSlug: "quina",
    countNumbers: 80,
    numbersPerDraw: 5,
  },
  {
    slug: "TimeMania",
    apiSlug: "timemania",
    countNumbers: 80,
    numbersPerDraw: 7,
  },
];

export function getLottery(slug: string): LotteryDefinition | null {
  const normalized = slug.toLowerCase();
  return LOTTERIES.find((lottery) => lottery.slug.toLowerCase() === normalized) ?? null;
}

export function isLotterySlug(slug: string): slug is LotterySlug {
  return getLottery(slug) !== null;
}
