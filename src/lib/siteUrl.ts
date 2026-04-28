export const DEFAULT_OFFICIAL_DOMAIN_NAME = "luckygames.tips";

const DOMAIN_NAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeHostname(hostname: string): string {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

export function isLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1" || normalized === "[::1]";
}

export function getOfficialDomainName(value = process.env.OFFICIAL_DOMAIN_NAME): string | null {
  const rawValue = value?.trim();

  if (!rawValue) {
    return null;
  }

  const domainName = normalizeHostname(rawValue);

  if (domainName.includes("://") || domainName.includes("/") || domainName.includes(":") || domainName.includes("@")) {
    return null;
  }

  if (isLocalHostname(domainName) || !DOMAIN_NAME_PATTERN.test(domainName)) {
    return null;
  }

  return domainName;
}

export function getOfficialSiteUrl(value = process.env.OFFICIAL_DOMAIN_NAME): URL {
  const domainName = getOfficialDomainName(value) ?? DEFAULT_OFFICIAL_DOMAIN_NAME;

  return new URL(`https://${domainName}/`);
}

export function getCanonicalRedirectUrl(requestUrl: URL, value = process.env.OFFICIAL_DOMAIN_NAME): URL | null {
  const domainName = getOfficialDomainName(value);

  if (!domainName) {
    return null;
  }

  const currentHostname = normalizeHostname(requestUrl.hostname);

  if (isLocalHostname(currentHostname) || currentHostname === domainName) {
    return null;
  }

  const redirectUrl = new URL(requestUrl.pathname + requestUrl.search, `https://${domainName}`);
  redirectUrl.hash = requestUrl.hash;

  return redirectUrl;
}
