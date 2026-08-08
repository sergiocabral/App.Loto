import { beforeEach, describe, expect, it, vi } from "vitest";

const licensingMocks = vi.hoisted(() => ({
  getActiveLicenseByEmail: vi.fn(),
  issueAccessToken: vi.fn(),
}));

const mailerMocks = vi.hoisted(() => ({
  sendAccessLinkEmail: vi.fn(),
}));

vi.mock("@/lib/server/licensing", () => licensingMocks);
vi.mock("@/lib/server/mailer", () => mailerMocks);

import { POST } from "@/app/api/access/request-link/route";
import { resetSecurityRateLimitsForTests } from "@/lib/server/security";

function linkRequest(body: unknown, ip = "203.0.113.50"): Request {
  return new Request("https://luckygames.tips/api/access/request-link", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-real-ip": ip },
    method: "POST",
  });
}

describe("POST /api/access/request-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSecurityRateLimitsForTests();
    licensingMocks.getActiveLicenseByEmail.mockResolvedValue({
      email: "user@example.com",
      id: 7,
      plan: "pass30",
      status: "active",
    });
    licensingMocks.issueAccessToken.mockResolvedValue("raw-login-token");
    mailerMocks.sendAccessLinkEmail.mockResolvedValue(true);
  });

  it("sends a login link when the e-mail has an active license", async () => {
    const response = await POST(linkRequest({ email: "User@Example.com" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(licensingMocks.getActiveLicenseByEmail).toHaveBeenCalledWith("user@example.com");
    expect(licensingMocks.issueAccessToken).toHaveBeenCalledWith(7, "login");
    expect(mailerMocks.sendAccessLinkEmail).toHaveBeenCalledWith({
      kind: "login",
      plan: "pass30",
      to: "user@example.com",
      token: "raw-login-token",
    });
  });

  it("returns the same generic response when there is no active license or the lookup fails", async () => {
    licensingMocks.getActiveLicenseByEmail.mockResolvedValueOnce(null);
    const noLicense = await POST(linkRequest({ email: "user@example.com" }, "203.0.113.51"));
    expect(noLicense.status).toBe(200);
    await expect(noLicense.json()).resolves.toMatchObject({ ok: true });
    expect(mailerMocks.sendAccessLinkEmail).not.toHaveBeenCalled();

    licensingMocks.getActiveLicenseByEmail.mockRejectedValueOnce(new Error("db down"));
    const failed = await POST(linkRequest({ email: "user@example.com" }, "203.0.113.52"));
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects invalid e-mails and malformed bodies", async () => {
    const invalid = await POST(linkRequest({ email: "nope" }));
    expect(invalid.status).toBe(400);

    const wrongType = await POST(
      new Request("https://luckygames.tips/api/access/request-link", {
        body: "email=user",
        headers: { "content-type": "text/plain", "x-real-ip": "203.0.113.53" },
        method: "POST",
      }),
    );
    expect(wrongType.status).toBe(415);
  });

  it("limits repeated requests per e-mail with a generic response", async () => {
    for (let index = 0; index < 3; index += 1) {
      await POST(linkRequest({ email: "user@example.com" }, `203.0.113.${60 + index}`));
    }
    expect(licensingMocks.getActiveLicenseByEmail).toHaveBeenCalledTimes(3);

    const limited = await POST(linkRequest({ email: "user@example.com" }, "203.0.113.70"));
    expect(limited.status).toBe(200);
    await expect(limited.json()).resolves.toMatchObject({ ok: true });
    expect(licensingMocks.getActiveLicenseByEmail).toHaveBeenCalledTimes(3);
  });

  it("limits repeated requests per client IP with 429", async () => {
    for (let index = 0; index < 10; index += 1) {
      const response = await POST(linkRequest({ email: `user${index}@example.com` }, "203.0.113.99"));
      expect(response.status).toBe(200);
    }

    const limited = await POST(linkRequest({ email: "user-final@example.com" }, "203.0.113.99"));
    expect(limited.status).toBe(429);
  });
});
