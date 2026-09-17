import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@/app/layout";

async function renderLayoutWithEnv(env: Record<string, string>): Promise<string> {
  vi.resetModules();

  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }

  const { default: RootLayout } = await import("@/app/layout");

  return renderToStaticMarkup(
    <RootLayout>
      <main>conteúdo</main>
    </RootLayout>,
  );
}

describe("root layout metadata", () => {
  it("publishes the canonical site metadata contract", () => {
    const metadataBase = metadata.metadataBase instanceof URL ? metadata.metadataBase.href : metadata.metadataBase;

    expect(metadataBase).toBe("https://luckygames.tips/");
    expect(metadata.alternates?.canonical).toBe("/");
    expect(metadata.openGraph).toMatchObject({ locale: "pt_BR", siteName: "Luckygames.tips", type: "website", url: "/" });
  });
});

describe("root layout Umami scripts", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("renders the bootstrap and the tracker in the head, before any body content", async () => {
    const html = await renderLayoutWithEnv({
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: "https://umami.example.com/script.js",
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: "11111111-1111-4111-8111-111111111111",
      OFFICIAL_DOMAIN_NAME: "luckygames.tips",
    });
    const headHtml = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));

    expect(headHtml.indexOf('id="umami-bootstrap"')).toBeGreaterThan(-1);
    expect(headHtml.indexOf('id="umami-bootstrap"')).toBeLessThan(headHtml.indexOf('id="umami-tracker"'));
    expect(headHtml).toContain('src="https://umami.example.com/script.js"');
    expect(headHtml).toContain('data-website-id="11111111-1111-4111-8111-111111111111"');
    expect(headHtml).toContain('data-before-send="luckygamesUmamiBeforeSend"');
    expect(headHtml).toContain('data-domains="luckygames.tips,www.luckygames.tips"');
    expect(headHtml).toContain('data-performance="true"');
    expect(headHtml).toMatch(/<script[^>]*defer=""[^>]*id="umami-tracker"/);
  });

  it("does not render Umami scripts without the analytics configuration", async () => {
    const html = await renderLayoutWithEnv({
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: "",
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: "",
    });

    expect(html).not.toContain("umami");
    expect(html).toContain("<main>conteúdo</main>");
  });
});
