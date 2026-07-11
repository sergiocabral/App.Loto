import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DrawPayload = {
  date: string;
  drawNumber: number;
  lottery: string;
  nextDrawNumber: number | null;
  numbers: string[];
  previousDrawNumber: number | null;
};

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function drawsFor(lottery: string, count = 3, start = 1): DrawPayload[] {
  return Array.from({ length: count }, (_, index) => {
    const drawNumber = start + count - index - 1;
    const numbers = Array.from({ length: 6 }, (_, numberIndex) => String(((index * 6 + numberIndex) % 60) + 1).padStart(2, "0"));

    return {
      date: `${String((index % 28) + 1).padStart(2, "0")}/01/2026`,
      drawNumber,
      lottery,
      nextDrawNumber: drawNumber + 1,
      numbers,
      previousDrawNumber: drawNumber > 1 ? drawNumber - 1 : null,
    };
  });
}

function getLotteryFromUrl(input: RequestInfo | URL): string {
  const match = String(input).match(/\/api\/lotteries\/([^?]+)/);

  if (!match) {
    throw new Error(`URL de loteria inesperada: ${String(input)}`);
  }

  return match[1];
}

async function renderHomePage() {
  const { HomePage } = await import("./HomePage");
  return render(<HomePage />);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  document.getElementById("remark42-embed-script")?.remove();
});

