import { describe, expect, it } from "vitest";
import { getLottery, type LotteryDefinition } from "@/data/lotteries";
import {
  buildAnalysisData,
  buildLuckySuggestion,
  buildNumberRange,
  buildSuggestionGroups,
  buildSuggestionKey,
  buildTrendGroups,
  drawContainsNumbers,
  formatHitsLabel,
  formatNumberCount,
  formatOverdueLabel,
  formatRecencyScore,
  getAnalysisDescription,
  getAnalysisFilterText,
  getAnalysisPeriodLabel,
  getAnalysisScopeLabel,
  getDisplayGroups,
  getNumbersForAnalysis,
  getRecentAppearanceWeight,
  getSuggestionDescription,
  getSuggestionSize,
  parseNumberFilter,
  shuffleItems,
  sortNumbersForDisplay,
  type AnalysisView,
} from "@/lib/analysis";
import type { Draw } from "@/lib/types";

function draw(drawNumber: number, numbers: string[], lottery = "MegaSena", numberGroups?: string[][]): Draw {
  return {
    lottery,
    drawNumber,
    date: `0${drawNumber}/01/2026`,
    numbers,
    numberGroups,
    previousDrawNumber: drawNumber > 1 ? drawNumber - 1 : null,
    nextDrawNumber: drawNumber + 1,
    raw: {},
  };
}

