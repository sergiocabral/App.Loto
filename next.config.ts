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

const officialSiteUrl = (process.env.OFFICIAL_SITE_URL || "https://luckygames.tips/").replace(/\/+$/, "");
const redirectHostPattern = (() => {
  try {
    const officialHostname = new URL(officialSiteUrl).hostname.toLowerCase().replace(/\./g, "\\.");
    const localHostname = "(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])";

    return `((?!(?:${officialHostname}|${localHostname})(?::\\d+)?$).*)`;
  } catch {
    return "^$";
  }
})();

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pg-cloudflare/dist/index.js"],
  },
  async redirects() {
    return [
      {
        destination: `${officialSiteUrl}/:path*`,
        has: [
          {
            type: "host",
            value: redirectHostPattern,
          },
        ],
        permanent: true,
        source: "/:path*",
      },
    ];
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

initOpenNextCloudflareForDev();

export default nextConfig;
