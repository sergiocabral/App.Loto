import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessStatusResult } from "@/lib/client/accessStatus";
import { UMAMI_RECORDER_SCRIPT_ID, UmamiSession } from "./UmamiSession";

const { loadInitialAccessStatus } = vi.hoisted(() => ({ loadInitialAccessStatus: vi.fn() }));

vi.mock("@/lib/client/accessStatus", () => ({ loadInitialAccessStatus }));

const WEBSITE_ID = "11111111-1111-4111-8111-111111111111";
const SCRIPT_URL = "https://umami.example.com/script.js";

const PLANS = { lifetime: { priceBRL: 50 }, pass30: { priceBRL: 10 } };

function statusResult(overrides: Partial<AccessStatusResult["status"]> = {}, known = true): AccessStatusResult {
  return {
    known,
    status: { chat: { limit: 3, used: 0 }, licensed: false, plans: PLANS, ...overrides },
  };
}

function installUmami(initialCache?: string, website = WEBSITE_ID) {
  const session: { cache?: string; website: string } = { cache: initialCache, website };
  const identify = vi.fn(async () => {
    // Igual ao script real: o token some até a resposta do identify chegar.
    session.cache = "";
    expect(document.getElementById(UMAMI_RECORDER_SCRIPT_ID)).toBeNull();
    await Promise.resolve();
    session.cache = "token-after-identify";
  });

  window.umami = { getSession: () => ({ ...session }), identify, track: vi.fn() };

  return { identify, session };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function getRecorderScript(): HTMLScriptElement | null {
  return document.getElementById(UMAMI_RECORDER_SCRIPT_ID) as HTMLScriptElement | null;
}

describe("UmamiSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_UMAMI_WEBSITE_ID", WEBSITE_ID);
    loadInitialAccessStatus.mockReset();
    loadInitialAccessStatus.mockResolvedValue(statusResult());
  });

  afterEach(() => {
    getRecorderScript()?.remove();
    delete window.umami;
    window.localStorage.clear();
  });

  it("waits for our session token, identifies the access plan and only then loads the recorder", async () => {
    const { identify, session } = installUmami();
    loadInitialAccessStatus.mockResolvedValue(statusResult({ licensed: true, plan: "lifetime" }));

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(1000);

    expect(loadInitialAccessStatus).not.toHaveBeenCalled();
    expect(getRecorderScript()).toBeNull();

    session.cache = "token-1";
    await advance(300);

    expect(identify).toHaveBeenCalledWith({ accessPlan: "lifetime" });

    const script = getRecorderScript();
    expect(script).not.toBeNull();
    expect(script?.src).toBe("https://umami.example.com/recorder.js");
    expect(script?.dataset.websiteId).toBe(WEBSITE_ID);
    expect(script?.parentElement).toBe(document.head);
  });

  it("marks anonymous sessions as free", async () => {
    const { identify } = installUmami("token-1");

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(0);

    expect(identify).toHaveBeenCalledWith({ accessPlan: "free" });
    expect(getRecorderScript()).not.toBeNull();
  });

  it("skips identify when the access status is unknown but still records", async () => {
    const { identify } = installUmami("token-1");
    loadInitialAccessStatus.mockResolvedValue(statusResult({}, false));

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(0);

    expect(identify).not.toHaveBeenCalled();
    expect(getRecorderScript()).not.toBeNull();
  });

  it("identifies the session without loading the recorder when it is disabled", async () => {
    const { identify } = installUmami("token-1");

    render(<UmamiSession recorderEnabled={false} scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(1000);

    expect(identify).toHaveBeenCalledTimes(1);
    expect(getRecorderScript()).toBeNull();
  });

  it("does nothing while tracking is disabled for this browser", async () => {
    installUmami("token-1");
    window.localStorage.setItem("umami.disabled", "1");

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(1000);

    expect(loadInitialAccessStatus).not.toHaveBeenCalled();
    expect(getRecorderScript()).toBeNull();
  });

  it("does nothing inside an iframe", async () => {
    installUmami("token-1");
    const topSpy = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(1000);

    expect(loadInitialAccessStatus).not.toHaveBeenCalled();
    expect(getRecorderScript()).toBeNull();
    topSpy.mockRestore();
  });

  it("gives up when only another website's tracker owns window.umami", async () => {
    installUmami("token-global", "22222222-2222-4222-8222-222222222222");

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(25_000);

    expect(loadInitialAccessStatus).not.toHaveBeenCalled();
    expect(getRecorderScript()).toBeNull();
  });

  it("stops when unmounted before the session is ready", async () => {
    const { session } = installUmami();
    const { unmount } = render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);

    unmount();
    session.cache = "token-1";
    await advance(1000);

    expect(loadInitialAccessStatus).not.toHaveBeenCalled();
    expect(getRecorderScript()).toBeNull();
  });

  it("does not inject the recorder twice nor with an invalid script URL", async () => {
    installUmami("token-1");
    const existing = document.createElement("script");
    existing.id = UMAMI_RECORDER_SCRIPT_ID;
    document.head.appendChild(existing);

    render(<UmamiSession scriptUrl={SCRIPT_URL} websiteId={WEBSITE_ID} />);
    await advance(0);

    expect(document.querySelectorAll(`#${UMAMI_RECORDER_SCRIPT_ID}`)).toHaveLength(1);
    existing.remove();

    render(<UmamiSession scriptUrl="http://[invalid" websiteId={WEBSITE_ID} />);
    await advance(0);

    expect(getRecorderScript()).toBeNull();
  });
});
