"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";
import { DEFAULT_ACCESS_STATUS, formatPriceBRL, type AccessPlanPrices } from "@/lib/client/accessStatus";

export type PaywallSource = "chat" | "cta" | "link" | "raw" | "rawPage" | "simulator";

export type PaywallVariant = "dialog" | "page";

type PaywallPlan = "lifetime" | "pass30";

type PaywallCloseMethod = "backdrop" | "button" | "escape";

type PaywallContentProps = {
  plans?: AccessPlanPrices;
  source: PaywallSource;
  variant?: PaywallVariant;
};

type PaywallDialogProps = Omit<PaywallContentProps, "variant"> & {
  onClose: () => void;
  open: boolean;
};

const SOURCE_MESSAGES: Record<PaywallSource, string> = {
  chat: "Você usou as mensagens grátis do chat de hoje.",
  cta: "Desbloqueie o acesso completo: simulador ilimitado, chat turbinado e a lista completa de sorteios.",
  link: "Este recurso faz parte do acesso completo.",
  raw: "A lista completa de sorteios com download faz parte do acesso completo.",
  rawPage: "A lista completa de sorteios com download faz parte do acesso completo.",
  simulator: "Você usou as simulações grátis de hoje.",
};

const EMAIL_REQUIRED_MESSAGES = {
  checkout: "Informe seu e-mail acima para escolher um passe.",
  link: "Informe seu e-mail para receber o link de acesso.",
} as const;

const CHECKOUT_ERROR_MESSAGE = "Não foi possível iniciar o pagamento agora.";

type RequestState = "error" | "idle" | "loading" | "sent";

