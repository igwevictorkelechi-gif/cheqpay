import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@cheqpay/db", () => ({
  prisma: { $queryRawUnsafe: h.query, $executeRawUnsafe: h.exec },
}));
vi.mock("./alerts", () => ({ notifyUser: h.notify }));

import { MAX_REMINDERS, reminderDue, reminderMessage, sendKycReminders } from "./kycReminders";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-27T09:45:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

beforeEach(() => {
  vi.clearAllMocks();
  h.exec.mockResolvedValue(0);
  h.notify.mockResolvedValue({ devices: 1, browsers: 0, email: true });
});

describe("reminderDue", () => {
  it("sends the first reminder a day after sign-up, not before", () => {
    expect(reminderDue(ago(0.5), 0, null, now)).toBe(false);
    expect(reminderDue(ago(1), 0, null, now)).toBe(true);
  });

  it("spaces later reminders from the previous one (day 1, 3, 7 for a new sign-up)", () => {
    expect(reminderDue(ago(3), 1, ago(1.5), now)).toBe(false);
    expect(reminderDue(ago(3), 1, ago(2), now)).toBe(true);
    expect(reminderDue(ago(7), 2, ago(3), now)).toBe(false);
    expect(reminderDue(ago(7), 2, ago(4), now)).toBe(true);
  });

  it("stops after the last reminder", () => {
    expect(reminderDue(ago(100), MAX_REMINDERS, ago(50), now)).toBe(false);
  });

  it("gives each reminder its own words", () => {
    const titles = new Set([0, 1, 2].map((n) => reminderMessage(n).title));
    expect(titles.size).toBe(3);
  });
});

describe("sendKycReminders", () => {
  it("reminds only people who are due, links to KYC, and records each send", async () => {
    h.query.mockResolvedValue([
      { id: "u-due", created_at: ago(2), sent_count: null, last_sent_at: null },
      { id: "u-wait", created_at: ago(3), sent_count: 1, last_sent_at: ago(1) },
    ]);
    const res = await sendKycReminders(now);
    expect(res).toEqual({ checked: 2, sent: 1, failed: 0 });
    expect(h.notify).toHaveBeenCalledTimes(1);
    const [userId, msg] = h.notify.mock.calls[0];
    expect(userId).toBe("u-due");
    expect(msg.category).toBe("updates");
    expect(msg.data.url).toBe("/kyc");
    expect(msg.action.url).toBe("https://mycheqpay.com/kyc");
    const upsert = h.exec.mock.calls.find((c) => String(c[0]).includes("INSERT INTO kyc_reminders"));
    expect(upsert?.[1]).toBe("u-due");
  });

  it("skips pending and rejected KYC and unverified-only accounts in the query", async () => {
    h.query.mockResolvedValue([]);
    await sendKycReminders(now);
    const sql = String(h.query.mock.calls[0][0]);
    expect(sql).toContain("u.kyc_tier = 0");
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(sql).toContain("'PENDING', 'REJECTED'");
  });

  it("keeps going when one send fails, and doesn't count it", async () => {
    h.query.mockResolvedValue([
      { id: "a", created_at: ago(5), sent_count: 0, last_sent_at: null },
      { id: "b", created_at: ago(5), sent_count: 0, last_sent_at: null },
    ]);
    h.notify.mockRejectedValueOnce(new Error("boom"));
    const res = await sendKycReminders(now);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(1);
  });

  it("respects the batch limit", async () => {
    h.query.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, created_at: ago(5), sent_count: 0, last_sent_at: null }))
    );
    const res = await sendKycReminders(now, 4);
    expect(res.sent).toBe(4);
  });
});
