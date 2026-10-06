import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  exec: vi.fn(),
  userFind: vi.fn(),
  balanceUpsert: vi.fn(),
  txCreate: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  webPush: vi.fn(),
  email: vi.fn(),
  emailOn: vi.fn(() => true),
  webhook: vi.fn(),
  env: { ADMIN_EMAILS: "Owner@CheqPay.com, ops@cheqpay.com,not-an-email" } as Record<string, string | undefined>,
}));

vi.mock("@cheqpay/db", () => {
  const db = {
    $queryRawUnsafe: h.query,
    $executeRawUnsafe: h.exec,
    user: { findUnique: h.userFind },
    balance: { upsert: h.balanceUpsert },
    transaction: { create: h.txCreate },
    auditLog: { create: h.audit },
  };
  return {
    prisma: { ...db, $transaction: (fn: (d: typeof db) => unknown) => fn(db) },
    Asset: { NGN: "NGN" },
    TransactionStatus: { COMPLETED: "COMPLETED" },
    TransactionType: { GIFTCARD_SELL: "GIFTCARD_SELL" },
  };
});
vi.mock("./alerts", () => ({ notifyUser: h.notify }));
vi.mock("./push", () => ({ sendPush: h.push }));
vi.mock("./webPush", () => ({ sendWebPush: h.webPush }));
vi.mock("./email", () => ({ sendEmail: h.email, isEmailConfigured: h.emailOn }));
vi.mock("./adminAlert", () => ({ notifyAdminAlert: h.webhook }));
vi.mock("./env", () => ({ getEnv: () => h.env }));
vi.mock("./pii", () => ({
  encryptPii: (s: string) => `enc(${s})`,
  decryptPii: (s: string) => s.replace(/^enc\((.*)\)$/, "$1"),
  fingerprintPii: (s: string) => `fp:${s}`,
  fingerprintMatches: (a: string, b: string) => a === b,
}));

import {
  alertAdminsNewGiftCard,
  approveTrade,
  getTradeAdmin,
  payoutMinor,
  rejectTrade,
  signGiftCardFileUrl,
  submitTrade,
  verifyGiftCardFileToken,
} from "./giftCards";

const RATE = {
  id: "11111111-1111-4111-8111-111111111111",
  brand_id: "b1",
  country: "US",
  card_type: "ECODE",
  currency: "USD",
  rate_minor: 125_000n, // ₦1,250 per $1
  min_value: 10,
  max_value: 500,
  active: true,
  brand_active: true,
  brand_name: "Amazon",
  updated_by: null,
  updated_at: new Date(),
};

function tradeRow(over: Record<string, unknown> = {}) {
  return {
    id: "t1", user_id: "u1", brand_name: "Amazon", country: "US", card_type: "ECODE", currency: "USD",
    face_value: 100, rate_minor: 125_000n, payout_minor: 12_500_000n, code_enc: "enc(ABCD-1234)", pin_enc: null,
    file_ids: ["f1"], note: null, status: "SUBMITTED", reject_reason: null, claimed_by: null, reviewed_by: null,
    reviewed_at: null, transaction_id: null, created_at: new Date(), updated_at: new Date(), ...over,
  };
}

/** Route each raw query to a canned answer by what it is asking. */
let answers: { replay: unknown[]; rate: unknown[]; today: number; owned: unknown[]; update: unknown[]; admin: unknown[] };
beforeEach(() => {
  vi.clearAllMocks();
  answers = { replay: [], rate: [RATE], today: 0, owned: [{ id: "f1" }], update: [tradeRow({ status: "APPROVED" })], admin: [] };
  h.query.mockImplementation(async (sql: string) => {
    if (sql.includes("count(*) AS n FROM gift_card_brands")) return [{ n: 5n }];
    if (sql.includes("WHERE idempotency_key")) return answers.replay;
    if (sql.includes("FROM gift_card_rates r JOIN")) return answers.rate;
    if (sql.includes("interval '24 hours'")) return [{ n: BigInt(answers.today) }];
    if (sql.includes("FROM gift_card_files WHERE id = ANY")) return answers.owned;
    if (sql.startsWith("INSERT INTO gift_card_trades") || sql.includes("INSERT INTO gift_card_trades")) return [tradeRow()];
    if (sql.includes("UPDATE gift_card_trades SET status")) return answers.update;
    if (sql.includes("FROM gift_card_trades t JOIN app_users")) return answers.admin;
    return [];
  });
  h.exec.mockResolvedValue(1);
  h.userFind.mockResolvedValue({ kycTier: 1 });
  h.txCreate.mockResolvedValue({ id: "tx1" });
  h.notify.mockResolvedValue(undefined);
});

