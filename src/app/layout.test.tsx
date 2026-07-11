import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";

describe("root layout metadata", () => {
  it("publishes the canonical site metadata contract", () => {
    const metadataBase = metadata.metadataBase instanceof URL ? metadata.metadataBase.href : metadata.metadataBase;

    expect(metadataBase).toBe("https://luckygames.tips/");
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph).toMatchObject({ locale: "pt_BR", siteName: "Luckygames.tips", type: "website", url: "/" });
  });
});
