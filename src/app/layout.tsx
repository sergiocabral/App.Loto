import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

const siteUrl = "https://luckygames.tips";
const socialImageUrl = "https://raw.githubusercontent.com/sergiocabral/App.GoHorse/refs/heads/main/gohorse.png";
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
  openGraph: {
    title: socialTitle,
    description: socialDescription,
    url: siteUrl,
    siteName: "Luckygames.tips",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: socialImageUrl,
        width: 1024,
        height: 1024,
        type: "image/png",
        alt: "Luckygames.tips: uma forma simples e rápida de acompanhar resultados e análises das loterias.",
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
