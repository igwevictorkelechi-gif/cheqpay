import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSetting, invalidateSetting } from "./settingsCache";

beforeEach(() => {
  process.env.SETTINGS_CACHE_TTL_MS = "15000";
  invalidateSetting();
});
afterEach(() => {
  delete process.env.SETTINGS_CACHE_TTL_MS;
  vi.useRealTimers();
});

describe("settings cache", () => {
  it("reads the database once per window", async () => {
    const load = vi.fn(async () => ({ on: true }));
    for (let i = 0; i < 50; i++) await cachedSetting("flags", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-reads after the window and after a save", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const load = vi.fn(async () => 1);
    await cachedSetting("k", load);
    vi.setSystemTime(Date.now() + 16_000);
    await cachedSetting("k", load);
    invalidateSetting("k");
    await cachedSetting("k", load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("is off when the window is 0", async () => {
    process.env.SETTINGS_CACHE_TTL_MS = "0";
    const load = vi.fn(async () => 1);
    await cachedSetting("k", load);
    await cachedSetting("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