export function PaywallContent({ plans = DEFAULT_ACCESS_STATUS.plans, source, variant = "dialog" }: PaywallContentProps) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<PaywallPlan | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<RequestState>("idle");
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const idPrefix = useId();
  const emailInputId = `${idPrefix}-email`;
  const emailErrorId = `${idPrefix}-email-error`;
  const accessHintId = `${idPrefix}-access-hint`;
  const purchaseTitleId = `${idPrefix}-purchase-title`;

  const isEmailFilled = email.trim().length > 3 && email.includes("@");

  // No modal, a abertura é medida pelo PaywallDialog; na página (ex.: /raw) o próprio conteúdo é a "abertura".
  useEffect(() => {
    if (variant === "page") {
      trackEvent(ANALYTICS_EVENTS.paywallOpened, { source, variant });
    }
  }, [source, variant]);

  // Sem e-mail, leva a pessoa de volta ao campo único do topo em vez de só mostrar um erro distante.
  const requireEmail = useCallback(
    (action: keyof typeof EMAIL_REQUIRED_MESSAGES) => {
      setEmailError(EMAIL_REQUIRED_MESSAGES[action]);
      trackEvent(ANALYTICS_EVENTS.paywallEmailMissing, { action, source });

      const input = emailInputRef.current;
      input?.focus({ preventScroll: true });
      input?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    },
    [source],
  );

  const startCheckout = useCallback(
    async (plan: PaywallPlan) => {
      if (checkoutPlan) {
        return;
      }

      if (!isEmailFilled) {
        requireEmail("checkout");
        return;
      }

      setCheckoutPlan(plan);
      setCheckoutError(null);
      setEmailError(null);
      trackEvent(ANALYTICS_EVENTS.paywallCheckoutStarted, { plan, source });

      try {
        const response = await fetch("/api/billing/checkout", {
          body: JSON.stringify({ email: email.trim(), plan }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (!response.ok || typeof payload.initPoint !== "string") {
          setCheckoutError(typeof payload.error === "string" ? payload.error : CHECKOUT_ERROR_MESSAGE);
          trackEvent(ANALYTICS_EVENTS.paywallCheckoutFailed, { plan, source, status: response.status });
          setCheckoutPlan(null);
          return;
        }

        window.location.assign(payload.initPoint);
      } catch {
        setCheckoutError(CHECKOUT_ERROR_MESSAGE);
        trackEvent(ANALYTICS_EVENTS.paywallCheckoutFailed, { plan, source, status: "network" });
        setCheckoutPlan(null);
      }
    },
    [checkoutPlan, email, isEmailFilled, requireEmail, source],
  );

  const requestAccessLink = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();

      if (linkState === "loading") {
        return;
      }

      if (!isEmailFilled) {
        requireEmail("link");
        return;
      }

      setLinkState("loading");
      setEmailError(null);
      trackEvent(ANALYTICS_EVENTS.paywallLinkRequested, { source });

      try {
        const response = await fetch("/api/access/request-link", {
          body: JSON.stringify({ email: email.trim() }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });

        if (response.ok) {
          setLinkState("sent");
          trackEvent(ANALYTICS_EVENTS.paywallLinkAccepted, { source });
          return;
        }

        setLinkState("error");
        trackEvent(ANALYTICS_EVENTS.paywallLinkFailed, { source, status: response.status });
      } catch {
        setLinkState("error");
        trackEvent(ANALYTICS_EVENTS.paywallLinkFailed, { source, status: "network" });
      }
    },
    [email, isEmailFilled, linkState, requireEmail, source],
  );

  return (
    <div className="paywall__content">
      <p className="paywall__context">{SOURCE_MESSAGES[source]}</p>

      <form className="paywall__access" onSubmit={requestAccessLink}>
        <label className="paywall__email-label" htmlFor={emailInputId}>
          Seu e-mail
        </label>
        <input
          aria-describedby={emailError ? emailErrorId : accessHintId}
          aria-invalid={emailError ? true : undefined}
          autoComplete="email"
          className={`paywall__email-input${emailError ? " is-attention" : ""}`}
          id={emailInputId}
          inputMode="email"
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
          placeholder="voce@exemplo.com"
          ref={emailInputRef}
          type="email"
          value={email}
        />
        {emailError ? (
          <p className="paywall__error" id={emailErrorId} role="alert">
            {emailError}
          </p>
        ) : null}

        <div className="paywall__access-copy">
          <p className="paywall__access-title">Já tem acesso?</p>
          <p className="paywall__access-hint" id={accessHintId}>
            Informe o e-mail usado na compra e receba um link para entrar neste dispositivo.
          </p>
        </div>

        {linkState === "sent" ? (
          <p className="paywall__status" role="status">
            Se este e-mail tiver um passe ativo, você receberá um link de acesso em instantes.
          </p>
        ) : (
          <button className="paywall__link-button" disabled={linkState === "loading"} type="submit">
            {linkState === "loading" ? "Enviando..." : "Receber link de acesso"}
          </button>
        )}
        {linkState === "error" ? (
          <p className="paywall__error" role="alert">
            Não foi possível enviar o link agora. Tente novamente.
          </p>
        ) : null}
      </form>

      <div aria-hidden="true" className="paywall__divider">
        <span>ou</span>
      </div>

      <section aria-labelledby={purchaseTitleId} className="paywall__purchase">
        <div>
          <p className="paywall__purchase-title" id={purchaseTitleId}>
            Ainda não tem acesso?
          </p>
          <p className="paywall__purchase-hint">Escolha um passe e libere:</p>
        </div>

        <ul className="paywall__benefits">
          <li>Simulador de sorteios anteriores sem limite diário.</li>
          <li>Chat GPT com até 100 mensagens por dia.</li>
          <li>Lista completa de sorteios com download.</li>
        </ul>

        <p className="paywall__privacy">Usaremos o e-mail informado acima apenas para entregar seu acesso.</p>

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
        {checkoutError ? (
          <p className="paywall__error" role="alert">
            {checkoutError}
          </p>
        ) : null}
      </section>

      <p className="paywall__disclaimer">
        Estatísticas para leitura histórica dos sorteios públicos. Sem promessa de previsão ou ganho.
      </p>
    </div>
  );
}

export function PaywallDialog({ onClose, open, plans, source }: PaywallDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Quem abre o modal costuma passar um onClose inline; guardá-lo numa ref evita que cada
  // re-render do pai reexecute o efeito de abertura (e reenvie "Abriu paywall").
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback(
    (method: PaywallCloseMethod) => {
      trackEvent(ANALYTICS_EVENTS.paywallClosed, { method, source });
      onCloseRef.current();
    },
    [source],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    trackEvent(ANALYTICS_EVENTS.paywallOpened, { source, variant: "dialog" });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close("escape");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open, source]);

  if (!open) {
    return null;
  }

  return (
    <div className="paywall__root">
      <button
        aria-label="Fechar acesso completo"
        className="paywall__backdrop"
        onClick={() => close("backdrop")}
        type="button"
      />
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
          <button aria-label="Fechar" className="paywall__close" onClick={() => close("button")} type="button">
            ×
          </button>
        </div>
        <PaywallContent plans={plans} source={source} />
      </div>
    </div>
  );
}
