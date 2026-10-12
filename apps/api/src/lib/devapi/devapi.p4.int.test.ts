// Integration tests for phase 4 of the developer API (USD virtual cards)
// against a real Postgres. The card issuer is faked; the gate, the ledger, the
// limits, the reveal cap and the issuing-webhook fall-through are real.
//
//   DEVAPI_DB_TESTS=1 PAYMENT_PROVIDER=mock DATABASE_URL=postgresql://… DIRECT_URL=… \
//     npx vitest run src/lib/devapi/devapi.p4.int.test.ts

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  return {
    createCard: vi.fn(),
    getCard: vi.fn(),
    fundCard: vi.fn(),
    withdrawFromCard: vi.fn(),
    freezeCard: vi.fn(),
    unfreezeCard: vi.fn(),
    getCardTransactions: vi.fn(),
  };
});

vi.mock("../maplerad/issuing", async (orig) => ({
  ...(await orig<typeof import("../maplerad/issuing")>()),
  createCard: h.createCard,
  getCard: h.getCard,
  fundCard: h.fundCard,
  withdrawFromCard: h.withdrawFromCard,
  freezeCard: h.freezeCard,
  unfreezeCard: h.unfreezeCard,
  getCardTransactions: h.getCardTransactions,
}));
vi.mock("../opsAlert", () => ({ alertOpsOnce: vi.fn(async () => undefined) }));

import { prisma } from "@cheqpay/db";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { setFeatureFlags } from "../features";
import { __resetRateLimits } from "../ratelimit";
import { MapleradError } from "../maplerad/client";
import { cardStore } from "../cards";
import { ensureDevApiSchema } from "./ensureDevApi";
import { createAccount } from "./accounts";
import { createApiKey, invalidateKeyCache } from "./keys";
import { applyLegs, ensureCustomerWallets, findLedgerMismatches, insertTransaction } from "./ledger";
import { __resetAuthGuard } from "./authGuard";
import { __setWebhookTransportForTests } from "./webhooks";
import { REVEALS_PER_HOUR, minCardFundCents, sweepPendingCards } from "./cards";
import { PLAN_DEFAULTS } from "./plans";
import type { AccountRow, Mode } from "./types";

import { GET as listCardsRoute, POST as createCardRoute } from "../../app/v1/cards/route";
import { GET as getCardRoute } from "../../app/v1/cards/[id]/route";
import { GET as detailsRoute } from "../../app/v1/cards/[id]/details/route";
import { POST as fundRoute } from "../../app/v1/cards/[id]/fund/route";
import { POST as withdrawRoute } from "../../app/v1/cards/[id]/withdraw/route";
import { POST as freezeRoute } from "../../app/v1/cards/[id]/freeze/route";
import { POST as unfreezeRoute } from "../../app/v1/cards/[id]/unfreeze/route";
import { GET as cardTxRoute } from "../../app/v1/cards/[id]/transactions/route";
import { POST as purchaseRoute } from "../../app/v1/test_helpers/cards/[id]/purchase/route";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const tag = randomBytes(4).toString("hex");
const IP = "102.89.20.32";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (r: Response) => (await r.json()) as Json;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const idem = () => `k-${randomBytes(8).toString("hex")}`;

