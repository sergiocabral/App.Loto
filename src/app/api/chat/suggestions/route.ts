import { NextResponse } from "next/server";
import { DEFAULT_CHAT_SUGGESTIONS, type ChatSuggestion } from "@/lib/chatSuggestions";
import { getServerEnvValue, isOpenAIChatConfigured } from "@/lib/server/env";

export const dynamic = "force-dynamic";

function sanitizeSuggestionPart(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseSuggestion(index: number): ChatSuggestion | null {
  const rawValue = getServerEnvValue(`CHATGPT_BUTTON${index}`);

  if (!rawValue) {
    return null;
  }

  const [rawLabel, rawMessage, ...promptParts] = rawValue.split("|");
  const label = sanitizeSuggestionPart(rawLabel || "", 36);
  const message = sanitizeSuggestionPart(rawMessage || "", 180);
  const prompt = sanitizeSuggestionPart(promptParts.join("|") || "", 900);

  if (!label || !message || !prompt) {
    return null;
  }

  return {
    id: `chatgpt-button-${index}`,
    label,
    message,
    prompt,
  };
}

function getChatSuggestions(): ChatSuggestion[] {
  return DEFAULT_CHAT_SUGGESTIONS.map((defaultSuggestion, index) => parseSuggestion(index + 1) || defaultSuggestion);
}

export async function GET() {
  if (!isOpenAIChatConfigured()) {
    return NextResponse.json({ enabled: false, suggestions: [] });
  }

  return NextResponse.json({ enabled: true, suggestions: getChatSuggestions() });
}
