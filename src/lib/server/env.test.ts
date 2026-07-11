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
