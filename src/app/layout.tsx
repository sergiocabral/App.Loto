import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loterias da Caixa",
  description: "Resultados das Loterias da Caixa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
