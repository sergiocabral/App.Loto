import { Client } from "pg";
import { describe, expect, inject, it } from "vitest";

describe("postgres test harness", () => {
  it("provides a disposable PostgreSQL database", async () => {
    const client = new Client({ connectionString: inject("postgresUrl") });

    await client.connect();
    try {
      const result = await client.query<{ ready: number }>("SELECT 1 AS ready");
      expect(result.rows).toEqual([{ ready: 1 }]);
    } finally {
      await client.end();
    }
  });
});
