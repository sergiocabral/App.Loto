import { describe, expect, it, vi } from "vitest";
import { createWorker } from "@/lib/workerRuntime";

describe("Cloudflare worker adapter", () => {
  it("renders an escaped canonical redirect without reflecting executable markup", async () => {
    const passthrough = vi.fn();
    const worker = createWorker({ fetch: vi.fn() });
    const response = await worker.fetch(
      new Request("https://alternate.example/path?next=%3Cscript%3Ealert(1)%3C/script%3E"),
      { OFFICIAL_DOMAIN_NAME: "luckygames.tips" },
      { passThroughOnException: passthrough, waitUntil: vi.fn() },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("%3Cscript%3Ealert(1)%3C/script%3E");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("window.location.replace(\"https://luckygames.tips/path?next=%3Cscript%3Ealert(1)%3C/script%3E\")");
  });

  it("passes requests through unchanged when no canonical redirect applies", async () => {
    const expected = new Response("ok", { status: 201 });
    const fetch = vi.fn().mockResolvedValue(expected);
    const request = new Request("https://luckygames.tips/api/lotteries");
    const environment = { OFFICIAL_DOMAIN_NAME: "luckygames.tips" };
    const context = { passThroughOnException: vi.fn(), waitUntil: vi.fn() };

    const response = await createWorker({ fetch }).fetch(request, environment, context);

    expect(response).toBe(expected);
    expect(fetch).toHaveBeenCalledWith(request, environment, context);
  });
});
