import { fireEvent, render, screen } from "@testing-library/react";
import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLottery } from "@/data/lotteries";
import { buildDraw } from "@/test/fixtures/builders";
import { BacktestDrawer } from "./BacktestDrawer";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, trackEvent };
});

const lottery = getLottery("MegaSena")!;
const draws = [
  buildDraw({ date: "05/01/2026", drawNumber: 5 }),
  buildDraw({ date: "04/01/2026", drawNumber: 4, numbers: ["01", "07", "08", "09", "10", "11"] }),
  buildDraw({ date: "03/01/2026", drawNumber: 3, numbers: ["02", "12", "13", "14", "15", "16"] }),
];

function renderDrawer(onClose = vi.fn(), overrides: Partial<ComponentProps<typeof BacktestDrawer>> = {}) {
  return {
    onClose,
    ...render(
      <BacktestDrawer
        draws={draws}
        lottery={lottery}
        onClose={onClose}
        open
        quickAnalysisPeriod={10}
        quickAnalysisScope="all"
        quickAnalysisView="frequency"
        quickCustomRange={{ end: 10, start: 1 }}
        quickRecencyScoreMode="rounded"
        {...overrides}
      />,
    ),
  };
}

describe("BacktestDrawer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    trackEvent.mockClear();
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("traps the visible dialog lifecycle without leaving the page locked", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { onClose, unmount } = renderDrawer();

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getAllByRole("button", { name: "Fechar simulador" }).at(-1)).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(opener).toHaveFocus();
  });

  it("runs a controlled simulation and cancels its pending timer when stopped", () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(screen.getByText("Rodando ensaio técnico")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parar" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(screen.getByText("Simulação pausada.")).toBeInTheDocument();
    vi.advanceTimersByTime(1000);
    expect(screen.getByText("Simulação pausada.")).toBeInTheDocument();
  });

  it("updates simulation controls and only uses the injected clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Retroceder sorteio alvo ao esgotar sugestões" }));
    fireEvent.change(screen.getByLabelText("Quantidade de números por sugestão"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    await Promise.resolve();
    expect(writeText.mock.calls[0][0]).toContain("Simulador de sorteios anteriores");
    expect(trackEvent).toHaveBeenCalledWith("Mudou velocidade simulador", expect.objectContaining({ speed: 4 }));
    expect(trackEvent).toHaveBeenCalledWith("Alternou retrocesso simulador", expect.objectContaining({ autoAdvanceCutoff: false }));
    expect(trackEvent).toHaveBeenCalledWith("Mudou tamanho sugestão simulador", expect.objectContaining({ suggestionNumberCount: 8 }));
  });

  it("renders no drawer while closed and an explicit placeholder without enough history", () => {
    renderDrawer(vi.fn(), { open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    renderDrawer(vi.fn(), { draws: [draws[0]] });
    expect(screen.getByText("Sem concursos anteriores suficientes")).toBeInTheDocument();
  });

  it("changes the target, custom period and analysis strategy", () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "Entenda melhor" }));
    expect(screen.getByText(/trata esse resultado como se ele ainda não tivesse acontecido/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
    expect(screen.getByLabelText("Quantidade exata de concursos anteriores")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "Reduzir período em 1 concurso" }));
    expect(screen.getByLabelText("Quantidade exata de concursos anteriores")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("Quantidade exata de concursos anteriores"), { target: { value: "99" } });
    expect(screen.getByLabelText("Quantidade exata de concursos anteriores")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Tipo de Análise"), { target: { value: "delayed" } });
    fireEvent.change(screen.getByLabelText("Concurso alvo"), { target: { value: "4" } });

    expect(trackEvent).toHaveBeenCalledWith("Mudou corte simulador", expect.objectContaining({ targetDrawNumber: 4 }));
    expect(trackEvent).toHaveBeenCalledWith("Mudou período simulador", expect.objectContaining({ period: "ajustar" }));
    expect(trackEvent).toHaveBeenCalledWith("Mudou análise simulador", expect.objectContaining({ analysisView: "delayed" }));
  });

  it("processes all eligible targets, groups results and copies a suggestion", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: "4x" }));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar" }));
    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
    }

    expect(screen.getByText("Todos os concursos disponíveis foram processados.")).toBeInTheDocument();
    expect(screen.getAllByText(/sugestão$/).length).toBeGreaterThan(0);

    const groupButtons = screen.getAllByRole("button", { name: /Concurso [34]/ });
    fireEvent.click(groupButtons[0]);
    fireEvent.click(groupButtons[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /Copiar números da sugestão/ })[0]);
    await act(async () => Promise.resolve());

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^\d{2}( \d{2})+$/));
    expect(trackEvent).toHaveBeenCalledWith("Copiou sugestão simulador", expect.objectContaining({ sequence: 1 }));
  });
});
