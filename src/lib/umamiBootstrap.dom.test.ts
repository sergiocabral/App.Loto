import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUmamiBootstrapScript, installUmamiBootstrap, UMAMI_BEFORE_SEND_HANDLER } from "./umamiBootstrap";

type BeforeSend = (type: string, payload: Record<string, unknown>) => Record<string, unknown> | false;

function getBeforeSend(target: object = window): BeforeSend {
  return (target as Record<string, unknown>)[UMAMI_BEFORE_SEND_HANDLER] as BeforeSend;
}

function runSerializedBootstrap(): void {
  // Executa exatamente a string que vai inline no <head>.
  new Function("window", getUmamiBootstrapScript())(window);
}

describe("Umami bootstrap", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[UMAMI_BEFORE_SEND_HANDLER];
    window.localStorage.clear();
  });

  it("turns tracking off and on through the analytics query param, keeping the other raw params", () => {
    window.history.replaceState({ keep: true }, "", "/?Megasena&analytics=off&draw=10#top");
    runSerializedBootstrap();

    expect(window.localStorage.getItem("umami.disabled")).toBe("1");
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/?Megasena&draw=10#top");
    expect(window.history.state).toEqual({ keep: true });

    window.history.replaceState({}, "", "/raw/Quina?analytics=ON");
    runSerializedBootstrap();

    expect(window.localStorage.getItem("umami.disabled")).toBeNull();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/raw/Quina");
  });

  it("only strips unknown analytics values without changing the stored preference", () => {
    window.localStorage.setItem("umami.disabled", "1");
    window.history.replaceState({}, "", "/?analytics&x=1");
    runSerializedBootstrap();

    expect(window.localStorage.getItem("umami.disabled")).toBe("1");
    expect(window.location.search).toBe("?x=1");
  });

  it("leaves the URL untouched when there is no analytics param", () => {
    window.history.replaceState({}, "", "/?Megasena&origin=qr%20code");
    runSerializedBootstrap();

    expect(window.location.search).toBe("?Megasena&origin=qr%20code");
    expect(window.localStorage.getItem("umami.disabled")).toBeNull();
  });

  it("normalizes nested URLs produced by the customized Umami script", () => {
    runSerializedBootstrap();
    const beforeSend = getBeforeSend();

    expect(
      beforeSend("event", {
        name: "Evento",
        referrer: "https://luckygames.tips/https://luckygames.tips/",
        url: "https://luckygames.tips/https://luckygames.tips/raw/LotoFacil?draw=1#fim",
      }),
    ).toEqual({
      name: "Evento",
      referrer: "https://luckygames.tips/",
      url: "https://luckygames.tips/raw/LotoFacil?draw=1#fim",
    });
    expect(beforeSend("event", { referrer: "", url: "https://luckygames.tips/raw/Quina" })).toEqual({
      referrer: "",
      url: "https://luckygames.tips/raw/Quina",
    });
    expect(beforeSend("identify", { data: { accessPlan: "free" } })).toEqual({ data: { accessPlan: "free" } });
  });

  it("disables tracking and cancels sends when rendered inside an iframe", () => {
    const storage = new Map<string, string>();
    const fakeWindow = {
      history: window.history,
      localStorage: {
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      location: window.location,
      self: {},
      top: {},
    };

    installUmamiBootstrap(fakeWindow as unknown as Window);

    expect(storage.get("umami.disabled")).toBe("1");
    expect(getBeforeSend(fakeWindow)("event", { url: "https://luckygames.tips/" })).toBe(false);
  });

  it("never throws when the frame or the storage cannot be accessed", () => {
    const fakeWindow = {
      history: window.history,
      get localStorage(): Storage {
        throw new Error("blocked");
      },
      location: window.location,
      self: window,
      get top(): Window {
        throw new Error("cross-origin");
      },
    };

    expect(() => installUmamiBootstrap(fakeWindow as unknown as Window)).not.toThrow();
    expect(getBeforeSend(fakeWindow)("event", { url: "https://luckygames.tips/" })).toBe(false);
  });
});
