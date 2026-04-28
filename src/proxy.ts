import { NextResponse, type NextRequest } from "next/server";
import { getOfficialSiteUrl, isLocalHostname, normalizeHostname } from "@/lib/siteUrl";

export function proxy(request: NextRequest) {
  const officialUrl = getOfficialSiteUrl();
  const officialHostname = normalizeHostname(officialUrl.hostname);
  const requestHostname = normalizeHostname(request.nextUrl.hostname);

  if (isLocalHostname(request.nextUrl.hostname) || requestHostname === officialHostname) {
    return NextResponse.next();
  }

  const redirectUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, officialUrl);
  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|site-icon.svg|site-card.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)).*)"],
};
