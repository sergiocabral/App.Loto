import type { Metadata } from "next";
import { AccessOriginTracker } from "@/components/AccessOriginTracker";
import { UmamiSession } from "@/components/UmamiSession";
import { getOfficialSiteUrl } from "@/lib/siteUrl";
import { getUmamiBootstrapScript, UMAMI_BEFORE_SEND_HANDLER } from "@/lib/umamiBootstrap";
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

const umamiScriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim();
const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim();
// Só rastreia no domínio oficial: evita que dev/localhost com o .env de produção polua o Umami.
const umamiDomains = [officialSiteUrl.hostname, `www.${officialSiteUrl.hostname}`].join(",");
// Replay e heatmap (recorder.js) ficam ligados por padrão; "false" desliga sem afetar os eventos.
const isUmamiRecorderEnabled = process.env.NEXT_PUBLIC_UMAMI_RECORDER_ENABLED?.trim().toLowerCase() !== "false";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        {umamiScriptUrl && umamiWebsiteId ? (
          <>
            {/*
              Scripts no <head> do HTML do servidor (e não via next/script): scripts `defer` executam na ordem do
              documento, então este tracker roda antes do script do website global que o proxy injeta no fim do
              <body> e fica com o `window.umami` — requisito para eventos, identify e replay caírem neste website.
            */}
            <script dangerouslySetInnerHTML={{ __html: getUmamiBootstrapScript() }} id="umami-bootstrap" />
            <script
              data-before-send={UMAMI_BEFORE_SEND_HANDLER}
              data-domains={umamiDomains}
              data-performance="true"
              data-website-id={umamiWebsiteId}
              defer
              id="umami-tracker"
              src={umamiScriptUrl}
            />
          </>
        ) : null}
      </head>
      <body>
        {children}
        <AccessOriginTracker />
        {umamiScriptUrl && umamiWebsiteId ? (
          <UmamiSession recorderEnabled={isUmamiRecorderEnabled} scriptUrl={umamiScriptUrl} websiteId={umamiWebsiteId} />
        ) : null}
      </body>
    </html>
  );
}