const submit = (over: Record<string, unknown> = {}) =>
  submitTrade({ userId: "u1", rateId: RATE.id, faceValue: 100, code: "ABCD-1234", fileIds: ["f1"], idempotencyKey: "k1", ...over });

describe("gift card trade-in", () => {
  it("pays face value × the rate", () => {
    expect(payoutMinor(100, 125_000n)).toBe(12_500_000n); // $100 × ₦1,250 = ₦125,000
    expect(payoutMinor(25.9, 100n)).toBe(2_500n); // whole units only
  });

  it("locks the server's rate and payout onto the trade and stores the code encrypted", async () => {
    const t = await submit();
    expect(t.payoutFormatted).toContain("125,000");
    const insert = h.query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO gift_card_trades"))!;
    expect(insert[8]).toBe(125_000n); // rate_minor
    expect(insert[9]).toBe(12_500_000n); // payout_minor
    expect(insert[10]).toBe("enc(ABCD-1234)");
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain("ABCD-1234");
    expect(h.notify).toHaveBeenCalledOnce();
  });

  it("replays an idempotent submission without inserting again", async () => {
    answers.replay = [tradeRow()];
    await submit();
    expect(h.query.mock.calls.some((c) => String(c[0]).includes("INSERT INTO gift_card_trades"))).toBe(false);
  });

  it("needs verified identity", async () => {
    h.userFind.mockResolvedValue({ kycTier: 0 });
    await expect(submit()).rejects.toMatchObject({ code: "kyc_required" });
  });

  it("keeps the value inside the rate's limits", async () => {
    await expect(submit({ faceValue: 5 })).rejects.toMatchObject({ code: "bad_value" });
    await expect(submit({ faceValue: 501 })).rejects.toMatchObject({ code: "bad_value" });
  });

  it("refuses a card we aren't buying", async () => {
    answers.rate = [{ ...RATE, active: false }];
    await expect(submit()).rejects.toMatchObject({ code: "rate_unavailable" });
  });

  it("needs a photo or a code, and only the user's own unused photos", async () => {
    await expect(submit({ code: "", fileIds: [] })).rejects.toMatchObject({ code: "no_card_details" });
    answers.owned = [];
    await expect(submit()).rejects.toMatchObject({ code: "bad_files" });
  });

  it("caps submissions per day", async () => {
    answers.today = 10;
    await expect(submit()).rejects.toMatchObject({ code: "daily_limit" });
  });

  it("approval credits the locked payout once, with a one-per-trade ledger key", async () => {
    await approveTrade("t1", "admin@cheqpay.com");
    expect(h.balanceUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { available: { increment: 12_500_000n } } }));
    expect(h.txCreate.mock.calls[0][0].data).toMatchObject({ type: "GIFTCARD_SELL", amount: 12_500_000n, idempotencyKey: "giftcard-sell:t1" });
    const upd = h.query.mock.calls.find((c) => String(c[0]).includes("UPDATE gift_card_trades SET status = 'APPROVED'"))!;
    expect(upd[0]).toMatch(/status IN \('SUBMITTED', 'IN_REVIEW'\)/);
  });

  it("a second approval (already reviewed) pays nothing", async () => {
    answers.update = [];
    await expect(approveTrade("t1", "a")).rejects.toMatchObject({ code: "already_reviewed" });
    expect(h.balanceUpsert).not.toHaveBeenCalled();
    expect(h.txCreate).not.toHaveBeenCalled();
  });

  it("rejection never moves money and needs a reason", async () => {
    await expect(rejectTrade("t1", "a", "  ")).rejects.toMatchObject({ code: "reason_required" });
    answers.update = [tradeRow({ status: "REJECTED", reject_reason: "Card already used" })];
    const t = await rejectTrade("t1", "a", "Card already used");
    expect(t.status).toBe("REJECTED");
    expect(h.balanceUpsert).not.toHaveBeenCalled();
  });

  it("shows the reviewing admin the decrypted code and signed photo links", async () => {
    answers.admin = [{ ...tradeRow(), email: "ada@x.com", legal_name: "Ada", kyc_tier: 1, approved: 2n, rejected: 0n }];
    const t = await getTradeAdmin("t1", "https://api.test");
    expect(t.code).toBe("ABCD-1234");
    expect(t.photoUrls[0]).toMatch(/^https:\/\/api\.test\/api\/giftcards\/files\/f1\?exp=\d+&sig=/);
  });

  it("photo links expire and can't be forged", () => {
    const url = new URL(signGiftCardFileUrl("f1", 60, "https://api.test"));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(verifyGiftCardFileToken("f1", exp, sig)).toBe(true);
    expect(verifyGiftCardFileToken("f2", exp, sig)).toBe(false);
    expect(verifyGiftCardFileToken("f1", Math.floor(Date.now() / 1000) - 1, sig)).toBe(false);
  });
});

