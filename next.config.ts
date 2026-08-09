import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  // Gera .next/standalone (server.js + apenas as dependências realmente usadas),
  // usado pela imagem Docker de produção para um container muito menor.
  output: "standalone",
  allowedDevOrigins: [
    "luckygames.tips",
    "www.luckygames.tips",
    "dev.luckygames.tips",
  ],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pg-cloudflare/dist/index.js"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

// Só inicializa o adapter Cloudflare em desenvolvimento (next dev). No build de
// produção (Node/standalone) isso tentaria spawnar o workerd, que não roda em Alpine (musl).
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
