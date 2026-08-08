"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { DEFAULT_ACCESS_STATUS, formatPriceBRL, type AccessPlanPrices } from "@/lib/client/accessStatus";

export type PaywallSource = "chat" | "link" | "raw" | "simulator";

type PaywallPlan = "lifetime" | "pass30";

type PaywallContentProps = {
  plans?: AccessPlanPrices;
  source: PaywallSource;
};

type PaywallDialogProps = PaywallContentProps & {
  onClose: () => void;
  open: boolean;
};

const SOURCE_MESSAGES: Record<PaywallSource, string> = {
  chat: "Você usou as mensagens grátis do chat de hoje.",
  link: "Este recurso faz parte do acesso completo.",
  raw: "A lista completa de sorteios com download faz parte do acesso completo.",
  simulator: "Você usou as simulações grátis de hoje.",
};

type RequestState = "error" | "idle" | "loading" | "sent";

export function PaywallContent({ plans = DEFAULT_ACCESS_STATUS.plans, source }: PaywallContentProps) {
  const [email, setEmail] = useState("");
  const [checkoutPlan, setCheckoutPlan] = useState<PaywallPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<RequestState>("idle");

  const isEmailFilled = email.trim().length > 3 && email.includes("@");

  const startCheckout = useCallback(
    async (plan: PaywallPlan) => {
      if (!isEmailFilled || checkoutPlan) {
        setErrorMessage(isEmailFilled ? null : "Informe seu e-mail para continuar.");
        return;
      }

      setCheckoutPlan(plan);
      setErrorMessage(null);
      trackEvent(ANALYTICS_EVENTS.paywallCheckoutStarted, { plan, source });

      try {
        const response = await fetch("/api/billing/checkout", {
          body: JSON.stringify({ email: email.trim(), plan }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok || typeof payload.initPoint !== "string") {
          setErrorMessage(
            typeof payload.error === "string" ? payload.error : "Não foi possível iniciar o pagamento agora.",
          );
          setCheckoutPlan(null);
          return;
        }

        window.location.assign(payload.initPoint);
      } catch {
        setErrorMessage("Não foi possível iniciar o pagamento agora.");
        setCheckoutPlan(null);
      }
    },
    [checkoutPlan, email, isEmailFilled, source],
  );

  const requestAccessLink = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      if (!isEmailFilled || linkState === "loading") {
        setErrorMessage(isEmailFilled ? null : "Informe seu e-mail para continuar.");
        return;
      }

      setLinkState("loading");
      setErrorMessage(null);
      trackEvent(ANALYTICS_EVENTS.paywallLinkRequested, { source });

      try {
        const response = await fetch("/api/access/request-link", {
          body: JSON.stringify({ email: email.trim() }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });

        setLinkState(response.ok ? "sent" : "error");
      } catch {
        setLinkState("error");
      }
    },
    [email, isEmailFilled, linkState, source],
  );

  return (
    <div className="paywall__content">
      <p className="paywall__context">{SOURCE_MESSAGES[source]}</p>

      <ul className="paywall__benefits">
        <li>Simulador de sorteios anteriores sem limite diário.</li>
        <li>Chat GPT com até 100 mensagens por dia.</li>
        <li>Lista completa de sorteios com download.</li>
      </ul>

      <label className="paywall__email-label" htmlFor="paywall-email">
        Seu e-mail
      </label>
      <input
        autoComplete="email"
        className="paywall__email-input"
        id="paywall-email"
        inputMode="email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="voce@exemplo.com"
        type="email"
        value={email}
      />
      <p className="paywall__privacy">Usamos seu e-mail apenas para entregar o link de acesso.</p>

      <div className="paywall__plans">
        <button
          className="paywall__plan paywall__plan--primary"
          disabled={checkoutPlan !== null}
          onClick={() => void startCheckout("pass30")}
          type="button"
        >
          <strong>Passe de 30 dias</strong>
          <span>{formatPriceBRL(plans.pass30.priceBRL)}</span>
          <small>Pix ou cartão pelo Mercado Pago</small>
        </button>
        <button
          className="paywall__plan"
          disabled={checkoutPlan !== null}
          onClick={() => void startCheckout("lifetime")}
          type="button"
        >
          <strong>Passe vitalício</strong>
          <span>{formatPriceBRL(plans.lifetime.priceBRL)}</span>
          <small>Pague uma vez, use sempre</small>
        </button>
      </div>

      {checkoutPlan ? <p className="paywall__status">Abrindo o pagamento seguro do Mercado Pago...</p> : null}
      {errorMessage ? (
        <p className="paywall__error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <form className="paywall__existing" onSubmit={requestAccessLink}>
        <p className="paywall__existing-title">Já tem um passe?</p>
        {linkState === "sent" ? (
          <p className="paywall__status" role="status">
            Se este e-mail tiver um passe ativo, você receberá um link de acesso em instantes.
          </p>
        ) : (
          <button className="paywall__link-button" disabled={linkState === "loading"} type="submit">
            {linkState === "loading" ? "Enviando..." : "Receber link de acesso por e-mail"}
          </button>
        )}
        {linkState === "error" ? (
          <p className="paywall__error" role="alert">
            Não foi possível enviar o link agora. Tente novamente.
          </p>
        ) : null}
      </form>

      <p className="paywall__disclaimer">
        Estatísticas para leitura histórica dos sorteios públicos. Sem promessa de previsão ou ganho.
      </p>
    </div>
  );
}

export function PaywallDialog({ onClose, open, plans, source }: PaywallDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    trackEvent(ANALYTICS_EVENTS.paywallOpened, { source });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, source]);

  if (!open) {
    return null;
  }

  return (
    <div className="paywall__root">
      <button aria-label="Fechar acesso completo" className="paywall__backdrop" onClick={onClose} type="button" />
      <div
        aria-label="Acesso completo"
        aria-modal="true"
        className="paywall__panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="paywall__header">
          <div>
            <p className="paywall__kicker">Acesso completo</p>
            <h2>Libere tudo do Luckygames</h2>
          </div>
          <button aria-label="Fechar" className="paywall__close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <PaywallContent plans={plans} source={source} />
      </div>
    </div>
  );
}
