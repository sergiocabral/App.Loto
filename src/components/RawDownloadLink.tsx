"use client";

import { ANALYTICS_EVENTS, trackEvent } from "@/lib/analytics";

type RawDownloadLinkProps = {
  downloadName: string;
  hasDrawNumber: boolean;
  href: string;
  lottery: string;
  totalDraws: number;
};

/**
 * Link de download rastreado por onClick. O `data-umami-event` antigo fazia os scripts do Umami
 * cancelarem o clique e navegarem via `location.href`, perdendo o atributo `download`.
 */
export function RawDownloadLink({ downloadName, hasDrawNumber, href, lottery, totalDraws }: RawDownloadLinkProps) {
  return (
    <a
      className="raw-page-link raw-page-link-download"
      download={downloadName}
      href={href}
      onClick={() => trackEvent(ANALYTICS_EVENTS.downloadResults, { hasDrawNumber, lottery, totalDraws })}
    >
      Download
    </a>
  );
}
