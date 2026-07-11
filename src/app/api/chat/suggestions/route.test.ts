import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHAT_SUGGESTIONS } from "@/lib/chatSuggestions";

const environmentMocks = vi.hoisted(() => ({
  getServerEnvValue: vi.fn<(name: string) => string | undefined>(),
  isOpenAIChatConfigured: vi.fn<() => boolean>(),
}));

vi.mock("@/lib/server/env", () => environmentMocks);

describe("chat suggestions route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("does not publish suggestions when chat is disabled", async () => {
    environmentMocks.isOpenAIChatConfigured.mockReturnValue(false);
    const { GET } = await import("@/app/api/chat/suggestions/route");

    expect(await (await GET()).json()).toEqual({ enabled: false, suggestions: [] });
  });

  it("uses valid configured suggestions and falls back per invalid entry", async () => {
    environmentMocks.isOpenAIChatConfigured.mockReturnValue(true);
    environmentMocks.getServerEnvValue.mockImplementation((name) => {
      if (name === "CHATGPT_BUTTON1") {
        return "  Mapa customizado |  Mensagem customizada  | Prompt com | separador  ";
      }
      if (name === "CHATGPT_BUTTON2") {
        return "incompleto|sem prompt";
      }
      return undefined;
    });
    const { GET } = await import("@/app/api/chat/suggestions/route");
    const payload = (await (await GET()).json()) as { enabled: boolean; suggestions: typeof DEFAULT_CHAT_SUGGESTIONS };

    expect(payload.enabled).toBe(true);
    expect(payload.suggestions[0]).toEqual({
      id: "chatgpt-button-1",
      label: "Mapa customizado",
      message: "Mensagem customizada",
      prompt: "Prompt com | separador",
    });
    expect(payload.suggestions[1]).toEqual(DEFAULT_CHAT_SUGGESTIONS[1]);
  });
});
