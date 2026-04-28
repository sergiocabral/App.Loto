import { describe, expect, it } from "vitest";
import { getCanonicalRedirectUrl, getOfficialDomainName, getOfficialSiteUrl } from "@/lib/siteUrl";

describe("site URL helpers", () => {
  it("accepts only canonical domain names without protocol, port or path", () => {
    expect(getOfficialDomainName(" Luckygames.Tips. ")).toBe("luckygames.tips");
    expect(getOfficialDomainName("www.luckygames.tips")).toBe("www.luckygames.tips");
    expect(getOfficialDomainName("")).toBeNull();
    expect(getOfficialDomainName("https://luckygames.tips/")).toBeNull();
    expect(getOfficialDomainName("luckygames.tips/")).toBeNull();
    expect(getOfficialDomainName("luckygames.tips:443")).toBeNull();
    expect(getOfficialDomainName("localhost")).toBeNull();
  });

  it("builds metadata URLs from a domain name and falls back for invalid values", () => {
    expect(getOfficialSiteUrl("luckygames.tips").href).toBe("https://luckygames.tips/");
    expect(getOfficialSiteUrl("https://invalid.example/").href).toBe("https://luckygames.tips/");
  });

  it("does not redirect when the official domain is empty, invalid, local or already matched", () => {
    expect(getCanonicalRedirectUrl(new URL("https://sorteios.sergiocabral.com/raw/MegaSena"), null)).toBeNull();
    expect(getCanonicalRedirectUrl(new URL("https://sorteios.sergiocabral.com/raw/MegaSena"), "https://luckygames.tips/")).toBeNull();
    expect(getCanonicalRedirectUrl(new URL("https://luckygames.tips/raw/MegaSena"), "luckygames.tips")).toBeNull();
    expect(getCanonicalRedirectUrl(new URL("http://localhost:3000/raw/MegaSena"), "luckygames.tips")).toBeNull();
  });

  it("redirects alternate domains to the official HTTPS domain preserving path, query and hash", () => {
    const redirectUrl = getCanonicalRedirectUrl(
      new URL("https://sorteios.sergiocabral.com/raw/MegaSena?MegaSena#resultado"),
      "luckygames.tips",
    );

    expect(redirectUrl?.href).toBe("https://luckygames.tips/raw/MegaSena?MegaSena#resultado");
  });

  it("redirects www to the apex domain when the apex is official", () => {
    const redirectUrl = getCanonicalRedirectUrl(new URL("https://www.luckygames.tips/"), "luckygames.tips");

    expect(redirectUrl?.href).toBe("https://luckygames.tips/");
  });
});
