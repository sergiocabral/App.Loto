import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RawDownloadLink } from "./RawDownloadLink";

afterEach(() => {
  delete window.umami;
});

describe("RawDownloadLink", () => {
  it("keeps the native download and tracks typed metadata without cancelling the click", () => {
    const track = vi.fn();
    window.umami = { track };
    render(
      <RawDownloadLink
        downloadName="luckygames-resultados-Quina.txt"
        hasDrawNumber={false}
        href="/api/lotteries/Quina?format=legacy"
        lottery="Quina"
        totalDraws={42}
      />,
    );

    const link = screen.getByRole("link", { name: "Download" });
    expect(link).toHaveAttribute("download", "luckygames-resultados-Quina.txt");
    expect(link).toHaveAttribute("href", "/api/lotteries/Quina?format=legacy");
    expect(link).not.toHaveAttribute("data-umami-event");

    let cancelledByApp: boolean | null = null;
    document.addEventListener(
      "click",
      (event) => {
        cancelledByApp = event.defaultPrevented;
        // Só evita a navegação do jsdom depois de registrar se o app cancelou o clique.
        event.preventDefault();
      },
      { once: true },
    );

    fireEvent.click(link);

    expect(track).toHaveBeenCalledWith("Download resultados", { hasDrawNumber: false, lottery: "Quina", totalDraws: 42 });
    expect(cancelledByApp).toBe(false);
  });
});
