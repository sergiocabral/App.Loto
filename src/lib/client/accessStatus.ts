export type AccessPlanPrices = {
  lifetime: { priceBRL: number };
  pass30: { priceBRL: number };
};

export type AccessStatus = {
  chat: { limit: number; used: number };
  expiresAt?: string | null;
  licensed: boolean;
  plan?: "lifetime" | "pass30";
  plans: AccessPlanPrices;
};

export const DEFAULT_ACCESS_STATUS: AccessStatus = {
  chat: { limit: 3, used: 0 },
  licensed: false,
  plans: {
    lifetime: { priceBRL: 50 },
    pass30: { priceBRL: 10 },
  },
};

function toPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function fetchAccessStatus(): Promise<AccessStatus> {
  try {
    const response = await fetch("/api/access/status", { cache: "no-store" });

    if (!response.ok) {
      return DEFAULT_ACCESS_STATUS;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const chat = (payload.chat ?? {}) as Record<string, unknown>;
    const plans = (payload.plans ?? {}) as Record<string, Record<string, unknown>>;
    const licensed = payload.licensed === true;
    const plan = payload.plan === "pass30" || payload.plan === "lifetime" ? payload.plan : undefined;

    return {
      chat: {
        limit: toPositiveNumber(chat.limit, DEFAULT_ACCESS_STATUS.chat.limit),
        used: typeof chat.used === "number" && Number.isFinite(chat.used) && chat.used >= 0 ? chat.used : 0,
      },
      expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
      licensed,
      ...(plan ? { plan } : {}),
      plans: {
        lifetime: {
          priceBRL: toPositiveNumber(plans.lifetime?.priceBRL, DEFAULT_ACCESS_STATUS.plans.lifetime.priceBRL),
        },
        pass30: {
          priceBRL: toPositiveNumber(plans.pass30?.priceBRL, DEFAULT_ACCESS_STATUS.plans.pass30.priceBRL),
        },
      },
    };
  } catch {
    return DEFAULT_ACCESS_STATUS;
  }
}

export function formatPriceBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value);
}
