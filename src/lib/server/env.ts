import path from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { config } from "dotenv";

if (process.env.NODE_ENV !== "production") {
  config({ path: path.resolve(process.cwd(), ".env") });
  config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
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
