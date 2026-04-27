import { getLottery, LOTTERIES } from "@/data/lotteries";
import { formatNumberRuler } from "@/lib/format";
import type { Draw } from "@/lib/types";

const ID_WIDTH = 5;

export function renderDrawText(draw: Draw, extended = false): string {
  const lottery = getLottery(draw.lottery);

  if (!lottery || !draw.numbers.length) {
    return "";
  }

  const id = draw.drawNumber.toString().padStart(ID_WIDTH, "0");

  if (lottery.groups?.length) {
    const groups = draw.numberGroups?.length ? draw.numberGroups : splitNumbersByDefinition(draw.numbers, lottery.groups);
    const firstGroup = groups[0] ?? [];
    const secondGroup = groups[1] ?? [];
    const firstLine = [id, draw.date, renderNumbers(firstGroup, lottery.countNumbers, extended)].join(" | ");
    const secondLine = [" ".repeat(ID_WIDTH), " ".repeat(draw.date.length), renderNumbers(secondGroup, lottery.countNumbers, extended)].join(" | ");
    const separator = "-".repeat(Math.max(firstLine.length, secondLine.length));

    return `${firstLine}\n${secondLine}\n${separator}\n`;
  }

  const line = [id, draw.date, renderNumbers(draw.numbers, lottery.countNumbers, extended)].join(" | ");
  return `${line}\n${"-".repeat(line.length)}\n`;
}

export function renderHistoryText(draws: Draw[]): string {
  return draws.map((draw) => renderDrawText(draw, true)).join("");
}

export function getAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? "v1.3.x";
}

function splitNumbersByDefinition(numbers: string[], groups: number[]): string[][] {
  let offset = 0;

  return groups.map((size) => {
    const group = numbers.slice(offset, offset + size);
    offset += size;
    return group;
  });
}

function renderNumbers(numbers: string[], countNumbers: number, extended: boolean): string {
  const base = numbers.join(" ");

  if (!extended) {
    return base;
  }

  const ruler = formatNumberRuler(numbers, countNumbers);
  return `${base} | ${ruler}`;
}

export const lotteryNames = LOTTERIES.map((lottery) => lottery.slug);
