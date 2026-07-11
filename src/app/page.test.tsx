import { afterEach, describe, expect, it, vi } from "vitest";

const componentMocks = vi.hoisted(() => ({
  AppShell: vi.fn(({ children }) => children),
  HomePage: vi.fn(() => null),
}));
const environmentMocks = vi.hoisted(() => ({ isOpenAIChatConfigured: vi.fn<() => boolean>() }));

vi.mock("@/components/AppShell", () => ({ AppShell: componentMocks.AppShell }));
vi.mock("@/components/HomePage", () => ({ HomePage: componentMocks.HomePage }));
vi.mock("@/lib/server/env", () => environmentMocks);

describe("home page request contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("passes the first legacy lottery and draw query while ignoring origin tracking", async () => {
    environmentMocks.isOpenAIChatConfigured.mockReturnValue(true);
    const { default: Home } = await import("@/app/page");

    const element = await Home({ searchParams: Promise.resolve({ origin: "campaign", MegaSena: "1234" }) });
    const homePageProps = (element.props.children as { props: Record<string, unknown> }).props;

    expect(homePageProps).toMatchObject({ initialDrawNumber: "1234", initialLotterySlug: "MegaSena", isChatEnabled: true });
  });

  it("does not infer a lottery when only the tracking origin is present", async () => {
    environmentMocks.isOpenAIChatConfigured.mockReturnValue(false);
    const { default: Home } = await import("@/app/page");

    const element = await Home({ searchParams: Promise.resolve({ origin: "campaign" }) });
    const homePageProps = (element.props.children as { props: Record<string, unknown> }).props;

    expect(homePageProps).toMatchObject({ initialDrawNumber: undefined, initialLotterySlug: undefined, isChatEnabled: false });
  });
});