function api(path: string, key: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  headers.set("x-forwarded-for", IP);
  return new Request(`https://api.mycheqpay.com${path}`, { ...init, headers });
}
function post(path: string, key: string, body: unknown = {}, k: string = idem()) {
  return api(path, key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "idempotency-key": k } });
}
async function balance(walletUuid: string): Promise<bigint> {
  return (await prisma.$queryRawUnsafe<{ available_minor: bigint }[]>(`SELECT available_minor FROM dev_wallets WHERE id = $1::uuid`, walletUuid))[0].available_minor;
}
async function events(accountId: string, type: string, id: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM dev_events WHERE account_id = $1::uuid AND type = $2 AND data::text LIKE $3`,
    accountId,
    type,
    `%${id}%`,
  );
  return Number(rows[0].n);
}
async function credit(accountId: string, mode: Mode, walletId: string, amount: bigint) {
  await prisma.$transaction(async (db) => {
    const id = await insertTransaction(db, { accountId, mode, kind: "adjustment", status: "successful", currency: "USD", amountMinor: amount, walletId });
    await applyLegs(db, { accountId, mode }, id, "USD", [{ walletId, amountMinor: amount, kind: "adjustment" }]);
  });
}
/** A verified customer with USD (and NGN) wallets; returns the customer and their USD wallet. */
async function customer(accountId: string, mode: Mode, opts: { verified?: boolean; providerId?: string | null } = {}) {
  const id = (
    await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO dev_customers (id, account_id, mode, first_name, last_name, email, phone, bvn_fingerprint, bvn_last4, id_type, kyc_status, provider_customer_id)
       VALUES (gen_random_uuid(), $1::uuid, $2, 'Ada', 'Obi', $3, '08031234567', $4, '1234', 'NIN', $5, $6) RETURNING id`,
      accountId,
      mode,
      `c-${randomBytes(4).toString("hex")}@x.test`,
      `fp-${randomBytes(6).toString("hex")}`,
      opts.verified === false ? "pending" : "verified",
      opts.providerId ?? null,
    )
  )[0].id;
  await ensureCustomerWallets(prisma, accountId, mode, id);
  const usd = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM dev_wallets WHERE customer_id = $1::uuid AND currency = 'USD'`, id))[0].id;
  const ngn = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM dev_wallets WHERE customer_id = $1::uuid AND currency = 'NGN'`, id))[0].id;
  return { id, pub: toPublicId("customer", id), usd, ngn };
}

const GROWTH = PLAN_DEFAULTS.growth;
const fundFee = (cents: bigint) => (cents * BigInt(GROWTH.cardFundFeeBps)) / 10_000n;
const ISSUE = BigInt(GROWTH.cardIssueFeeCents);

let acct: AccountRow;
let otherAcct: AccountRow;
let key: string;
let otherKey: string;
let noDetailsKey: string;
let MIN = 500n;

