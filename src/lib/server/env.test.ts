import { afterEach, describe, expect, it, vi } from "vitest";

const cloudflareMocks = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));

vi.mock("@opennextjs/cloudflare", () => cloudflareMocks);

const originalEnvironment = { ...process.env };

async function loadEnvironment() {
  vi.resetModules();
  return import("@/lib/server/env");
}

describe("server environment", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
    cloudflareMocks.getCloudflareContext.mockReset();
    vi.resetModules();
  });

  it("prefers a non-empty process environment value over Cloudflare", async () => {
    process.env.OPENAI_API_KEY = "process-key";
    cloudflareMocks.getCloudflareContext.mockReturnValue({ env: { OPENAI_API_KEY: "worker-key" } });
    const { getServerEnvValue } = await loadEnvironment();

    expect(getServerEnvValue("OPENAI_API_KEY")).toBe("process-key");
  });

  it("uses Cloudflare values when no process value is available", async () => {
    delete process.env.SYNC_CRON_SECRET;
    cloudflareMocks.getCloudflareContext.mockReturnValue({ env: { SYNC_CRON_SECRET: " worker-secret " } });
    const { getCronSyncSecret } = await loadEnvironment();
    process.env.SYNC_CRON_SECRET = "";

    expect(getCronSyncSecret()).toBe("worker-secret");
  });

  it("rejects short or missing access cookie secrets and accepts valid ones", async () => {
    delete process.env.ACCESS_COOKIE_SECRET;
    const { getAccessCookieSecret } = await loadEnvironment();

    expect(getAccessCookieSecret()).toBeUndefined();

    process.env.ACCESS_COOKIE_SECRET = "too-short";
    expect(getAccessCookieSecret()).toBeUndefined();

    process.env.ACCESS_COOKIE_SECRET = "a".repeat(32);
    expect(getAccessCookieSecret()).toBe("a".repeat(32));
  });

  it("builds SMTP config with defaults and returns null when incomplete", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_FROM = '"Site" <no-reply@example.com>';
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    const { getSmtpConfig } = await loadEnvironment();

    expect(getSmtpConfig()).toEqual({
      from: '"Site" <no-reply@example.com>',
      host: "smtp.example.com",
      password: "secret",
      port: 587,
      secure: false,
      user: "user@example.com",
    });

    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "TRUE";
    expect(getSmtpConfig()).toMatchObject({ port: 465, secure: true });

    delete process.env.SMTP_HOST;
    expect(getSmtpConfig()).toBeNull();
  });

  it("builds Mercado Pago config with default API base URL", async () => {
    delete process.env.MP_ACCESS_TOKEN;
    const { getMercadoPagoConfig } = await loadEnvironment();

    expect(getMercadoPagoConfig()).toBeNull();

    process.env.MP_ACCESS_TOKEN = " TEST-token ";
    process.env.MP_WEBHOOK_SECRET = "";
    delete process.env.MP_API_BASE_URL;
    expect(getMercadoPagoConfig()).toEqual({
      accessToken: "TEST-token",
      apiBaseUrl: "https://api.mercadopago.com",
      webhookSecret: undefined,
    });

    process.env.MP_WEBHOOK_SECRET = "hook-secret";
    process.env.MP_API_BASE_URL = "http://localhost:9999";
    expect(getMercadoPagoConfig()).toEqual({
      accessToken: "TEST-token",
      apiBaseUrl: "http://localhost:9999",
      webhookSecret: "hook-secret",
    });
  });

  it("reads pass pricing from environment with defaults and validation", async () => {
    delete process.env.PASS_PRICE_30D_BRL;
    delete process.env.PASS_PRICE_LIFETIME_BRL;
    const { getPassPricing } = await loadEnvironment();

    expect(getPassPricing()).toEqual({ lifetimePriceBRL: 50, pass30PriceBRL: 10 });

    process.env.PASS_PRICE_30D_BRL = "12,90";
    process.env.PASS_PRICE_LIFETIME_BRL = "79.999";
    expect(getPassPricing()).toEqual({ lifetimePriceBRL: 80, pass30PriceBRL: 12.9 });

    process.env.PASS_PRICE_30D_BRL = "0";
    process.env.PASS_PRICE_LIFETIME_BRL = "abc";
    expect(getPassPricing()).toEqual({ lifetimePriceBRL: 50, pass30PriceBRL: 10 });
  });

  it("clamps supported OpenAI numeric settings and ignores malformed values", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_CHAT_MODEL = "gpt-test";
    process.env.OPENAI_CHAT_COMPLETION_TOKENS = "999999";
    process.env.OPENAI_CHAT_MAX_REPLY_CHARS = "1";
    process.env.OPENAI_CHAT_RETRY_COMPLETION_TOKENS = "not-an-integer";
    const { getOpenAIChatConfig } = await loadEnvironment();

    expect(getOpenAIChatConfig()).toEqual({
      apiKey: "test-key",
      completionTokens: 32_000,
      maxReplyChars: 400,
      model: "gpt-test",
      retryCompletionTokens: undefined,
    });
  });
});