describe("analysis helpers", () => {
  const megaSena = getLottery("MegaSena")!;
  const lotoMania = getLottery("LotoMania")!;
  const duplaSena = getLottery("DuplaSena")!;
  const draws = [
    draw(5, ["01", "02", "03", "04", "05", "06"]),
    draw(4, ["01", "02", "03", "04", "05", "07"]),
    draw(3, ["01", "02", "03", "04", "08", "09"]),
    draw(2, ["01", "02", "03", "10", "11", "12"]),
    draw(1, ["01", "02", "13", "14", "15", "16"]),
  ];

  it("sorts numeric strings for display", () => {
    expect(sortNumbersForDisplay(["10", "02", "01"])).toEqual(["01", "02", "10"]);
  });

  it("parses number filters, removes duplicates and rejects out-of-range values", () => {
    expect(parseNumberFilter("05, 12 33;99 abc 12", megaSena)).toEqual(["05", "12", "33"]);
    expect(parseNumberFilter("000 0 00 1 99 100", lotoMania)).toEqual(["00", "01", "99"]);
    expect(parseNumberFilter("000 0 00 1 60 61", megaSena)).toEqual(["01", "60"]);
    expect(parseNumberFilter("", megaSena)).toEqual([]);
  });

  it("matches draws containing all searched numbers across grouped draws", () => {
    const duplaDraw = draw(
      10,
      ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
      "DuplaSena",
      [
        ["01", "02", "03", "04", "05", "06"],
        ["07", "08", "09", "10", "11", "12"],
      ],
    );

    expect(drawContainsNumbers(duplaDraw, ["01", "12"])).toBe(true);
    expect(drawContainsNumbers(duplaDraw, ["01", "13"])).toBe(false);
    expect(drawContainsNumbers(duplaDraw, [])).toBe(true);
  });

  it("returns display groups from normalized groups before flat numbers", () => {
    const grouped = draw(10, ["01", "02", "03", "04"], "DuplaSena", [["01", "02"], ["03", "04"], []]);

    expect(getDisplayGroups(grouped)).toEqual([["01", "02"], ["03", "04"]]);
    expect(getDisplayGroups(draw(1, ["01", "02"]))).toEqual([["01", "02"]]);
  });

  it("builds the complete number range for each lottery type", () => {
    expect(buildNumberRange(megaSena)).toHaveLength(60);
    expect(buildNumberRange(megaSena).at(0)).toBe("01");
    expect(buildNumberRange(megaSena).at(-1)).toBe("60");
    expect(buildNumberRange(lotoMania)).toHaveLength(100);
    expect(buildNumberRange(lotoMania).at(0)).toBe("00");
    expect(buildNumberRange(lotoMania).at(-1)).toBe("99");
  });

  it("labels counts, periods, scopes and overdue values in Portuguese", () => {
    expect(formatHitsLabel(1)).toBe("1 vez");
    expect(formatHitsLabel(2)).toBe("2 vezes");
    expect(formatNumberCount(1)).toBe("1 número");
    expect(formatNumberCount(4)).toBe("4 números");
    expect(formatOverdueLabel(0)).toBe("Saiu no último concurso");
    expect(formatOverdueLabel(3)).toBe("3 concursos sem sair");
    expect(formatRecencyScore(1)).toBe("1");
    expect(formatRecencyScore(0.9)).toBe("0,9");
    expect(formatRecencyScore(0.81)).toBe("0,81");
    expect(getRecentAppearanceWeight(0)).toBe(1);
    expect(getRecentAppearanceWeight(1)).toBe(0.9);
    expect(getRecentAppearanceWeight(2)).toBeCloseTo(0.81);
    expect(getAnalysisPeriodLabel(10, 4)).toBe("Últimos 4 concursos");
    expect(getAnalysisPeriodLabel("all", 4)).toBe("4 concursos");
    expect(getAnalysisScopeLabel("all")).toBe("Todos os sorteios");
    expect(getAnalysisScopeLabel("first")).toBe("1º sorteio");
    expect(getAnalysisScopeLabel("second")).toBe("2º sorteio");
  });

  it("builds analysis data with hits, overdue and intensity", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all");

    expect(data).not.toBeNull();
    expect(data?.drawCount).toBe(5);
    expect(data?.periodLabel).toBe("5 concursos");
    expect(data?.scopeLabel).toBe("Todos os sorteios");
    expect(data?.maxHits).toBe(5);
    expect(data?.maxRecencyScore).toBeCloseTo(4.0951);
    expect(data?.most.at(0)).toMatchObject({ number: "01", hits: 5, overdue: 0, lastDrawNumber: 5, intensity: 1 });
    expect(data?.recent.at(0)).toMatchObject({ number: "01", hits: 5, overdue: 0, lastDrawNumber: 5 });
    expect(data?.recent.at(0)?.recencyScore).toBeCloseTo(4.0951);
    expect(data?.recent.find((item) => item.number === "07")?.recencyScore).toBeCloseTo(0.9);
    expect(data?.least.at(0)).toMatchObject({ number: "17", hits: 0, overdue: 5, lastDrawNumber: null, recencyScore: 0 });
    expect(data?.delayed.at(0)?.overdue).toBe(5);
  });

  it("limits analysis by period using newest draws first", () => {
    const data = buildAnalysisData(draws, megaSena, 10, "all");

    expect(data?.drawCount).toBe(5);
    expect(data?.periodLabel).toBe("Últimos 5 concursos");
    expect(data?.selectedDraws.map((item) => item.drawNumber)).toEqual([5, 4, 3, 2, 1]);
  });

  it("supports DuplaSena scope filtering", () => {
    const duplaDraws = [
      draw(
        2,
        ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"],
        "DuplaSena",
        [
          ["01", "02", "03", "04", "05", "06"],
          ["07", "08", "09", "10", "11", "12"],
        ],
      ),
      draw(
        1,
        ["01", "02", "13", "14", "15", "16", "07", "08", "17", "18", "19", "20"],
        "DuplaSena",
        [
          ["01", "02", "13", "14", "15", "16"],
          ["07", "08", "17", "18", "19", "20"],
        ],
      ),
    ];

    expect(getNumbersForAnalysis(duplaDraws[0], "first")).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(getNumbersForAnalysis(duplaDraws[0], "second")).toEqual(["07", "08", "09", "10", "11", "12"]);
    expect(getNumbersForAnalysis(duplaDraws[0], "all")).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ]);

    const firstScope = buildAnalysisData(duplaDraws, duplaSena, "all", "first");
    const secondScope = buildAnalysisData(duplaDraws, duplaSena, "all", "second");

    expect(firstScope?.most.at(0)).toMatchObject({ number: "01", hits: 2 });
    expect(secondScope?.most.at(0)).toMatchObject({ number: "07", hits: 2 });
  });

  it("groups trends by equal values in requested order", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all")!;
    const mostGroups = buildTrendGroups(data.stats, (item) => item.hits, "desc");
    const leastGroups = buildTrendGroups(data.stats, (item) => item.hits, "asc");

    expect(mostGroups.at(0)?.value).toBe(5);
    expect(mostGroups.at(0)?.items.map((item) => item.number)).toEqual(["01", "02"]);
    expect(leastGroups.at(0)?.value).toBe(0);
    expect(leastGroups.at(0)?.items.length).toBeGreaterThan(0);
  });

  it("builds suggestion groups according to the active analysis view", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all")!;

    expect(buildSuggestionGroups("most", data).at(0)?.value).toBe(5);
    expect(buildSuggestionGroups("least", data).at(0)?.value).toBe(0);
    expect(buildSuggestionGroups("delayed", data).at(0)?.value).toBe(5);
    expect(buildSuggestionGroups("map", data).at(0)?.items.length).toBeGreaterThan(0);
    expect(buildSuggestionGroups("recent", data).at(0)).toMatchObject({ value: 4095 });
  });

  it("builds lucky suggestions by filling from the top ranked groups", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all")!;
    const alwaysFirst = () => 0;
    const mostSuggestion = buildLuckySuggestion(megaSena, "most", data, alwaysFirst);
    const recentSuggestion = buildLuckySuggestion(megaSena, "recent", data, alwaysFirst);
    const leastSuggestion = buildLuckySuggestion(megaSena, "least", data, alwaysFirst);

    expect(mostSuggestion).toHaveLength(6);
    expect(mostSuggestion).toEqual(expect.arrayContaining(["01", "02"]));
    expect(recentSuggestion).toHaveLength(6);
    expect(recentSuggestion).toEqual(expect.arrayContaining(["01", "02"]));
    expect(leastSuggestion).toHaveLength(6);
    expect(leastSuggestion).toEqual(expect.arrayContaining(["18", "19", "20", "21", "22", "23"]));
  });

  it("always keeps singleton top-ranked groups in lucky suggestions", () => {
    const tinyLottery: LotteryDefinition = {
      slug: "Tiny",
      apiSlug: "tiny",
      countNumbers: 7,
      numbersPerDraw: 3,
    };
    const tinyDraws = [
      draw(3, ["01", "02", "03"], "Tiny"),
      draw(2, ["01", "02", "04"], "Tiny"),
      draw(1, ["01", "05", "06"], "Tiny"),
    ];
    const data = buildAnalysisData(tinyDraws, tinyLottery, "all", "all")!;
    const alwaysLastInGroup = () => 0.99;

    expect(buildLuckySuggestion(tinyLottery, "most", data, alwaysLastInGroup)).toContain("01");
    expect(buildLuckySuggestion(tinyLottery, "least", data, alwaysLastInGroup)).toContain("07");
    expect(buildLuckySuggestion(tinyLottery, "delayed", data, alwaysLastInGroup)).toContain("07");
  });

  it("uses DuplaSena first group size for suggestions", () => {
    const data = buildAnalysisData(
      [draw(1, ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"], "DuplaSena")],
      duplaSena,
      "all",
      "all",
    )!;

    expect(getSuggestionSize(duplaSena)).toBe(6);
    expect(buildLuckySuggestion(duplaSena, "most", data, () => 0)).toHaveLength(6);
  });

  it("keeps suggestion keys stable for identical analysis and changed for another view", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all")!;

    expect(buildSuggestionKey(megaSena, "most", data)).toBe(buildSuggestionKey(megaSena, "most", data));
    expect(buildSuggestionKey(megaSena, "most", data)).not.toBe(buildSuggestionKey(megaSena, "least", data));
  });

  it("describes filters and suggestions for all analysis views", () => {
    const data = buildAnalysisData(draws, megaSena, "all", "all")!;

    expect(getAnalysisFilterText(data)).toBe("5 concursos");
    for (const view of ["most", "least", "delayed", "map", "recent"] satisfies AnalysisView[]) {
      expect(getAnalysisDescription(view, data)).toContain("Considerando 5 concursos");
      expect(getSuggestionDescription(view, data)).toContain("5 concursos");
    }
  });

  it("shuffles without mutating the original array", () => {
    const values = [1, 2, 3];
    const shuffled = shuffleItems(values, () => 0);

    expect(shuffled).toEqual([2, 3, 1]);
    expect(values).toEqual([1, 2, 3]);
  });

  it("returns null analysis when there are no usable draws", () => {
    expect(buildAnalysisData([], megaSena, "all", "all")).toBeNull();
    expect(buildAnalysisData([draw(1, [])], megaSena, "all", "all")).toBeNull();
    expect(buildAnalysisData(draws, null, "all", "all")).toBeNull();
  });
});