describe.skipIf(!RUN)("developer API cards against Postgres", () => {
  beforeAll(async () => {
    await ensureDevApiSchema();
    await setFeatureFlags({ developer_api: true, virtual_cards: true } as never, "test");
    const owner = await prisma.user.create({ data: { email: `p4-${tag}@x.test`, kycTier: 2 } });
    const other = await prisma.user.create({ data: { email: `p4b-${tag}@x.test`, kycTier: 1 } });
    acct = await createAccount(owner.id, { businessName: `Cardco ${tag}` });
    otherAcct = await createAccount(other.id, { businessName: `Other ${tag}` });
    await prisma.$executeRawUnsafe(
      `INSERT INTO dev_subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1::uuid, 'growth', 'active', now(), now() + interval '30 days')`,
      acct.id,
    );
    key = (await createApiKey(acct, { mode: "test", label: "server", scopes: ["cards:read", "cards:write", "cards:details", "transactions:read"] })).secret;
    noDetailsKey = (await createApiKey(acct, { mode: "test", label: "no-details", scopes: ["cards:read", "cards:write"] })).secret;
    otherKey = (await createApiKey(otherAcct, { mode: "test", label: "other" })).secret;
    MIN = await minCardFundCents();
    __setWebhookTransportForTests(async () => ({ status: 200, body: "" }));
  });

  beforeEach(() => {
    __resetRateLimits();
    __resetAuthGuard();
    for (const f of Object.values(h)) f.mockReset();
  });

  afterAll(async () => {
    __setWebhookTransportForTests(null);
    await setFeatureFlags({ developer_api: false } as never, "test");
  });

  describe("sandbox", () => {
    let cus: Awaited<ReturnType<typeof customer>>;
    let card: Json;

    beforeAll(async () => {
      cus = await customer(acct.id, "test");
      await credit(acct.id, "test", cus.usd, 100_000n); // $1,000
    });

    it("issues a card at once: first top-up on the card, price and fee charged once", async () => {
      const k = idem();
      const res = await createCardRoute(post("/v1/cards", key, { customer_id: cus.pub, amount: 2_000, reference: `card-${tag}` }, k));
      expect(res.status).toBe(201);
      card = await json(res);
      expect(card).toMatchObject({ object: "card", status: "active", customer_id: cus.pub, wallet_id: toPublicId("wallet", cus.usd), balance: 2_000, currency: "USD", livemode: false });
      expect(card.last4).toMatch(/^\d{4}$/);
      expect(card).not.toHaveProperty("number");
      const charged = 2_000n + ISSUE + fundFee(2_000n);
      expect(await balance(cus.usd)).toBe(100_000n - charged);
      expect(await events(acct.id, "card.active", card.id)).toBe(1);
      // Retrying the same request returns the same card and charges nothing more.
      const again = await json(await createCardRoute(post("/v1/cards", key, { customer_id: cus.pub, amount: 2_000, reference: `card-${tag}` }, k)));
      expect(again.id).toBe(card.id);
      expect(await balance(cus.usd)).toBe(100_000n - charged);
      expect(h.createCard).not.toHaveBeenCalled();
    });

    it("refuses an unverified customer, a small top-up, the wrong wallet, and other accounts", async () => {
      const before = await balance(cus.usd);
      const pending = await customer(acct.id, "test", { verified: false });
      expect((await json(await createCardRoute(post("/v1/cards", key, { customer_id: pending.pub, amount: 2_000 })))).error.code).toBe("kyc_required");
      expect((await createCardRoute(post("/v1/cards", key, { customer_id: cus.pub, amount: Number(MIN) - 1 }))).status).toBe(400);
      expect((await json(await createCardRoute(post("/v1/cards", key, { customer_id: cus.pub, amount: 2_000, wallet_id: toPublicId("wallet", cus.ngn) })))).error.code).toBe("currency_mismatch");
      const someoneElse = await customer(acct.id, "test");
      expect((await createCardRoute(post("/v1/cards", key, { customer_id: cus.pub, amount: 2_000, wallet_id: toPublicId("wallet", someoneElse.usd) }))).status).toBe(400);
      expect((await createCardRoute(post("/v1/cards", otherKey, { customer_id: cus.pub, amount: 2_000 }))).status).toBe(404);
      expect((await getCardRoute(api(`/v1/cards/${card.id}`, otherKey), params({ id: card.id }))).status).toBe(404);
      expect(await balance(cus.usd)).toBe(before);
    });

    it("funds and withdraws against the card's balance, never more than it holds", async () => {
      const before = await balance(cus.usd);
      const funded = await json(await fundRoute(post(`/v1/cards/${card.id}/fund`, key, { amount: 1_000 }), params({ id: card.id })));
      expect(funded).toMatchObject({ kind: "card_funding", status: "successful", amount: 1_000, fee: Number(fundFee(1_000n)), details: { card_id: card.id } });
      expect(await balance(cus.usd)).toBe(before - 1_000n - fundFee(1_000n));
      expect((await json(await getCardRoute(api(`/v1/cards/${card.id}`, key), params({ id: card.id })))).balance).toBe(3_000);

      const tooMuch = await withdrawRoute(post(`/v1/cards/${card.id}/withdraw`, key, { amount: 3_001 }), params({ id: card.id }));
      expect(tooMuch.status).toBe(422);
      const out = await json(await withdrawRoute(post(`/v1/cards/${card.id}/withdraw`, key, { amount: 500 }), params({ id: card.id })));
      expect(out).toMatchObject({ kind: "card_withdrawal", status: "successful", amount: 500, fee: 0 });
      expect(await balance(cus.usd)).toBe(before - 1_000n - fundFee(1_000n) + 500n);
      expect((await json(await getCardRoute(api(`/v1/cards/${card.id}`, key), params({ id: card.id })))).balance).toBe(2_500);
      expect(await events(acct.id, "card.funded", funded.id)).toBe(1);
      expect(await events(acct.id, "card.withdrawn", out.id)).toBe(1);
    });

    it("a frozen card can't be funded or spent, until it's unfrozen", async () => {
      const frozen = await json(await freezeRoute(post(`/v1/cards/${card.id}/freeze`, key), params({ id: card.id })));
      expect(frozen.status).toBe("frozen");
      expect((await json(await fundRoute(post(`/v1/cards/${card.id}/fund`, key, { amount: 1_000 }), params({ id: card.id })))).error.code).toBe("card_not_active");
      const declined = await json(await purchaseRoute(post(`/v1/test_helpers/cards/${card.id}/purchase`, key, { amount: 100 }), params({ id: card.id })));
      expect(declined).toMatchObject({ status: "declined", decline_reason: "card_frozen" });
      // Freezing twice changes nothing and sends one event.
      await freezeRoute(post(`/v1/cards/${card.id}/freeze`, key), params({ id: card.id }));
      expect(await events(acct.id, "card.frozen", card.id)).toBe(1);
      expect((await json(await unfreezeRoute(post(`/v1/cards/${card.id}/unfreeze`, key), params({ id: card.id })))).status).toBe("active");
    });

    it("simulated purchases spend the balance and decline past it; the card lists them", async () => {
      const ok = await json(await purchaseRoute(post(`/v1/test_helpers/cards/${card.id}/purchase`, key, { amount: 1_500, merchant_name: "Netflix" }), params({ id: card.id })));
      expect(ok).toMatchObject({ status: "approved", amount: 1_500, merchant: { name: "Netflix" } });
      const no = await json(await purchaseRoute(post(`/v1/test_helpers/cards/${card.id}/purchase`, key, { amount: 1_001 }), params({ id: card.id })));
      expect(no).toMatchObject({ status: "declined", decline_reason: "insufficient_funds" });
      expect((await json(await getCardRoute(api(`/v1/cards/${card.id}`, key), params({ id: card.id })))).balance).toBe(1_000);
      const list = await json(await cardTxRoute(api(`/v1/cards/${card.id}/transactions`, key), params({ id: card.id })));
      expect(list.data.map((t: Json) => t.status)).toEqual(expect.arrayContaining(["approved", "declined"]));
    });

    it("reveals the number only with the scope, uncached, at most ten times an hour, each one recorded", async () => {
      expect((await detailsRoute(api(`/v1/cards/${card.id}/details`, noDetailsKey), params({ id: card.id }))).status).toBe(403);
      const res = await detailsRoute(api(`/v1/cards/${card.id}/details`, key), params({ id: card.id }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const d = await json(res);
      expect(d.number).toMatch(new RegExp(`^\\d{12}${card.last4}$`));
      expect(d.cvv).toMatch(/^\d{3}$/);
      for (let i = 1; i < REVEALS_PER_HOUR; i++) {
        __resetRateLimits();
        expect((await detailsRoute(api(`/v1/cards/${card.id}/details`, key), params({ id: card.id }))).status).toBe(200);
      }
      __resetRateLimits();
      const capped = await detailsRoute(api(`/v1/cards/${card.id}/details`, key), params({ id: card.id }));
      expect(capped.status).toBe(429);
      const audit = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM dev_audit_logs WHERE account_id = $1::uuid AND action = 'card.details_revealed' AND target = $2`,
        acct.id,
        card.id,
      );
      expect(Number(audit[0].n)).toBe(REVEALS_PER_HOUR);
      // The request log never holds the number.
      const logged = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM dev_request_logs l WHERE l.account_id = $1::uuid AND row_to_json(l)::text LIKE $2`, acct.id, `%${d.number}%`);
      expect(Number(logged[0].n)).toBe(0);
    });

    it("lists cards by customer", async () => {
      const page = await json(await listCardsRoute(api(`/v1/cards?customer_id=${cus.pub}`, key)));
      expect(page.data.map((c: Json) => c.id)).toContain(card.id);
      expect(page.data.every((c: Json) => c.customer_id === cus.pub)).toBe(true);
    });
  });

  describe("live", () => {
    let liveKey = "";
    let cus: Awaited<ReturnType<typeof customer>>;
    const providerCustomer = `mpl_cus_${tag}`;

    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET status = 'approved', live_since = now() - interval '60 days', reviewed_at = now() WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
      acct = (await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, acct.id))[0];
      cus = await customer(acct.id, "live", { providerId: providerCustomer });
      await credit(acct.id, "live", cus.usd, 1_000_000n); // $10,000
      liveKey = (await createApiKey(acct, { mode: "live", label: "prod", scopes: ["cards:read", "cards:write", "cards:details"], allowedIps: [IP] })).secret;
    });

    const issue = (body: Json = {}) => createCardRoute(post("/v1/cards", liveKey, { customer_id: cus.pub, amount: 2_000, ...body }));

    it("asks the issuer for the card, then the issuing webhook activates it, once", async () => {
      h.createCard.mockResolvedValueOnce({ reference: `ref-ok-${tag}` });
      const before = await balance(cus.usd);
      const res = await issue({ brand: "MASTERCARD" });
      expect(res.status).toBe(202);
      const card = await json(res);
      expect(card).toMatchObject({ status: "pending", last4: null, balance: null });
      expect(h.createCard.mock.calls[0][0]).toMatchObject({ customerId: providerCustomer, brand: "MASTERCARD", amount: 2_000 });
      expect(await balance(cus.usd)).toBe(before - 2_000n - ISSUE - fundFee(2_000n));

      await cardStore.finalizeCard({ reference: `ref-ok-${tag}`, cardId: `mpl_card_${tag}`, status: "SUCCESS", raw: { masked_pan: "411111******1234", expiry: "09/29" } as never });
      h.getCard.mockResolvedValueOnce({ id: `mpl_card_${tag}`, balance: 2_000 });
      const active = await json(await getCardRoute(api(`/v1/cards/${card.id}`, liveKey), params({ id: card.id })));
      expect(active).toMatchObject({ status: "active", last4: "1234", expiry_month: 9, expiry_year: 2029, balance: 2_000 });
      const issueTx = (await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT t.status FROM dev_transactions t JOIN dev_cards c ON c.issue_transaction_id = t.id WHERE c.id = $1::uuid`, fromPublicId("card", card.id)))[0];
      expect(issueTx.status).toBe("successful");
      // A repeated webhook changes nothing.
      await cardStore.finalizeCard({ reference: `ref-ok-${tag}`, cardId: `mpl_card_${tag}`, status: "SUCCESS", raw: {} as never });
      expect(await events(acct.id, "card.active", card.id)).toBe(1);
    });

    it("refunds a refused card at once, and a card the issuer fails later, once", async () => {
      h.createCard.mockRejectedValueOnce(new MapleradError("customer not eligible", 400));
      const before = await balance(cus.usd);
      const refused = await json(await issue());
      expect(refused).toMatchObject({ status: "failed", failure: { code: "card_refused" } });
      expect(await balance(cus.usd)).toBe(before);

      h.createCard.mockRejectedValueOnce(new Error("socket hang up"));
      const unclear = await issue();
      expect(unclear.status).toBe(202);
      const pending = await json(unclear);
      expect(await balance(cus.usd)).toBe(before - 2_000n - ISSUE - fundFee(2_000n));
      // With no reference there's nothing to reconcile by; ops are told. A
      // card that does have a reference and fails later is refunded once:
      h.createCard.mockResolvedValueOnce({ reference: `ref-fail-${tag}` });
      const later = await json(await issue());
      await cardStore.finalizeCard({ reference: `ref-fail-${tag}`, status: "FAILED", raw: {} as never });
      await cardStore.finalizeCard({ reference: `ref-fail-${tag}`, status: "FAILED", raw: {} as never });
      expect((await json(await getCardRoute(api(`/v1/cards/${later.id}`, liveKey), params({ id: later.id })))).status).toBe("failed");
      expect(await balance(cus.usd)).toBe(before - 2_000n - ISSUE - fundFee(2_000n));
      expect(pending.status).toBe("pending");
      expect(await events(acct.id, "card.failed", later.id)).toBe(1);
    });

    it("the sweep activates a pending card the issuer confirms, and leaves silence alone", async () => {
      h.createCard.mockResolvedValueOnce({ reference: `ref-sweep-${tag}` });
      const a = await json(await issue());
      h.createCard.mockResolvedValueOnce({ reference: `ref-quiet-${tag}` });
      const b = await json(await issue());
      await prisma.$executeRawUnsafe(`UPDATE dev_cards SET created_at = now() - interval '10 minutes' WHERE id = ANY($1::uuid[])`, [fromPublicId("card", a.id), fromPublicId("card", b.id)]);
      h.getCard.mockImplementation(async (ref: string) => {
        if (ref === `ref-sweep-${tag}`) return { id: `mpl_card_sweep_${tag}`, status: "ACTIVE", masked_pan: "411111******9876", expiry: "01/30" };
        throw new MapleradError("not found", 404);
      });
      const r = await sweepPendingCards({ olderThanMs: 60_000, limit: 500 });
      expect(r.activated).toBeGreaterThanOrEqual(1);
      const status = async (id: string) => (await prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM dev_cards WHERE id = $1::uuid`, fromPublicId("card", id)))[0].status;
      expect(await status(a.id)).toBe("active");
      expect(await status(b.id)).toBe("pending");
    });

    describe("money on a live card", () => {
      let card: Json;
      beforeAll(async () => {
        h.createCard.mockResolvedValueOnce({ reference: `ref-money-${tag}` });
        card = await json(await issue());
        await cardStore.finalizeCard({ reference: `ref-money-${tag}`, cardId: `mpl_card_money_${tag}`, status: "SUCCESS", raw: { masked_pan: "411111******5555" } as never });
      });

      it("funds: loaded once confirmed, refunded when refused, held when unclear", async () => {
        const before = await balance(cus.usd);
        h.fundCard.mockResolvedValueOnce({ id: "f1" });
        const ok = await json(await fundRoute(post(`/v1/cards/${card.id}/fund`, liveKey, { amount: 1_000 }), params({ id: card.id })));
        expect(ok.status).toBe("successful");
        expect(h.fundCard).toHaveBeenCalledWith(`mpl_card_money_${tag}`, 1_000);

        h.fundCard.mockRejectedValueOnce(new MapleradError("card limit", 400));
        const refused = await json(await fundRoute(post(`/v1/cards/${card.id}/fund`, liveKey, { amount: 1_000 }), params({ id: card.id })));
        expect(refused).toMatchObject({ status: "failed", failure: { code: "card_fund_refused" } });

        h.fundCard.mockRejectedValueOnce(new Error("timeout"));
        const unclear = await fundRoute(post(`/v1/cards/${card.id}/fund`, liveKey, { amount: 1_000 }), params({ id: card.id }));
        expect(unclear.status).toBe(202);
        expect((await json(unclear)).status).toBe("pending");
        const per = 1_000n + fundFee(1_000n);
        expect(await balance(cus.usd)).toBe(before - per * 2n);
      });

      it("withdraws: credits only once the issuer confirms; refusal or silence credits nothing", async () => {
        const before = await balance(cus.usd);
        h.withdrawFromCard.mockResolvedValueOnce({ id: "w1" });
        expect((await json(await withdrawRoute(post(`/v1/cards/${card.id}/withdraw`, liveKey, { amount: 700 }), params({ id: card.id })))).status).toBe("successful");
        h.withdrawFromCard.mockRejectedValueOnce(new MapleradError("insufficient card balance", 400));
        expect((await json(await withdrawRoute(post(`/v1/cards/${card.id}/withdraw`, liveKey, { amount: 700 }), params({ id: card.id })))).status).toBe("failed");
        h.withdrawFromCard.mockRejectedValueOnce(new Error("timeout"));
        expect((await withdrawRoute(post(`/v1/cards/${card.id}/withdraw`, liveKey, { amount: 700 }), params({ id: card.id }))).status).toBe(202);
        expect(await balance(cus.usd)).toBe(before + 700n);
      });

      it("reveals live details from the issuer without storing them", async () => {
        h.getCard.mockResolvedValueOnce({ id: `mpl_card_money_${tag}`, card_number: "4111 1111 1111 5555", cvv: "321", expiry: "09/29" });
        const d = await json(await detailsRoute(api(`/v1/cards/${card.id}/details`, liveKey), params({ id: card.id })));
        expect(d).toMatchObject({ number: "4111111111115555", cvv: "321", expiry_month: 9, expiry_year: 2029 });
        const stored = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM dev_cards WHERE row_to_json(dev_cards)::text LIKE '%4111111111115555%'`);
        expect(Number(stored[0].n)).toBe(0);
      });

      it("freezes at the issuer first; if it doesn't answer, nothing changes", async () => {
        h.freezeCard.mockRejectedValueOnce(new Error("timeout"));
        expect((await freezeRoute(post(`/v1/cards/${card.id}/freeze`, liveKey), params({ id: card.id }))).status).toBe(503);
        h.freezeCard.mockResolvedValueOnce(undefined);
        expect((await json(await freezeRoute(post(`/v1/cards/${card.id}/freeze`, liveKey), params({ id: card.id })))).status).toBe("frozen");
        h.unfreezeCard.mockResolvedValueOnce(undefined);
        expect((await json(await unfreezeRoute(post(`/v1/cards/${card.id}/unfreeze`, liveKey), params({ id: card.id })))).status).toBe("active");
      });

      it("parallel top-ups never overdraw the wallet, and the ledger still adds up", async () => {
        h.fundCard.mockResolvedValue({ id: "ok" });
        const per = 1_000n + fundFee(1_000n);
        const now = await balance(cus.usd);
        const drain = now - per * 4n;
        await prisma.$transaction(async (db) => {
          const id = await insertTransaction(db, { accountId: acct.id, mode: "live", kind: "adjustment", status: "successful", currency: "USD", amountMinor: drain, walletId: cus.usd });
          await applyLegs(db, { accountId: acct.id, mode: "live" }, id, "USD", [{ walletId: cus.usd, amountMinor: -drain, kind: "adjustment" }]);
        });
        const results = await Promise.all(Array.from({ length: 10 }, () => fundRoute(post(`/v1/cards/${card.id}/fund`, liveKey, { amount: 1_000 }), params({ id: card.id }))));
        expect(results.filter((r) => r.status === 201)).toHaveLength(4);
        expect(results.filter((r) => r.status === 422)).toHaveLength(6);
        expect(await balance(cus.usd)).toBe(0n);
        expect((await findLedgerMismatches()).filter((m) => m.account_id === acct.id)).toEqual([]);
      });
    });

    it("pauses live cards with the cards switch; the sandbox keeps working", async () => {
      await setFeatureFlags({ virtual_cards: false } as never, "test");
      const off = await issue();
      expect(off.status).toBe(503);
      expect((await json(off)).error.code).toBe("feature_disabled");
      const sandboxCus = await customer(acct.id, "test");
      await credit(acct.id, "test", sandboxCus.usd, 10_000n);
      expect((await createCardRoute(post("/v1/cards", key, { customer_id: sandboxCus.pub, amount: 1_000 }))).status).toBe(201);
      await setFeatureFlags({ virtual_cards: true } as never, "test");
      expect(h.createCard).not.toHaveBeenCalled();
    });
  });
});