describe("HomePage", () => {
  it("mantém a seleção mais recente, faz prefetch e reaproveita o cache", async () => {
    const megaSena = deferred<Response>();
    const quina = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const lottery = getLotteryFromUrl(input);

      if (lottery === "MegaSena") {
        return megaSena.promise;
      }

      if (lottery === "Quina") {
        return quina.promise;
      }

      return Promise.resolve(jsonResponse({ draws: drawsFor(lottery) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    await renderHomePage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/lotteries/MegaSena?collect=false", { cache: "no-store" }));

    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    await user.click(screen.getByRole("button", { name: /^Quina/ }));

    megaSena.resolve(jsonResponse({ draws: drawsFor("MegaSena", 1, 501) }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/lotteries/Quina?collect=false", { cache: "no-store" }));
    quina.resolve(jsonResponse({ draws: drawsFor("Quina", 1, 701) }));

    expect(await screen.findByRole("heading", { name: "Histórico de Quina" })).toBeInTheDocument();
    expect(screen.getByText("#701")).toBeInTheDocument();
    expect(screen.queryByText("#501")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    expect(await screen.findByText("#501")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/MegaSena?collect=false"))).toHaveLength(1);
  });

  it("carrega, pagina e filtra o histórico, incluindo o estado vazio", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const lottery = getLotteryFromUrl(input);
      const draws = lottery === "LotoFacil" ? [] : drawsFor(lottery, 30);
      return Promise.resolve(jsonResponse({ draws }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    await renderHomePage();
    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    expect(await screen.findByText("#30")).toBeInTheDocument();
    expect(screen.queryByText("#5")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Ver mais resultados/ }));
    expect(await screen.findByText("#5")).toBeInTheDocument();

    const search = screen.getByLabelText("Números para encontrar");
    await user.type(search, "01 02");
    await user.click(screen.getByRole("button", { name: "Pesquisar" }));
    expect(await screen.findByRole("heading", { name: "Concursos com 01 · 02" })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "01 60");
    await user.click(screen.getByRole("button", { name: "Pesquisar" }));
    expect(await screen.findByText("Nenhum concurso encontrado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Loto Facil/ }));
    expect(await screen.findByText("Nenhum resultado salvo")).toBeInTheDocument();
  });

  it("expõe a falha de carregamento no DOM", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const lottery = getLotteryFromUrl(input);
      return Promise.resolve(lottery === "Quina" ? jsonResponse({ error: "serviço indisponível" }, 503) : jsonResponse({ draws: drawsFor(lottery) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    await renderHomePage();
    await user.click(screen.getByRole("button", { name: /^Quina/ }));

    expect(await screen.findByText("Falha ao carregar")).toBeInTheDocument();
    expect(screen.getByText("serviço indisponível")).toBeInTheDocument();
  });

  it("inicia, pausa, retoma e informa erro de sincronização sem perder o histórico", async () => {
    const pausedBatch = deferred<Response>();
    const syncResponses: Array<Response | ReturnType<typeof deferred<Response>>> = [
      pausedBatch,
      jsonResponse({
        draws: drawsFor("MegaSena", 4),
        sync: {
          attemptedDrawNumbers: [4],
          batchSize: 1,
          consecutiveMisses: 0,
          currentDrawNumber: 4,
          draws: drawsFor("MegaSena", 4),
          hasMore: false,
          newestDrawNumber: 4,
          nextDrawNumber: null,
          oldestDrawNumber: 1,
          savedDraws: [drawsFor("MegaSena", 4)[0]],
          skippedDrawNumbers: [],
          stopReason: "completed",
          totalStoredDraws: 4,
        },
      }),
      jsonResponse({ error: "Caixa indisponível" }, 503),
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const response = syncResponses.shift();
        return response && "promise" in response ? response.promise : Promise.resolve(response);
      }

      return Promise.resolve(jsonResponse({ draws: drawsFor(getLotteryFromUrl(input), 3) }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    await renderHomePage();
    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    expect(await screen.findByText("#3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Carregar resultados manualmente" }));
    await user.click(screen.getByRole("button", { name: "Pausar carregamento manual de resultados" }));
    pausedBatch.resolve(
      jsonResponse({
        draws: drawsFor("MegaSena", 3),
        sync: {
          attemptedDrawNumbers: [4],
          batchSize: 1,
          consecutiveMisses: 0,
          currentDrawNumber: 4,
          draws: drawsFor("MegaSena", 3),
          hasMore: true,
          newestDrawNumber: 3,
          nextDrawNumber: 5,
          oldestDrawNumber: 1,
          savedDraws: [],
          skippedDrawNumbers: [4],
          stopReason: "batch_completed",
          totalStoredDraws: 3,
        },
      }),
    );
    expect(await screen.findByText("Carregamento pausado.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Carregar resultados manualmente" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    expect(await screen.findByText("Resultados atualizados.")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Carregar resultados manualmente" }));
    expect(await screen.findByText("Sincronização interrompida.")).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("seleciona, copia e gera sugestões a partir da análise carregada", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(jsonResponse({ draws: drawsFor(getLotteryFromUrl(input), 3) }))));
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: { writeText: copyText } });

    await renderHomePage();
    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    expect(await screen.findByText("Análise rápida")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Selecionar número 01" }).at(-1)!);
    const toolbar = screen.getByRole("region", { name: "Números selecionados" });
    expect(within(toolbar).getByText("1 número")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("01"));

    await user.click(screen.getByRole("button", { name: "Estou com sorte" }));
    expect(await screen.findByText("Sugestão 1")).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText(/Selecionar e copiar sugestão/));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Sugestão copiada.")).toBeInTheDocument();
  });

  it("consulta um concurso, limpa filtros, abre o simulador e volta ao início", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const lottery = getLotteryFromUrl(input);
      const draws = drawsFor(lottery, 3);
      const drawNumber = new URL(String(input), "http://localhost").searchParams.get("draw");

      return Promise.resolve(
        jsonResponse(
          drawNumber
            ? { draw: draws.find((draw) => draw.drawNumber === Number(drawNumber)) ?? null, draws }
            : { draws },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    await renderHomePage();
    await user.click(screen.getByRole("button", { name: /^Mega Sena/ }));
    expect(await screen.findByRole("heading", { name: "Histórico de Mega Sena" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Concurso" }));
    const drawInput = screen.getByLabelText("Número do concurso");
    await user.type(drawInput, "0");
    await user.click(screen.getByRole("button", { name: "Consultar" }));
    expect(await screen.findByText("Informe um número de concurso válido.")).toBeInTheDocument();

    await user.clear(drawInput);
    await user.type(drawInput, "2");
    await user.click(screen.getByRole("button", { name: "Consultar" }));
    expect(await screen.findByRole("heading", { name: "Concurso 2" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/lotteries/MegaSena?draw=2", { cache: "no-store" });

    await user.click(screen.getByRole("button", { name: "Limpar filtro" }));
    expect(await screen.findByRole("heading", { name: "Histórico de Mega Sena" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Selecionar número 01" }).at(-1)!);
    await user.click(within(screen.getByRole("region", { name: "Números selecionados" })).getByRole("button", { name: "Filtrar" }));
    expect(await screen.findByRole("heading", { name: "Concursos com 01" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Números selecionados" })).getByRole("button", { name: "Limpar" }));
    expect(await screen.findByRole("heading", { name: "Histórico de Mega Sena" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Simulador" }));
    expect(screen.getByRole("dialog", { name: "Sorteios anteriores" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Fechar simulador" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "Sorteios anteriores" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Voltar para o início sem loteria selecionada" }));
    expect(screen.getByRole("region", { name: "Selecione uma loteria" })).toBeInTheDocument();
  });
});
