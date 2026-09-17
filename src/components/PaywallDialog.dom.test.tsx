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
    expect(trackEvent).toHaveBeenCalledWith("Abriu paywall", { source: "simulator", variant: "dialog" });
  });

  it("puts the e-mail and the access link button before the purchase options", () => {
    render(<PaywallContent source="cta" />);

    const input = screen.getByLabelText("Seu e-mail");
    const linkButton = screen.getByRole("button", { name: "Receber link de acesso" });
    const planButton = screen.getByRole("button", { name: /Passe de 30 dias/ });
    const purchase = screen.getByRole("region", { name: "Ainda não tem acesso?" });

    expect(input.compareDocumentPosition(linkButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(linkButton.compareDocumentPosition(planButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(purchase).toContainElement(planButton);
    expect(purchase).not.toContainElement(linkButton);
  });

  it("closes on backdrop, close button and escape key, tracking how it was closed", () => {
    const onClose = vi.fn();
    render(<PaywallDialog onClose={onClose} open source="chat" />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar acesso completo" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(trackEvent).toHaveBeenCalledWith("Fechou paywall", { method: "backdrop", source: "chat" });
    expect(trackEvent).toHaveBeenCalledWith("Fechou paywall", { method: "button", source: "chat" });
    expect(trackEvent).toHaveBeenCalledWith("Fechou paywall", { method: "escape", source: "chat" });
  });

  it("tracks the opening only once when the parent re-renders with a new onClose", () => {
    const { rerender } = render(<PaywallDialog onClose={() => undefined} open source="cta" />);
    const latestOnClose = vi.fn();

    rerender(<PaywallDialog onClose={() => undefined} open source="cta" />);
    rerender(<PaywallDialog onClose={latestOnClose} open source="cta" />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(trackEvent.mock.calls.filter(([name]) => name === "Abriu paywall")).toHaveLength(1);
    expect(latestOnClose).toHaveBeenCalledTimes(1);
  });

  it("tracks the standalone page variant once", () => {
    render(<PaywallContent source="rawPage" variant="page" />);

    expect(screen.getByText("A lista completa de sorteios com download faz parte do acesso completo.")).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith("Abriu paywall", { source: "rawPage", variant: "page" });
  });

  it("requires an e-mail before starting a checkout and sends the user back to the field", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="raw" />);

    fireEvent.click(screen.getByRole("button", { name: /Passe de 30 dias/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe seu e-mail acima");
    const input = screen.getByLabelText("Seu e-mail");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveClass("is-attention");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("Paywall sem e-mail", { action: "checkout", source: "raw" });

    fireEvent.change(input, { target: { value: "b" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
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
    expect(trackEvent).toHaveBeenCalledWith("Falhou checkout", { plan: "pass30", source: "chat", status: 503 });
    expect(screen.getByRole("button", { name: /Passe de 30 dias/ })).toBeEnabled();
  });

  it("shows a generic error when the checkout request cannot be sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Passe vitalício/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível iniciar o pagamento agora.");
    expect(trackEvent).toHaveBeenCalledWith("Falhou checkout", { plan: "lifetime", source: "chat", status: "network" });
  });

  it("requires an e-mail before requesting an access link", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="cta" />);

    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Informe seu e-mail para receber o link de acesso.");
    expect(screen.getByLabelText("Seu e-mail")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("Paywall sem e-mail", { action: "link", source: "cta" });
  });

  it("requests an access link and shows the generic confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso" }));

    expect(await screen.findByRole("status")).toHaveTextContent("receberá um link de acesso");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access/request-link",
      expect.objectContaining({
        body: JSON.stringify({ email: "user@example.com" }),
        method: "POST",
      }),
    );
    expect(trackEvent).toHaveBeenCalledWith("Pediu link de acesso", { source: "chat" });
    expect(trackEvent).toHaveBeenCalledWith("Pedido de link aceito", { source: "chat" });
  });

  it("shows an error when the access link request is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "rate limited" }, 429)));
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível enviar o link agora.");
    expect(trackEvent).toHaveBeenCalledWith("Falhou pedido de link", { source: "chat", status: 429 });
  });

  it("shows an error when the access link request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaywallContent source="chat" />);

    fireEvent.change(screen.getByLabelText("Seu e-mail"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Receber link de acesso" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível enviar o link agora.");
    expect(trackEvent).toHaveBeenCalledWith("Falhou pedido de link", { source: "chat", status: "network" });
  });

  it("renders nothing while closed", () => {
    const { container } = render(<PaywallDialog onClose={vi.fn()} open={false} source="chat" />);

    expect(container).toBeEmptyDOMElement();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
