import type { Metadata } from "next";
import Script from "next/script";
import { AccessOriginTracker } from "@/components/AccessOriginTracker";
import { getOfficialSiteUrl } from "@/lib/siteUrl";
import "./globals.css";

const officialSiteUrl = getOfficialSiteUrl();
const siteUrl = officialSiteUrl.origin;
const socialImageUrl = "/gohorse.png";
const iconUrl = "/gohorse.png";
const socialTitle = "Luckygames.tips | Resultados e palpites para loterias";
const socialDescription =
  "Confira resultados das Loterias da Caixa, veja análises rápidas e escolha seus próximos números com mais praticidade.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Luckygames.tips",
  title: socialTitle,
  description: socialDescription,
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: iconUrl, type: "image/png" }],
    shortcut: [{ url: iconUrl, type: "image/png" }],
    apple: [{ url: iconUrl, type: "image/png" }],
  },
  openGraph: {
    title: socialTitle,
    description: socialDescription,
    url: "/",
    siteName: "Luckygames.tips",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: socialImageUrl,
        width: 1024,
        height: 1024,
        type: "image/png",
        alt: "Ícone circular amarelo e preto da Luckygames.tips.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: socialTitle,
    description: socialDescription,
    images: [socialImageUrl],
  },
};

const umamiScriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <AccessOriginTracker />
        {umamiScriptUrl && umamiWebsiteId ? (
          <Script
            defer
            src={umamiScriptUrl}
            data-website-id={umamiWebsiteId}
            strategy="afterInteractive"
          />
        ) : null}
      </body>
    </html>
  );
}
