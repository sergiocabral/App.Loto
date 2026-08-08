import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaywallContent, PaywallDialog } from "./PaywallDialog";

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, trackEvent };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("PaywallDialog", () => {
  beforeEach(() => {
    trackEvent.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  it("renders plans with prices and tracks the opening", () => {
    render(
      <PaywallDialog
        onClose={vi.fn()}
        open
        plans={{ lifetime: { priceBRL: 60 }, pass30: { priceBRL: 12 } }}
        source="simulator"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Acesso completo" })).toBeInTheDocument();
    expect(screen.getByText("Você usou as simulações grátis de hoje.")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*12,00/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*60,00/)).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("Abriu paywall", { source: "simulator" });
  });

  it("closes on backdrop click and escape key", () => {
    const onClose = vi.fn();
    render(<PaywallDialog onClose={onClose} open source="chat" />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar acesso completo" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("requires an e-mail before starting a checkout", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="raw" />);

    fireEvent.click(screen.getByRole("button", { name: /Passe de 30 dias/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe seu e-mail");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts the checkout and redirects to the Mercado Pago init point", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ initPoint: "https://mp/init" }));
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign },
    });
    render(<PaywallContent source="link" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Passe vitalício/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://mp/init"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/checkout",
      expect.objectContaining({
        body: JSON.stringify({ email: "buyer@example.com", plan: "lifetime" }),
        method: "POST",
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("Iniciou checkout", { plan: "lifetime", source: "link" });

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("shows the server error when the checkout fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Pagamentos indisponíveis no momento." }, 503));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Passe de 30 dias/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Pagamentos indisponíveis no momento.");
  });

  it("requests an access link and shows the generic confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso por e-mail" }));

    expect(await screen.findByRole("status")).toHaveTextContent("receberá um link de acesso");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access/request-link",
      expect.objectContaining({
        body: JSON.stringify({ email: "user@example.com" }),
        method: "POST",
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("Pediu link de acesso", { source: "chat" });
  });

  it("shows an error when the access link request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso por e-mail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível enviar o link agora.");
  });

  it("renders nothing while closed", () => {
    const { container } = render(<PaywallDialog onClose={vi.fn()} open={false} source="chat" />);

    expect(container).toBeEmptyDOMElement();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
