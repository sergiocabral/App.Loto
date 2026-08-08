import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = { ...process.env };

function setSmtpEnvironment(): void {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_PASSWORD = "secret";
  process.env.SMTP_FROM = '"Luckygames.tips" <sender@example.com>';
  process.env.OFFICIAL_DOMAIN_NAME = "luckygames.tips";
}

async function loadMailer() {
  vi.resetModules();
  return import("@/lib/server/mailer");
}

describe("access link mailer", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
    vi.restoreAllMocks();
  });

  it("builds activation URLs on the official site", async () => {
    setSmtpEnvironment();
    const { buildAccessLinkUrl } = await loadMailer();

    expect(buildAccessLinkUrl("abc/+~")).toBe(
      `https://luckygames.tips/api/access/activate?token=${encodeURIComponent("abc/+~")}`,
    );
  });

  it("returns false without sending when SMTP is not configured", async () => {
    const { sendAccessLinkEmail } = await loadMailer();
    delete process.env.SMTP_HOST;
    const sendMail = vi.fn();

    const result = await sendAccessLinkEmail(
      { kind: "activation", plan: "pass30", to: "user@example.com", token: "tok" },
      () => ({ sendMail }),
    );

    expect(result).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends activation e-mails with STARTTLS transport settings", async () => {
    setSmtpEnvironment();
    const { sendAccessLinkEmail } = await loadMailer();
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["user@example.com"] });
    const factory = vi.fn(() => ({ sendMail }));

    const result = await sendAccessLinkEmail(
      { kind: "activation", plan: "lifetime", to: "user@example.com", token: "tok-123" },
      factory,
    );

    expect(result).toBe(true);
    expect(factory).toHaveBeenCalledWith({
      auth: { pass: "secret", user: "sender@example.com" },
      host: "smtp.example.com",
      port: 587,
      requireTLS: true,
      secure: false,
    });

    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe("user@example.com");
    expect(message.from).toContain("Luckygames.tips");
    expect(message.subject).toContain("pronto");
    expect(message.text).toContain("Passe vitalício");
    expect(message.text).toContain("https://luckygames.tips/api/access/activate?token=tok-123");
    expect(message.text).toContain("48 horas");
    expect(message.html).toContain("token=tok-123");
  });

  it("describes login links with the short validity window", async () => {
    setSmtpEnvironment();
    const { sendAccessLinkEmail } = await loadMailer();
    const sendMail = vi.fn().mockResolvedValue({});

    await sendAccessLinkEmail(
      { kind: "login", plan: "pass30", to: "user@example.com", token: "tok-login" },
      () => ({ sendMail }),
    );

    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toContain("link de acesso");
    expect(message.text).toContain("30 minutos");
    expect(message.text).toContain("Passe de 30 dias");
  });

  it("returns false when the transport rejects", async () => {
    setSmtpEnvironment();
    const { sendAccessLinkEmail } = await loadMailer();
    const sendMail = vi.fn().mockRejectedValue(new Error("connection refused"));

    const result = await sendAccessLinkEmail(
      { kind: "login", plan: "pass30", to: "user@example.com", token: "tok" },
      () => ({ sendMail }),
    );

    expect(result).toBe(false);
  });
});
