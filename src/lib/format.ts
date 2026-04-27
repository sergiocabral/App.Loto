import type { LotteryDefinition } from "@/data/lotteries";

export function normalizeNumbers(value: string[] | string | undefined): string[] {
  if (!value) {
    return [];
  }

  const rawNumbers = Array.isArray(value) ? value : value.split("-");

  return rawNumbers
    .map((item) => Number.parseInt(String(item).trim(), 10))
    .filter((item) => Number.isFinite(item))
    .map((item) => (item === 100 ? 0 : item))
    .map((item) => item.toString().padStart(2, "0"))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

export function formatNumberRuler(numbers: string[], countNumbers: number): string {
  const numeric = numbers.map((number) => Number.parseInt(number, 10));
  const width = String(countNumbers - 1).length;
  const maxDrawNumber = Math.max(...numeric, 0);
  const max = Math.max(maxDrawNumber, countNumbers);
  const slots: string[] = [];

  for (let i = 0; i <= max; i += 1) {
    slots.push(numeric.includes(i) ? String(i).padStart(width, "0") : " ".repeat(width));
  }

  return slots.join(" ");
}

export function splitDrawGroups(numbers: string[], lottery: LotteryDefinition): string[][] {
  if (!lottery.groups?.length) {
    return [numbers];
  }

  let offset = 0;
  return lottery.groups.map((size) => {
    const group = numbers.slice(offset, offset + size);
    offset += size;
    return group;
  });
}
