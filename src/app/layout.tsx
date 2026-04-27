import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luckygames | Resultados das Loterias da Caixa",
  description: "Consulte resultados das Loterias da Caixa de forma simples e rápida.",
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
