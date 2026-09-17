import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundTracker } from "./NotFoundTracker";

afterEach(() => {
  delete window.umami;
  window.history.replaceState({}, "", "/");
});

describe("NotFoundTracker", () => {
  it("tracks the missing path once Umami becomes available", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/pagina-que-nao-existe");
    render(<NotFoundTracker kind="page" />);

    const track = vi.fn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    window.umami = { track };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Página não encontrada", { kind: "page", path: "/pagina-que-nao-existe" });
  });

  it("stops retrying after the timeout or when unmounted", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<NotFoundTracker kind="lottery" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    const track = vi.fn();
    window.umami = { track };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(track).not.toHaveBeenCalled();

    delete window.umami;
    const second = render(<NotFoundTracker kind="lottery" />);
    second.unmount();
    unmount();
    window.umami = { track };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(track).not.toHaveBeenCalled();
  });
});
