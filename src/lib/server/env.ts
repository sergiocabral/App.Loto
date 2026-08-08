import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { config } from "dotenv";

if (process.env.NEXT_RUNTIME_PROVIDER !== "cloudflare") {
  config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
  config({ path: path.resolve(process.cwd(), ".env.local"), override: true, quiet: true });
}

export function getCloudflareEnv(): Record<string, unknown> | null {
  try {
    return getCloudflareContext().env as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getServerEnvValue(name: string): string | undefined {
  const processValue = process.env[name];

  if (processValue) {
    return processValue;
  }

  const cloudflareValue = getCloudflareEnv()?.[name];
  return typeof cloudflareValue === "string" ? cloudflareValue : undefined;
}

export function getCronSyncSecret(): string | undefined {
  return getServerEnvValue("SYNC_CRON_SECRET")?.trim() || undefined;
}

type OpenAIChatConfig = {
  apiKey: string;
  completionTokens?: number;
  maxReplyChars?: number;
  model: string;
  retryCompletionTokens?: number;
};

function getOptionalServerEnvInteger(name: string, min: number, max: number): number | undefined {
  const rawValue = getServerEnvValue(name)?.trim();

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value)) {
    return undefined;
  }

  return Math.min(Math.max(value, min), max);
}

export function getOpenAIChatConfig(): OpenAIChatConfig | null {
  const apiKey = getServerEnvValue("OPENAI_API_KEY")?.trim();
  const model = getServerEnvValue("OPENAI_CHAT_MODEL")?.trim();

  if (!apiKey || !model) {
    return null;
  }

  return {
    apiKey,
    completionTokens: getOptionalServerEnvInteger("OPENAI_CHAT_COMPLETION_TOKENS", 120, 32_000),
    maxReplyChars: getOptionalServerEnvInteger("OPENAI_CHAT_MAX_REPLY_CHARS", 400, 6_000),
    model,
    retryCompletionTokens: getOptionalServerEnvInteger("OPENAI_CHAT_RETRY_COMPLETION_TOKENS", 120, 32_000),
  };
}

export function isOpenAIChatConfigured(): boolean {
  return Boolean(getOpenAIChatConfig());
}

const MIN_ACCESS_COOKIE_SECRET_LENGTH = 32;

export function getAccessCookieSecret(): string | undefined {
  const secret = getServerEnvValue("ACCESS_COOKIE_SECRET")?.trim();

  if (!secret || secret.length < MIN_ACCESS_COOKIE_SECRET_LENGTH) {
    return undefined;
  }

  return secret;
}

type SmtpConfig = {
  from: string;
  host: string;
  password: string;
  port: number;
  secure: boolean;
  user: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = getServerEnvValue("SMTP_HOST")?.trim();
  const user = getServerEnvValue("SMTP_USER")?.trim();
  const password = getServerEnvValue("SMTP_PASSWORD");
  const from = getServerEnvValue("SMTP_FROM")?.trim();

  if (!host || !user || !password || !from) {
    return null;
  }

  return {
    from,
    host,
    password,
    port: getOptionalServerEnvInteger("SMTP_PORT", 1, 65_535) ?? 587,
    secure: getServerEnvValue("SMTP_SECURE")?.trim().toLowerCase() === "true",
    user,
  };
}

type MercadoPagoConfig = {
  accessToken: string;
  apiBaseUrl: string;
  webhookSecret?: string;
};

const DEFAULT_MERCADO_PAGO_API_BASE_URL = "https://api.mercadopago.com";

export function getMercadoPagoConfig(): MercadoPagoConfig | null {
  const accessToken = getServerEnvValue("MP_ACCESS_TOKEN")?.trim();

  if (!accessToken) {
    return null;
  }

  return {
    accessToken,
    apiBaseUrl: getServerEnvValue("MP_API_BASE_URL")?.trim() || DEFAULT_MERCADO_PAGO_API_BASE_URL,
    webhookSecret: getServerEnvValue("MP_WEBHOOK_SECRET")?.trim() || undefined,
  };
}

type PassPricing = {
  lifetimePriceBRL: number;
  pass30PriceBRL: number;
};

const DEFAULT_PASS30_PRICE_BRL = 10;
const DEFAULT_LIFETIME_PRICE_BRL = 50;
const MIN_PASS_PRICE_BRL = 1;
const MAX_PASS_PRICE_BRL = 10_000;

function getOptionalServerEnvPrice(name: string): number | undefined {
  const rawValue = getServerEnvValue(name)?.trim().replace(",", ".");

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value < MIN_PASS_PRICE_BRL || value > MAX_PASS_PRICE_BRL) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

export function getPassPricing(): PassPricing {
  return {
    lifetimePriceBRL: getOptionalServerEnvPrice("PASS_PRICE_LIFETIME_BRL") ?? DEFAULT_LIFETIME_PRICE_BRL,
    pass30PriceBRL: getOptionalServerEnvPrice("PASS_PRICE_30D_BRL") ?? DEFAULT_PASS30_PRICE_BRL,
  };
}
