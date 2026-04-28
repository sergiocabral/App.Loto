export const DEFAULT_OFFICIAL_SITE_URL = "https://luckygames.tips/";

function ensureProtocol(value: string): string {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function getOfficialSiteUrl(value = process.env.OFFICIAL_SITE_URL): URL {
  const rawValue = value?.trim() || DEFAULT_OFFICIAL_SITE_URL;

  try {
    const url = new URL(ensureProtocol(rawValue));
    url.hash = "";
    url.search = "";

    if (!url.pathname) {
      url.pathname = "/";
    }

    return url;
  } catch {
    return new URL(DEFAULT_OFFICIAL_SITE_URL);
  }
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
}
