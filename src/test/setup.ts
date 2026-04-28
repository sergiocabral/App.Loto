import { afterAll, afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.restoreAllMocks();
});
