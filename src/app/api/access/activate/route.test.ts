import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const licensingMocks = vi.hoisted(() => ({
  consumeAccessToken: vi.fn(),
  isLicenseUsable: vi.fn(
    (license: { status?: string; expiresAt?: Date | null } | null) =>
      Boolean(
        license &&
          license.status === "active" &&
          (license.expiresAt == null || license.expiresAt.getTime() > Date.now()),
      ),
  ),
}));

vi.mock("@/lib/server/licensing", () => licensingMocks);

import { GET } from "@/app/api/access/activate/route";

const SECRET = "activate-route-secret-with-32-chars!";

function activateRequest(token: string | null, base = "https://luckygames.tips"): Request {
  const url = new URL("/api/access/activate", base);

  if (token !== null) {
    url.searchParams.set("token", token);
  }

  return new Request(url, { method: "GET" });
}

const ACTIVE_LICENSE = {
  createdAt: new Date(),
  email: "user@example.com",
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  id: 7,
  plan: "pass30" as const,
  status: "active" as const,
  updatedAt: new Date(),
};

describe("GET /api/access/activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCESS_COOKIE_SECRET = SECRET;
    process.env.OFFICIAL_DOMAIN_NAME = "luckygames.tips";
    licensingMocks.consumeAccessToken.mockResolvedValue(ACTIVE_LICENSE);
  });

  afterEach(() => {
    delete process.env.ACCESS_COOKIE_SECRET;
    delete process.env.OFFICIAL_DOMAIN_NAME;
  });

  it("consumes the token, sets the access cookie and redirects to success", async () => {
    const response = await GET(activateRequest("valid-token"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://luckygames.tips/?acesso=ativado");

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("lg_access=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(licensingMocks.consumeAccessToken).toHaveBeenCalledWith("valid-token");
  });

  it("redirects to the local host without Secure when activating via localhost", async () => {
    const response = await GET(activateRequest("valid-token", "http://localhost:3150"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3150/?acesso=ativado");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("redirects to the invalid outcome for used, expired or unknown tokens", async () => {
    licensingMocks.consumeAccessToken.mockResolvedValueOnce(null);
    const unknown = await GET(activateRequest("unknown-token"));
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get("location")).toBe("https://luckygames.tips/?acesso=invalido");
    expect(unknown.headers.get("set-cookie")).toBeNull();

    licensingMocks.consumeAccessToken.mockResolvedValueOnce({ ...ACTIVE_LICENSE, status: "revoked" });
    const revoked = await GET(activateRequest("revoked-token"));
    expect(revoked.headers.get("location")).toContain("acesso=invalido");

    licensingMocks.consumeAccessToken.mockResolvedValueOnce({
      ...ACTIVE_LICENSE,
      expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await GET(activateRequest("expired-token"));
    expect(expired.headers.get("location")).toContain("acesso=invalido");
  });

  it("fails closed without token, without secret or on repository errors", async () => {
    const missingToken = await GET(activateRequest(null));
    expect(missingToken.headers.get("location")).toContain("acesso=invalido");
    expect(licensingMocks.consumeAccessToken).not.toHaveBeenCalled();

    delete process.env.ACCESS_COOKIE_SECRET;
    const missingSecret = await GET(activateRequest("valid-token"));
    expect(missingSecret.headers.get("location")).toContain("acesso=invalido");

    process.env.ACCESS_COOKIE_SECRET = SECRET;
    licensingMocks.consumeAccessToken.mockRejectedValueOnce(new Error("db down"));
    const failed = await GET(activateRequest("valid-token"));
    expect(failed.headers.get("location")).toContain("acesso=invalido");
  });
});
