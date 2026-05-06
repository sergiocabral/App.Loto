import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { config } from "dotenv";

function shouldLoadLocalEnvFiles(): boolean {
  return process.env.NEXT_RUNTIME_PROVIDER !== "cloudflare";
}

if (shouldLoadLocalEnvFiles()) {
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
