import { afterEach, describe, expect, it, vi } from "vitest";

const env: Record<string, string | undefined> = {};
vi.mock("./env", () => ({ getEnv: () => env }));

import { schedulerRefusal } from "./cronAuth";

const req = (auth?: string) => new Request("https://x/api/cron/auto-cashout", { headers: auth ? { authorization: auth } : {} });
const S = "s".repeat(40);

afterEach(() => {
  for (const k of Object.keys(env)) delete env[k];
});

describe("schedulerRefusal", () => {
  it("lets the database scheduler in with its own secret", () => {
    env.CRON_SECRET = "c".repeat(20);
    env.DB_CRON_SECRET = S;
    expect(schedulerRefusal(req(`Bearer ${S}`))).toBeNull();
  });
  it("still accepts CRON_SECRET and the older social secret", () => {
    env.CRON_SECRET = "c".repeat(20);
    env.SOCIAL_CRON_SECRET = "o".repeat(40);
    expect(schedulerRefusal(req(`Bearer ${"c".repeat(20)}`))).toBeNull();
    expect(schedulerRefusal(req(`Bearer ${"o".repeat(40)}`))).toBeNull();
  });
  it("refuses anything else", () => {
    env.CRON_SECRET = "c".repeat(20);
    env.DB_CRON_SECRET = S;
    expect(schedulerRefusal(req("Bearer nope"))?.status).toBe(401);
    expect(schedulerRefusal(req())?.status).toBe(401);
  });
});
