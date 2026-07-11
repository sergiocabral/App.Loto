import { describe, expect, it } from "vitest";
import { LOTTERIES } from "@/data/lotteries";
import { GET } from "@/app/api/lotteries/route";

describe("lotteries route", () => {
  it("returns the public lottery catalogue as JSON", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ lotteries: LOTTERIES });
  });
});
