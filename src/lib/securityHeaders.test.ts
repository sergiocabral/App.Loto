import { describe, expect, it } from "vitest";
import { buildSecurityHeaders, getFrameAncestorSources } from "./securityHeaders";

describe("security headers", () => {
  it("allows the Umami dashboard to frame the site for heatmaps instead of denying every frame", () => {
    const headers = buildSecurityHeaders("https://umami.example.com/script.js");

    expect(headers).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://umami.example.com" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ]),
    );
    expect(headers.some((header) => header.key === "X-Frame-Options")).toBe(false);
  });

  it("falls back to same-origin framing without a valid http(s) Umami URL", () => {
    expect(getFrameAncestorSources()).toEqual(["'self'"]);
    expect(getFrameAncestorSources("   ")).toEqual(["'self'"]);
    expect(getFrameAncestorSources("not a url")).toEqual(["'self'"]);
    expect(getFrameAncestorSources("javascript:alert(1)")).toEqual(["'self'"]);
  });
});