describe("alertAdminsNewGiftCard", () => {
  const trade = {
    id: "t-1", brandName: "Amazon", countryName: "United States", cardType: "ECODE",
    faceValueFormatted: "$100", payoutFormatted: "₦125,000.00",
  } as unknown as Parameters<typeof alertAdminsNewGiftCard>[1];

  beforeEach(() => {
    for (const f of [h.query, h.push, h.webPush, h.email, h.webhook]) f.mockReset();
    h.push.mockResolvedValue(1); h.webPush.mockResolvedValue(1); h.email.mockResolvedValue({ id: "e" }); h.webhook.mockResolvedValue(undefined);
    h.emailOn.mockReturnValue(true);
    h.query.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("FROM admin_accounts")) return [{ email: "ops@cheqpay.com" }, { email: "Reviewer@CheqPay.com" }];
      if (sql.includes("legal_name FROM app_users")) return [{ email: "tolu@example.com", legal_name: "Tolu Adeyemi" }];
      if (sql.includes("lower(email) = ANY")) {
        const wanted = args[0] as string[];
        return [{ id: "admin-owner", email: "owner@cheqpay.com" }, { id: "admin-rev", email: "reviewer@cheqpay.com" }].filter((u) => wanted.includes(u.email));
      }
      return [];
    });
  });

  it("pushes, emails and posts the webhook for every admin, once each", async () => {
    await alertAdminsNewGiftCard("user-1", trade);
    const lookup = h.query.mock.calls.find(([sql]) => String(sql).includes("lower(email) = ANY"))!;
    expect(lookup[1]).toEqual(["owner@cheqpay.com", "ops@cheqpay.com", "reviewer@cheqpay.com"]);
    expect(h.push.mock.calls.map((c) => c[0]).sort()).toEqual(["admin-owner", "admin-rev"]);
    expect(h.webPush).toHaveBeenCalledTimes(2);
    const msg = h.push.mock.calls[0][1];
    expect(msg.title).toBe("New gift card to review");
    expect(msg.body).toBe("Tolu Adeyemi sent a $100 Amazon (United States, E-code) · pays ₦125,000.00");
    expect(msg.category).toBe("trades");
    expect(h.email.mock.calls.map((c) => c[0].to)).toEqual(["owner@cheqpay.com", "ops@cheqpay.com", "reviewer@cheqpay.com"]);
    expect(h.webhook).toHaveBeenCalledTimes(1);
  });

  it("skips email when it isn't configured and survives every channel failing", async () => {
    h.emailOn.mockReturnValue(false);
    h.push.mockRejectedValue(new Error("expo down"));
    h.webPush.mockRejectedValue(new Error("vapid"));
    h.webhook.mockRejectedValue(new Error("hook"));
    await expect(alertAdminsNewGiftCard("user-1", trade)).resolves.toBeUndefined();
    expect(h.email).not.toHaveBeenCalled();
  });

  it("still posts the webhook when there are no admin emails", async () => {
    h.env.ADMIN_EMAILS = "";
    h.query.mockImplementation(async (sql: string) => (sql.includes("FROM admin_accounts") ? Promise.reject(new Error("no table")) : []));
    await alertAdminsNewGiftCard("user-1", trade);
    expect(h.push).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
    expect(h.webhook).toHaveBeenCalledTimes(1);
    h.env.ADMIN_EMAILS = "Owner@CheqPay.com, ops@cheqpay.com,not-an-email";
  });
});
