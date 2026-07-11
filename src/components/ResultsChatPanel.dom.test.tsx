import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLottery } from "@/data/lotteries";
import { buildDraw, jsonResponse } from "@/test/fixtures/builders";
import { ResultsChatPanel } from "./ResultsChatPanel";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, trackEvent };
});

const lottery = getLottery("MegaSena")!;

function renderPanel(draws = [buildDraw({ drawNumber: 2 }), buildDraw({ drawNumber: 1 })]) {
  return render(
    <ResultsChatPanel
      activeDrawNumber=""
      analysisData={null}
      analysisViewLabel="Frequência"
      draws={draws}
      isLoading={false}
      lottery={lottery}
      numberFilter={[]}
    />,
  );
}

describe("ResultsChatPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses remote suggestions, limits context and renders a safe markdown reply", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ suggestions: [{ id: "remote", label: "Remota", message: "Pergunta remota", prompt: "Prompt remoto" }] }))
      .mockResolvedValueOnce(jsonResponse({ reply: "# Resposta\n\n- **Seguro**\n- <img src=x onerror=alert(1)>" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel(Array.from({ length: 121 }, (_, index) => buildDraw({ drawNumber: 200 - index })));

    await user.click(screen.getByText("Chat GPT", { selector: "summary strong" }));
    await screen.findByRole("button", { name: "Remota" });
    await user.click(screen.getByRole("button", { name: "Remota" }));
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Resposta");
    expect(screen.getByText("Seguro")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    const request = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(request.context.visibleDraws).toHaveLength(120);
    expect(request.messages.at(-1)).toEqual({ content: "Prompt remoto", role: "user" });
    expect(trackEvent).toHaveBeenCalledWith("Recebeu resposta chat", expect.any(Object));
  });

  it("keeps defaults after suggestion failure and exposes a retryable send error", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ error: "Indisponível" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ reply: "Disponível novamente" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("Chat GPT", { selector: "summary strong" }));
    await screen.findByRole("button", { name: "Mapa quente" });
    fireEvent.change(screen.getByLabelText("Mensagem para o Chat GPT"), { target: { value: "Teste" } });
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Indisponível");
    expect(screen.getByText("Não consegui responder agora. Tente novamente em instantes ou ajuste o filtro de resultados.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mensagem para o Chat GPT"), { target: { value: "Tentar de novo" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Disponível novamente");
    expect(trackEvent).toHaveBeenCalledWith("Falhou chat", expect.any(Object));
  });
});
