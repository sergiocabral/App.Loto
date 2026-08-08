import { getSmtpConfig } from "@/lib/server/env";
import { getSafeErrorDetails } from "@/lib/server/security";
import { getOfficialSiteUrl } from "@/lib/siteUrl";

const MAILER_LOG_PREFIX = "[app-loto-next][mailer]";

export type AccessLinkKind = "activation" | "login";

type SendAccessLinkInput = {
  kind: AccessLinkKind;
  plan: "lifetime" | "pass30";
  to: string;
  token: string;
};

type MailTransport = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
};

type TransportFactory = (config: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  requireTLS: boolean;
}) => MailTransport;

async function createDefaultTransport(config: Parameters<TransportFactory>[0]): Promise<MailTransport> {
  const { default: nodemailer } = await import("nodemailer");
  return nodemailer.createTransport(config);
}

export function buildAccessLinkUrl(token: string): string {
  const baseUrl = getOfficialSiteUrl();
  return new URL(`/api/access/activate?token=${encodeURIComponent(token)}`, baseUrl).toString();
}

const PLAN_LABELS: Record<SendAccessLinkInput["plan"], string> = {
  lifetime: "Passe vitalício",
  pass30: "Passe de 30 dias",
};

function buildEmailContent(input: SendAccessLinkInput): { subject: string; text: string; html: string } {
  const url = buildAccessLinkUrl(input.token);
  const planLabel = PLAN_LABELS[input.plan];
  const subject =
    input.kind === "activation"
      ? "Seu acesso ao Luckygames está pronto"
      : "Seu link de acesso ao Luckygames";
  const intro =
    input.kind === "activation"
      ? `Pagamento confirmado! Seu ${planLabel} do Luckygames está ativo.`
      : `Você pediu um novo link de acesso ao Luckygames (${planLabel}).`;
  const text = [
    intro,
    "",
    "Clique no link abaixo para ativar o acesso neste dispositivo:",
    url,
    "",
    input.kind === "activation"
      ? "O link vale por 48 horas e pode ser usado uma única vez."
      : "O link vale por 30 minutos e pode ser usado uma única vez.",
    "Se precisar de um novo link, use a opção \"Já tenho acesso\" no site.",
    "",
    "Luckygames.tips — consulta e estatísticas das Loterias da Caixa.",
  ].join("\n");
  const html = [
    `<p>${intro}</p>`,
    `<p><a href="${url}">Clique aqui para ativar o acesso neste dispositivo</a>.</p>`,
    `<p>${
      input.kind === "activation"
        ? "O link vale por 48 horas e pode ser usado uma única vez."
        : "O link vale por 30 minutos e pode ser usado uma única vez."
    }</p>`,
    '<p>Se precisar de um novo link, use a opção "Já tenho acesso" no site.</p>',
    "<p>Luckygames.tips — consulta e estatísticas das Loterias da Caixa.</p>",
  ].join("\n");

  return { subject, text, html };
}

export async function sendAccessLinkEmail(
  input: SendAccessLinkInput,
  transportFactory: TransportFactory | null = null,
): Promise<boolean> {
  const config = getSmtpConfig();

  if (!config) {
    console.warn(MAILER_LOG_PREFIX, "sendAccessLinkEmail:smtp-not-configured");
    return false;
  }

  const transportConfig = {
    auth: { pass: config.password, user: config.user },
    host: config.host,
    port: config.port,
    requireTLS: !config.secure,
    secure: config.secure,
  };

  try {
    const transport = transportFactory
      ? transportFactory(transportConfig)
      : await createDefaultTransport(transportConfig);
    const content = buildEmailContent(input);

    await transport.sendMail({
      from: config.from,
      html: content.html,
      subject: content.subject,
      text: content.text,
      to: input.to,
    });

    console.info(MAILER_LOG_PREFIX, "sendAccessLinkEmail:sent", { kind: input.kind });
    return true;
  } catch (error) {
    console.warn(MAILER_LOG_PREFIX, "sendAccessLinkEmail:failed", {
      error: getSafeErrorDetails(error),
      kind: input.kind,
    });
    return false;
  }
}
