// Integration tests for phase 2 of the developer API against a real Postgres:
// customers and verification, virtual accounts, deposits, transfers,
// conversions, events and webhooks. The banking partner is mocked; everything
// else (the gate, the ledger, the database rules) is real.
//
//   DEVAPI_DB_TESTS=1 PAYMENT_PROVIDER=mock DATABASE_URL=postgresql://… DIRECT_URL=… \
//     npx vitest run src/lib/devapi/devapi.p2.int.test.ts

import { randomBytes, randomInt } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.PII_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.PUBLIC_API_URL = "https://api.cheqpay.test";
  return {
    user: { id: "", email: "", aal: "aal2" as string },
    emails: [] as { to: string; subject: string }[],
    enroll: vi.fn(),
    tier2: vi.fn(),
    listVAs: vi.fn(),
    createVA: vi.fn(),
    verifyTx: vi.fn(),
    customerTxs: vi.fn(),
    quoteFx: vi.fn(),
    exchangeFx: vi.fn(),
    providerBalance: vi.fn(),
  };
});

vi.mock("../auth", async (orig) => ({
  ...(await orig<typeof import("../auth")>()),
  requireUser: vi.fn(async () => ({ id: h.user.id, email: h.user.email, aal: h.user.aal, emailConfirmed: true })),
}));
vi.mock("../email", () => ({
  isEmailConfigured: () => true,
  assertEmailConfigured: () => undefined,
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    h.emails.push({ to: m.to, subject: m.subject });
    return { id: "e" };
  }),
}));
vi.mock("../maplerad/customers", async (orig) => ({
  ...(await orig<typeof import("../maplerad/customers")>()),
  enrollCustomer: h.enroll,
  upgradeCustomerTier2: h.tier2,
}));
vi.mock("../maplerad/accounts", async (orig) => ({
  ...(await orig<typeof import("../maplerad/accounts")>()),
  getCustomerVirtualAccounts: h.listVAs,
  createStaticAccount: h.createVA,
}));
vi.mock("../maplerad/transactions", async (orig) => ({
  ...(await orig<typeof import("../maplerad/transactions")>()),
  verifyTransaction: h.verifyTx,
  getCustomerTransactions: h.customerTxs,
}));
vi.mock("../maplerad/fx", async (orig) => ({
  ...(await orig<typeof import("../maplerad/fx")>()),
  quoteFx: h.quoteFx,
  exchangeFx: h.exchangeFx,
}));
vi.mock("../maplerad/treasury", async (orig) => ({
  ...(await orig<typeof import("../maplerad/treasury")>()),
  getProviderBalanceMinor: h.providerBalance,
}));

import { UserStatus, prisma } from "@cheqpay/db";
import { fromPublicId, toPublicId } from "@cheqpay/devapi";
import { setFeatureFlags } from "../features";
import { __resetRateLimits } from "../ratelimit";
import { fingerprintPii } from "../pii";
import { MapleradError } from "../maplerad/client";
import { settleCollectionById } from "../maplerad/settle";
import { feeFromBps, getFxSideMarginBps } from "../settings";
import { ensureDevApiSchema } from "./ensureDevApi";
import { createAccount } from "./accounts";
import { createApiKey, invalidateKeyCache } from "./keys";
import { applyLegs, ensureMainWallets, findLedgerMismatches, getMainWallet, insertTransaction } from "./ledger";
import { __resetAuthGuard } from "./authGuard";
import { __setWebhookTransportForTests, verifyWebhookSignature } from "./webhooks";
import { reconcileLiveDeposits } from "./deposits";
import { PLAN_DEFAULTS } from "./plans";
import type { AccountRow } from "./types";

import { POST as uploadRoute } from "../../app/v1/files/route";
import { GET as listCustomersRoute, POST as createCustomerRoute } from "../../app/v1/customers/route";
import { GET as getCustomerRoute, PATCH as patchCustomerRoute } from "../../app/v1/customers/[id]/route";
import { GET as listVasRoute, POST as createVaRoute } from "../../app/v1/virtual_accounts/route";
import { GET as getVaRoute } from "../../app/v1/virtual_accounts/[id]/route";
import { POST as transferRoute } from "../../app/v1/transfers/route";
import { POST as quoteRoute } from "../../app/v1/fx/quotes/route";
import { POST as convertRoute } from "../../app/v1/fx/conversions/route";
import { GET as listEventsRoute } from "../../app/v1/events/route";
import { GET as getEventRoute } from "../../app/v1/events/[id]/route";
import { POST as testDepositRoute } from "../../app/v1/test_helpers/virtual_accounts/[id]/deposit/route";
import { GET as listWalletsRoute } from "../../app/v1/wallets/route";
import { GET as getWalletRoute } from "../../app/v1/wallets/[id]/route";
import { GET as devFileRoute } from "../../app/api/dev-files/[id]/route";
import { GET as listEndpointsRoute, POST as createEndpointRoute } from "../../app/api/developer/webhooks/route";
import { PATCH as patchEndpointRoute } from "../../app/api/developer/webhooks/[id]/route";
import { POST as rollEndpointRoute } from "../../app/api/developer/webhooks/[id]/roll/route";
import { POST as pingEndpointRoute } from "../../app/api/developer/webhooks/[id]/test/route";
import { GET as deliveriesRoute } from "../../app/api/developer/webhooks/[id]/deliveries/route";
import { POST as resendRoute } from "../../app/api/developer/deliveries/[id]/resend/route";
import { POST as sandboxDepositRoute } from "../../app/api/developer/sandbox/deposit/route";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const tag = randomBytes(4).toString("hex");
const IP = "102.89.20.30";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const json = async (r: Response) => (await r.json()) as Json;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const idem = () => `k-${randomBytes(8).toString("hex")}`;
const bvn = () => `4${String(randomInt(0, 1e9)).padStart(9, "0")}${randomInt(0, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(256)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(256)]);

function api(path: string, key: string | null, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  headers.set("x-forwarded-for", init.ip ?? IP);
  return new Request(`https://api.mycheqpay.com${path}`, { ...init, headers });
}
function postJson(path: string, key: string, body: unknown, key2: string = idem()) {
  return api(path, key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "idempotency-key": key2 } });
}
function patchJson(path: string, key: string, body: unknown) {
  return api(path, key, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
function dashboard(path: string, body: unknown, method = "POST") {
  return new Request(`https://api.mycheqpay.com${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": IP },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}
async function upload(key: string, bytes = png(), type = "image/png", purpose = "identity_document") {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "id-card");
  return uploadRoute(api("/v1/files", key, { method: "POST", body: form, headers: { "idempotency-key": idem() } }));
}
async function fileId(key: string) {
  return (await json(await upload(key))).id as string;
}
function customerBody(front: string, over: Json = {}) {
  return {
    first_name: "Ada",
    last_name: "Obi",
    email: `ada-${randomBytes(3).toString("hex")}@example.ng`,
    phone: "08031234567",
    date_of_birth: "1990-04-12",
    bvn: bvn(),
    address: { street: "12 Marina Road", city: "Lagos", state: "Lagos", postal_code: "101001" },
    identity: { type: "NIN", number: `NIN${randomInt(1e7, 1e8)}`, document_front: front },
    kyc_consent: true,
    ...over,
  };
}
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 4000): Promise<T> {
  const until = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < until) {
    await sleep(100);
    v = await fn();
  }
  return v;
}
async function walletBalance(publicId: string): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ available_minor: bigint }[]>(
    `SELECT available_minor FROM dev_wallets WHERE id = $1::uuid`,
    fromPublicId("wallet", publicId),
  );
  return rows[0].available_minor;
}

/** Everything a webhook receiver saw. */
const received: { url: string; body: string; headers: Record<string, string> }[] = [];
let receiverStatus = 200;

let owner: { id: string; email: string };
let other: { id: string; email: string };
let acct: AccountRow;
let otherAcct: AccountRow;
let key: string;
let otherKey: string;
let liveKey: string;

describe.skipIf(!RUN)("developer API phase 2 against Postgres", () => {
  beforeAll(async () => {
    await ensureDevApiSchema();
    await setFeatureFlags({ developer_api: true, ngn_deposits: true, crypto_trading: true } as never, "test");
    owner = await prisma.user.create({ data: { email: `p2-${tag}@x.test`, kycTier: 2 } });
    other = await prisma.user.create({ data: { email: `p2b-${tag}@x.test`, kycTier: 1 } });
    acct = await createAccount(owner.id, { businessName: `Acme ${tag}` });
    otherAcct = await createAccount(other.id, { businessName: `Rival ${tag}` });
    // A paid plan for the main account, so its keys get Growth's request rate.
    await prisma.$executeRawUnsafe(
      `INSERT INTO dev_subscriptions (account_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1::uuid, 'growth', 'active', now(), now() + interval '30 days')`,
      acct.id,
    );
    key = (await createApiKey(acct, { mode: "test", label: "server" })).secret;
    otherKey = (await createApiKey(otherAcct, { mode: "test", label: "rival" })).secret;
    __setWebhookTransportForTests(async (url, body, headers) => {
      received.push({ url, body, headers });
      return { status: receiverStatus, body: "" };
    });
  });

  beforeEach(() => {
    __resetRateLimits();
    __resetAuthGuard();
    h.user = { id: owner.id, email: owner.email, aal: "aal2" };
    receiverStatus = 200;
  });

  afterAll(async () => {
    __setWebhookTransportForTests(null);
    await setFeatureFlags({ developer_api: false } as never, "test");
  });

  describe("identity documents", () => {
    it("accepts a JPG or PNG by multipart or data URL, stores it encrypted, never returns it", async () => {
      const res = await upload(key);
      expect(res.status).toBe(201);
      const f = await json(res);
      expect(f).toMatchObject({ object: "file", purpose: "identity_document", content_type: "image/png", livemode: false });
      expect(Object.keys(f)).not.toContain("data");
      const viaJson = await uploadRoute(
        postJson("/v1/files", key, { purpose: "identity_document", file: `data:image/jpeg;base64,${jpeg().toString("base64")}` }),
      );
      expect(viaJson.status).toBe(201);
      const stored = await prisma.$queryRawUnsafe<{ data_enc: Buffer }[]>(`SELECT data_enc FROM dev_files WHERE id = $1::uuid`, fromPublicId("file", f.id));
      expect(Buffer.from(stored[0].data_enc).includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    });

    it("refuses PDFs, disguised files, oversize files and a missing purpose", async () => {
      expect((await json(await upload(key, Buffer.from("%PDF-1.7 hello"), "application/pdf"))).error.code).toBe("validation_error");
      expect((await json(await upload(key, Buffer.from("<script>alert(1)</script>"), "image/png"))).error.code).toBe("file_type_mismatch");
      expect((await upload(key, Buffer.concat([png(), Buffer.alloc(3 * 1024 * 1024)]))).status).toBe(413);
      expect((await json(await upload(key, png(), "image/png", ""))).error.param).toBe("purpose");
    });
  });

  let verifiedId = "";
  let verifiedNgnWallet = "";
  let verifiedUsdWallet = "";
  let rejectedId = "";
  let pendingId = "";

  describe("sandbox customers", () => {
    it("verifies a customer, opens their wallets and returns nothing identifying", async () => {
      const front = await fileId(key);
      const body = customerBody(front);
      const res = await createCustomerRoute(postJson("/v1/customers", key, body));
      expect(res.status).toBe(201);
      const c = await json(res);
      verifiedId = c.id;
      expect(c).toMatchObject({ object: "customer", bvn_last4: body.bvn.slice(-4), kyc: { status: "verified", reason: null }, identity: { type: "NIN" } });
      const text = JSON.stringify(c);
      for (const secret of [body.bvn, body.identity.number, body.date_of_birth, body.address.street]) expect(text).not.toContain(secret);
      const wallets = await json(await listWalletsRoute(api(`/v1/wallets?customer_id=${c.id}`, key)));
      expect(wallets.data.map((w: Json) => w.currency).sort()).toEqual(["NGN", "USD"]);
      verifiedNgnWallet = wallets.data.find((w: Json) => w.currency === "NGN").id;
      verifiedUsdWallet = wallets.data.find((w: Json) => w.currency === "USD").id;
      const events = await json(await listEventsRoute(api("/v1/events?type=customer.verified", key)));
      expect(events.data[0].data.object.id).toBe(c.id);
    });

    it("keeps one customer per BVN, and each document for one customer", async () => {
      const front = await fileId(key);
      const first = customerBody(front);
      expect((await createCustomerRoute(postJson("/v1/customers", key, first))).status).toBe(201);
      const again = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(await fileId(key), { bvn: first.bvn }))));
      expect(again.error).toMatchObject({ code: "customer_exists", param: "bvn" });
      const reused = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(front))));
      expect(reused.error.code).toBe("invalid_file");
      // Another developer's file is as good as no file.
      const theirs = await fileId(otherKey);
      expect((await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(theirs))))).error.code).toBe("invalid_file");
    });

    it("refuses under-18s, foreign phone numbers and unknown fields", async () => {
      const f = await fileId(key);
      const young = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(f, { date_of_birth: `${new Date().getUTCFullYear() - 16}-01-01` }))));
      expect(young.error).toMatchObject({ code: "validation_error", param: "date_of_birth" });
      const phone = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(f, { phone: "+447700900123" }))));
      expect(phone.error).toMatchObject({ code: "validation_error", param: "phone" });
      const extra = await json(await createCustomerRoute(postJson("/v1/customers", key, { ...customerBody(f), kyc_status: "verified" })));
      expect(extra.error.code).toBe("validation_error");
    });

    it("rejects the sandbox's rejected BVN with a generic reason, and lets the developer fix and resubmit", async () => {
      const res = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(await fileId(key), { bvn: "22222222222" }))));
      rejectedId = res.id;
      expect(res.kyc).toMatchObject({ status: "rejected", reason: { code: "identity_mismatch" } });
      const events = await json(await listEventsRoute(api("/v1/events?type=customer.rejected", key)));
      expect(events.data[0].data.object.id).toBe(rejectedId);
      const noConsent = await json(await patchCustomerRoute(patchJson(`/v1/customers/${rejectedId}`, key, { bvn: bvn() }), params({ id: rejectedId })));
      expect(noConsent.error.param).toBe("kyc_consent");
      const fixed = await json(await patchCustomerRoute(patchJson(`/v1/customers/${rejectedId}`, key, { bvn: bvn(), kyc_consent: true }), params({ id: rejectedId })));
      expect(fixed.kyc.status).toBe("verified");
    });

    it("locks a verified customer's identity but always allows metadata", async () => {
      const locked = await json(await patchCustomerRoute(patchJson(`/v1/customers/${verifiedId}`, key, { bvn: bvn(), kyc_consent: true }), params({ id: verifiedId })));
      expect(locked.error.code).toBe("customer_locked");
      const meta = await json(await patchCustomerRoute(patchJson(`/v1/customers/${verifiedId}`, key, { metadata: { crm: "77" } }), params({ id: verifiedId })));
      expect(meta.metadata).toEqual({ crm: "77" });
    });

    it("holds the sandbox's pending BVN for a minute, then verifies it on the next read", async () => {
      const res = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(await fileId(key), { bvn: "33333333333" }))));
      pendingId = res.id;
      expect(res.kyc.status).toBe("pending");
      expect((await json(await getCustomerRoute(api(`/v1/customers/${pendingId}`, key), params({ id: pendingId })))).kyc.status).toBe("pending");
      await prisma.$executeRawUnsafe(`UPDATE dev_customers SET kyc_next_attempt_at = now() - interval '1 second' WHERE id = $1::uuid`, fromPublicId("customer", pendingId));
      expect((await json(await getCustomerRoute(api(`/v1/customers/${pendingId}`, key), params({ id: pendingId })))).kyc.status).toBe("verified");
    });

    it("replays a retried create, and refuses the same key for a different body", async () => {
      const k = idem();
      const body = customerBody(await fileId(key));
      const first = await createCustomerRoute(postJson("/v1/customers", key, body, k));
      const again = await createCustomerRoute(postJson("/v1/customers", key, body, k));
      expect(again.status).toBe(201);
      expect(again.headers.get("idempotent-replayed")).toBe("true");
      expect((await json(again)).id).toBe((await json(first)).id);
      const changed = await json(await createCustomerRoute(postJson("/v1/customers", key, { ...body, first_name: "Bola" }, k)));
      expect(changed.error.code).toBe("idempotency_key_reused");
    });

    it("lists and filters, and shows nothing to another developer", async () => {
      const mine = await json(await listCustomersRoute(api("/v1/customers?kyc_status=verified", key)));
      expect(mine.data.every((c: Json) => c.kyc.status === "verified")).toBe(true);
      expect(mine.data.map((c: Json) => c.id)).toContain(verifiedId);
      const theirs = await json(await listCustomersRoute(api("/v1/customers", otherKey)));
      expect(theirs.data.map((c: Json) => c.id)).not.toContain(verifiedId);
      expect((await getCustomerRoute(api(`/v1/customers/${verifiedId}`, otherKey), params({ id: verifiedId }))).status).toBe(404);
    });
  });

  let vaId = "";

  describe("virtual accounts", () => {
    it("are only for verified customers, and only your own", async () => {
      const r = await json(await createCustomerRoute(postJson("/v1/customers", key, customerBody(await fileId(key), { bvn: "22222222222" }))));
      expect(r.kyc.status).toBe("rejected");
      const refused = await json(await createVaRoute(postJson("/v1/virtual_accounts", key, { customer_id: r.id })));
      expect(refused.error).toMatchObject({ code: "kyc_required", param: "customer_id" });
      expect((await json(await createVaRoute(postJson("/v1/virtual_accounts", otherKey, { customer_id: verifiedId })))).error.code).toBe("not_found");
    });

    it("opens one account per customer; asking again returns it", async () => {
      const res = await createVaRoute(postJson("/v1/virtual_accounts", key, { customer_id: verifiedId, reference: `va-${tag}` }));
      expect(res.status).toBe(201);
      const va = await json(res);
      vaId = va.id;
      expect(va).toMatchObject({ object: "virtual_account", customer_id: verifiedId, wallet_id: verifiedNgnWallet, status: "active", bank_name: "CheqPay Test Bank" });
      expect(va.account_number).toMatch(/^99\d{8}$/);
      const again = await createVaRoute(postJson("/v1/virtual_accounts", key, { customer_id: verifiedId }));
      expect(again.status).toBe(200);
      expect((await json(again)).id).toBe(vaId);
      expect((await json(await listVasRoute(api(`/v1/virtual_accounts?customer_id=${verifiedId}`, key)))).data).toHaveLength(1);
      expect((await getVaRoute(api(`/v1/virtual_accounts/${vaId}`, key), params({ id: vaId }))).status).toBe(200);
      expect((await getVaRoute(api(`/v1/virtual_accounts/${vaId}`, otherKey), params({ id: vaId }))).status).toBe(404);
    });
  });

  describe("deposits (sandbox)", () => {
    it("credits the customer's wallet less the plan's deposit fee, once per request", async () => {
      const before = await walletBalance(verifiedNgnWallet);
      const k = idem();
      const res = await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${vaId}/deposit`, key, { amount: 1_000_000, sender_name: "Chidi Okafor" }, k), params({ id: vaId }));
      expect(res.status).toBe(201);
      const tx = await json(res);
      const fee = Math.min(Math.floor((1_000_000 * PLAN_DEFAULTS.growth.depositFeeBps) / 10_000), PLAN_DEFAULTS.growth.depositFeeCapMinor);
      expect(tx).toMatchObject({ kind: "deposit", status: "successful", amount: 1_000_000, fee, wallet_id: verifiedNgnWallet, customer_id: verifiedId });
      expect(tx.details).toMatchObject({ virtual_account_id: vaId, payer: { name: "Chidi Okafor", account_number_last4: "6789" } });
      expect((await walletBalance(verifiedNgnWallet)) - before).toBe(BigInt(1_000_000 - fee));
      const replay = await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${vaId}/deposit`, key, { amount: 1_000_000, sender_name: "Chidi Okafor" }, k), params({ id: vaId }));
      expect((await json(replay)).id).toBe(tx.id);
      expect((await walletBalance(verifiedNgnWallet)) - before).toBe(BigInt(1_000_000 - fee));
      const events = await json(await listEventsRoute(api("/v1/events?type=deposit.received", key)));
      expect(events.data[0].data.object.id).toBe(tx.id);
    });

    it("works from the dashboard too, and only on your own test accounts", async () => {
      const ok = await sandboxDepositRoute(dashboard("/api/developer/sandbox/deposit", { virtual_account_id: vaId, amount: "2500" }));
      expect(ok.status).toBe(201);
      h.user = { id: other.id, email: other.email, aal: "aal2" };
      const theirs = await sandboxDepositRoute(dashboard("/api/developer/sandbox/deposit", { virtual_account_id: vaId, amount: "2500" }));
      expect(theirs.status).toBe(404);
    });
  });

  describe("transfers", () => {
    let mainNgn = "";
    let mainUsd = "";
    beforeAll(async () => {
      mainNgn = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "test", "NGN"))!.id);
      mainUsd = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "test", "USD"))!.id);
    });

    it("moves money between your wallets", async () => {
      const [a, b] = [await walletBalance(verifiedNgnWallet), await walletBalance(mainNgn)];
      const res = await transferRoute(postJson("/v1/transfers", key, { from_wallet_id: verifiedNgnWallet, to_wallet_id: mainNgn, amount: 100_000, reference: `t-${tag}` }));
      expect(res.status).toBe(201);
      expect(await json(res)).toMatchObject({ kind: "transfer", status: "successful", amount: 100_000, wallet_id: verifiedNgnWallet, counterparty_wallet_id: mainNgn });
      expect(a - (await walletBalance(verifiedNgnWallet))).toBe(100_000n);
      expect((await walletBalance(mainNgn)) - b).toBe(100_000n);
      const t = await prisma.$queryRawUnsafe<{ initiator_ip: string }[]>(`SELECT initiator_ip FROM dev_transactions WHERE reference = $1`, `t-${tag}`);
      expect(t[0].initiator_ip).toBe(IP);
    });

    it("refuses mixed currencies, overdrafts, others' wallets, reused references and frozen wallets", async () => {
      const go = async (body: Json) => json(await transferRoute(postJson("/v1/transfers", key, body)));
      expect((await go({ from_wallet_id: verifiedNgnWallet, to_wallet_id: mainUsd, amount: 1 })).error.code).toBe("currency_mismatch");
      expect((await go({ from_wallet_id: verifiedNgnWallet, to_wallet_id: mainNgn, amount: 9_000_000_000 })).error.code).toBe("insufficient_funds");
      const theirMain = toPublicId("wallet", (await getMainWallet(prisma, otherAcct.id, "test", "NGN"))!.id);
      expect((await go({ from_wallet_id: theirMain, to_wallet_id: mainNgn, amount: 1 })).error.code).toBe("not_found");
      expect((await go({ from_wallet_id: mainNgn, to_wallet_id: theirMain, amount: 1 })).error.code).toBe("not_found");
      expect((await go({ from_wallet_id: mainNgn, to_wallet_id: verifiedNgnWallet, amount: 1, reference: `t-${tag}` })).error.code).toBe("duplicate_reference");
      expect((await go({ from_wallet_id: mainNgn, to_wallet_id: mainNgn, amount: 1 })).error.param).toBe("to_wallet_id");
      await prisma.$executeRawUnsafe(`UPDATE dev_wallets SET status = 'frozen' WHERE id = $1::uuid`, fromPublicId("wallet", verifiedNgnWallet));
      expect((await go({ from_wallet_id: verifiedNgnWallet, to_wallet_id: mainNgn, amount: 1 })).error.code).toBe("wallet_frozen");
      // A frozen wallet still receives.
      expect((await go({ from_wallet_id: mainNgn, to_wallet_id: verifiedNgnWallet, amount: 1 })).status).toBe("successful");
      await prisma.$executeRawUnsafe(`UPDATE dev_wallets SET status = 'active' WHERE id = $1::uuid`, fromPublicId("wallet", verifiedNgnWallet));
    });

    it("never overdraws under 50 parallel transfers", async () => {
      // Give the customer exactly 30 transfers' worth.
      const each = 10_000;
      const now = await walletBalance(verifiedNgnWallet);
      await transferRoute(postJson("/v1/transfers", key, { from_wallet_id: verifiedNgnWallet, to_wallet_id: mainNgn, amount: Number(now) }));
      await transferRoute(postJson("/v1/transfers", key, { from_wallet_id: mainNgn, to_wallet_id: verifiedNgnWallet, amount: each * 30 }));
      const results = await Promise.all(
        Array.from({ length: 50 }, () => transferRoute(postJson("/v1/transfers", key, { from_wallet_id: verifiedNgnWallet, to_wallet_id: mainNgn, amount: each }))),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(30);
      expect(statuses.filter((s) => s !== 201).every((s) => s === 422)).toBe(true);
      expect(await walletBalance(verifiedNgnWallet)).toBe(0n);
      expect((await findLedgerMismatches()).filter((m) => m.account_id === acct.id)).toEqual([]);
    });
  });

  describe("conversions (sandbox)", () => {
    let mainNgn = "";
    let mainUsd = "";
    beforeAll(async () => {
      mainNgn = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "test", "NGN"))!.id);
      mainUsd = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "test", "USD"))!.id);
    });
    const quote = async (k = key, body: Json = { from_currency: "NGN", to_currency: "USD", amount: 1_600_000 }) =>
      json(await quoteRoute(postJson("/v1/fx/quotes", k, body)));

    it("quotes a price with the app's margin, then converts exactly that, once", async () => {
      const q = await quote();
      const gross = 1_600_000n / 1_600n;
      const fee = feeFromBps(gross, await getFxSideMarginBps("sell_usd"));
      expect(q).toMatchObject({ object: "fx_quote", from_currency: "NGN", to_currency: "USD", amount: 1_600_000, converted_amount: Number(gross - fee), fee: Number(fee), status: "open" });
      const [ngn, usd] = [await walletBalance(mainNgn), await walletBalance(mainUsd)];
      const k = idem();
      const res = await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: q.id, from_wallet_id: mainNgn, to_wallet_id: mainUsd }, k));
      expect(res.status).toBe(201);
      const tx = await json(res);
      expect(tx).toMatchObject({ kind: "conversion", status: "successful", currency: "NGN", amount: 1_600_000, details: { quote_id: q.id, to_currency: "USD", converted_amount: q.converted_amount } });
      expect(ngn - (await walletBalance(mainNgn))).toBe(1_600_000n);
      expect((await walletBalance(mainUsd)) - usd).toBe(BigInt(q.converted_amount));
      const replay = await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: q.id, from_wallet_id: mainNgn, to_wallet_id: mainUsd }, k));
      expect((await json(replay)).id).toBe(tx.id);
      const reuse = await json(await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: q.id, from_wallet_id: mainNgn, to_wallet_id: mainUsd })));
      expect(reuse.error.code).toBe("quote_used");
    });

    it("refuses an expired quote, another account's quote, mixed owners and wrong currencies", async () => {
      const q = await quote();
      await prisma.$executeRawUnsafe(`UPDATE dev_fx_quotes SET expires_at = now() - interval '1 second' WHERE id = $1::uuid`, fromPublicId("quote", q.id));
      expect((await json(await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: q.id, from_wallet_id: mainNgn, to_wallet_id: mainUsd })))).error.code).toBe("quote_expired");
      const theirs = await quote(otherKey);
      expect((await json(await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: theirs.id, from_wallet_id: mainNgn, to_wallet_id: mainUsd })))).error.code).toBe("not_found");
      const fresh = await quote();
      expect((await json(await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: fresh.id, from_wallet_id: mainNgn, to_wallet_id: verifiedUsdWallet })))).error.param).toBe("to_wallet_id");
      expect((await json(await convertRoute(postJson("/v1/fx/conversions", key, { quote_id: fresh.id, from_wallet_id: mainUsd, to_wallet_id: mainNgn })))).error.code).toBe("currency_mismatch");
      expect((await json(await quoteRoute(postJson("/v1/fx/quotes", key, { from_currency: "USD", to_currency: "USD", amount: 100 })))).error.code).toBe("validation_error");
    });
  });

  describe("events", () => {
    it("lists newest first, reads one, and never shows another developer's", async () => {
      const list = await json(await listEventsRoute(api("/v1/events?limit=5", key)));
      expect(list.data.length).toBeGreaterThan(0);
      const first = list.data[0];
      expect((await json(await getEventRoute(api(`/v1/events/${first.id}`, key), params({ id: first.id })))).id).toBe(first.id);
      expect((await getEventRoute(api(`/v1/events/${first.id}`, otherKey), params({ id: first.id }))).status).toBe(404);
      expect((await json(await listEventsRoute(api("/v1/events?type=nonsense", key)))).error.param).toBe("type");
    });
  });

  describe("webhooks", () => {
    let endpointId = "";
    let secret = "";

    it("refuses URLs that aren't public https, and needs 2FA for live endpoints", async () => {
      for (const url of ["http://hooks.acme.ng/x", "https://10.0.0.5/x", "https://169.254.169.254/latest", "https://localhost/x", "https://db.internal/x"]) {
        expect((await json(await createEndpointRoute(dashboard("/api/developer/webhooks", { mode: "test", url })))).code).toBe("invalid_url");
      }
      h.user.aal = "aal1";
      expect((await json(await createEndpointRoute(dashboard("/api/developer/webhooks", { mode: "live", url: "https://hooks.acme.ng/x" })))).code).toBe("mfa_required");
    });

    it("shows the signing secret once, and signs every delivery with it", async () => {
      const res = await createEndpointRoute(dashboard("/api/developer/webhooks", { mode: "test", url: "https://hooks.acme.ng/cheqpay" }));
      expect(res.status).toBe(201);
      const out = await json(res);
      endpointId = out.endpoint.id;
      secret = out.secret;
      expect(secret).toMatch(/^whsec_/);
      const list = await json(await listEndpointsRoute(dashboard("/api/developer/webhooks?mode=test", null, "GET")));
      expect(JSON.stringify(list)).not.toContain(secret);
      const stored = await prisma.$queryRawUnsafe<{ secret_enc: string }[]>(`SELECT secret_enc FROM dev_webhook_endpoints WHERE id = $1::uuid`, fromPublicId("webhook_endpoint", endpointId));
      expect(stored[0].secret_enc).not.toContain(secret.slice(6));
      await settleEmails();
      expect(h.emails.some((e) => e.subject.includes("webhook endpoint was added"))).toBe(true);

      const n = received.length;
      await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${vaId}/deposit`, key, { amount: 50_000 }), params({ id: vaId }));
      const got = await waitFor(async () => received.length, (len) => len > n);
      expect(got).toBeGreaterThan(n);
      const d = received[received.length - 1];
      expect(d.url).toBe("https://hooks.acme.ng/cheqpay");
      const event = JSON.parse(d.body);
      expect(event).toMatchObject({ object: "event", type: "deposit.received" });
      expect(d.headers["webhook-id"]).toBe(event.id);
      expect(verifyWebhookSignature(secret, { id: d.headers["webhook-id"], timestamp: d.headers["webhook-timestamp"], signature: d.headers["webhook-signature"] }, d.body)).toBe(true);
    });

    it("retries a failed delivery on the schedule, and Resend tries again now", async () => {
      receiverStatus = 500;
      const n = received.length;
      await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${vaId}/deposit`, key, { amount: 50_000 }), params({ id: vaId }));
      await waitFor(async () => received.length, (len) => len > n);
      const list = await waitFor(
        async () => (await json(await deliveriesRoute(dashboard("/x", null, "GET"), params({ id: endpointId })))).deliveries as Json[],
        (ds) => ds[0]?.attempts === 1,
      );
      const failed = list[0];
      expect(failed).toMatchObject({ status: "pending", attempts: 1, last_status_code: 500 });
      const wait = new Date(failed.next_attempt_at).getTime() - Date.now();
      expect(wait).toBeGreaterThan(40_000);
      expect(wait).toBeLessThan(70_000);
      receiverStatus = 200;
      const resent = await json(await resendRoute(dashboard("/x", {}), params({ id: failed.id })));
      expect(resent.delivery).toMatchObject({ status: "succeeded", attempts: 2, last_status_code: 200 });
      // Another developer can't resend it.
      h.user = { id: other.id, email: other.email, aal: "aal2" };
      expect((await resendRoute(dashboard("/x", {}), params({ id: failed.id }))).status).toBe(404);
      expect((await patchEndpointRoute(dashboard("/x", { enabled: false }, "PATCH"), params({ id: endpointId }))).status).toBe(404);
    });

    it("signs with both secrets for a day after a roll", async () => {
      const rolled = await json(await rollEndpointRoute(dashboard("/x", {}), params({ id: endpointId })));
      expect(rolled.secret).toMatch(/^whsec_/);
      expect(rolled.secret).not.toBe(secret);
      const ping = await json(await pingEndpointRoute(dashboard("/x", {}), params({ id: endpointId })));
      expect(ping.delivery).toMatchObject({ status: "succeeded", event_type: "ping" });
      const d = received[received.length - 1];
      const hdr = { id: d.headers["webhook-id"], timestamp: d.headers["webhook-timestamp"], signature: d.headers["webhook-signature"] };
      expect(hdr.signature.split(" ")).toHaveLength(2);
      expect(verifyWebhookSignature(rolled.secret, hdr, d.body)).toBe(true);
      expect(verifyWebhookSignature(secret, hdr, d.body)).toBe(true);
      secret = rolled.secret;
    });

    it("switches off an endpoint that has failed for three days, and tells the owner", async () => {
      receiverStatus = 503;
      await prisma.$executeRawUnsafe(`UPDATE dev_webhook_endpoints SET failing_since = now() - interval '4 days' WHERE id = $1::uuid`, fromPublicId("webhook_endpoint", endpointId));
      const n = received.length;
      await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${vaId}/deposit`, key, { amount: 50_000 }), params({ id: vaId }));
      await waitFor(async () => received.length, (len) => len > n);
      const rows = await waitFor(
        () => prisma.$queryRawUnsafe<{ status: string }[]>(`SELECT status FROM dev_webhook_endpoints WHERE id = $1::uuid`, fromPublicId("webhook_endpoint", endpointId)),
        (r) => r[0]?.status === "disabled",
      );
      expect(rows[0].status).toBe("disabled");
      await settleEmails();
      expect(h.emails.some((e) => e.subject.includes("switched off"))).toBe(true);
      const back = await json(await patchEndpointRoute(dashboard("/x", { enabled: true }, "PATCH"), params({ id: endpointId })));
      expect(back.endpoint).toMatchObject({ status: "enabled", failing_since: null });
    });
  });

  describe("live mode (the banking partner is mocked)", () => {
    let liveFront = "";
    let liveCustomer = "";
    let liveVa = "";
    let liveNgnMain = "";
    let liveUsdMain = "";

    beforeAll(async () => {
      await prisma.$executeRawUnsafe(`UPDATE dev_accounts SET status = 'approved', live_since = now(), reviewed_at = now() WHERE id = $1::uuid`, acct.id);
      invalidateKeyCache();
      acct = (await prisma.$queryRawUnsafe<AccountRow[]>(`SELECT * FROM dev_accounts WHERE id = $1::uuid`, acct.id))[0];
      await prisma.$transaction(async (db) => {
        await ensureMainWallets(db, acct.id, "live");
        const w = (await getMainWallet(db, acct.id, "live", "NGN"))!;
        const id = await insertTransaction(db, { accountId: acct.id, mode: "live", kind: "adjustment", status: "successful", currency: "NGN", amountMinor: 50_000_000n, walletId: w.id });
        await applyLegs(db, { accountId: acct.id, mode: "live" }, id, "NGN", [{ walletId: w.id, amountMinor: 50_000_000n, kind: "adjustment" }]);
      });
      liveNgnMain = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "live", "NGN"))!.id);
      liveUsdMain = toPublicId("wallet", (await getMainWallet(prisma, acct.id, "live", "USD"))!.id);
      liveKey = (await createApiKey(acct, { mode: "live", label: "prod" })).secret;
      liveFront = (await json(await upload(liveKey))).id;
    });

    it("verifies through the partner: enrolment, then the ID document over a signed link", async () => {
      h.enroll.mockResolvedValueOnce({ id: `mpl_cus_${tag}`, tier: 1 });
      h.tier2.mockResolvedValueOnce({ id: `mpl_cus_${tag}`, status: "SUCCESS" });
      const body = customerBody(liveFront);
      const res = await createCustomerRoute(postJson("/v1/customers", liveKey, body));
      expect(res.status).toBe(201);
      const created = await json(res);
      liveCustomer = created.id;
      expect(created).toMatchObject({ livemode: true, kyc: { status: "pending" } });
      const done = await waitFor(
        async () => json(await getCustomerRoute(api(`/v1/customers/${liveCustomer}`, liveKey), params({ id: liveCustomer }))),
        (c) => c.kyc.status !== "pending",
      );
      expect(done.kyc.status).toBe("verified");
      const sent = h.enroll.mock.calls[0][0];
      expect(sent).toMatchObject({ identification_number: body.bvn, dob: "12-04-1990", phone: { phone_country_code: "+234", phone_number: "8031234567" }, country: "NG" });
      const link = sent.identity.image as string;
      expect(link).toMatch(/^https:\/\/api\.cheqpay\.test\/api\/dev-files\/[0-9a-f-]{36}\?exp=\d+&sig=/);
      expect(h.tier2.mock.calls[0][0]).toMatchObject({ customer_id: `mpl_cus_${tag}`, identity: { type: "NIN", number: body.identity.number } });

      // The partner can fetch the document with the link — and nothing else can.
      const id = /dev-files\/([^?]+)/.exec(link)![1];
      const ok = await devFileRoute(new Request(link), params({ id }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("no-store");
      expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
      expect((await devFileRoute(new Request(link.replace(/sig=./, "sig=0")), params({ id }))).status).toBe(404);
      const expired = link.replace(/exp=\d+/, `exp=${Math.floor(Date.now() / 1000) - 10}`);
      expect((await devFileRoute(new Request(expired), params({ id }))).status).toBe(404);
      // A business document is never served, even with a valid signature.
      const { signDevFileUrl } = await import("./files");
      const cac = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM dev_files WHERE purpose = 'business_document' LIMIT 1`);
      if (cac[0]) {
        const url = signDevFileUrl(cac[0].id, 60, "https://api.cheqpay.test");
        expect((await devFileRoute(new Request(url), params({ id: cac[0].id }))).status).toBe(404);
      }
    });

    it("rejects with a generic reason when the partner refuses, and retries when it's down", async () => {
      h.enroll.mockRejectedValueOnce(new MapleradError("BVN 12345678901 belongs to OKONKWO JOHN, DOB 1971-01-01", 400, { message: "mismatch" }));
      const refused = await json(await createCustomerRoute(postJson("/v1/customers", liveKey, customerBody(await fileId(liveKey)))));
      const r = await waitFor(
        async () => json(await getCustomerRoute(api(`/v1/customers/${refused.id}`, liveKey), params({ id: refused.id }))),
        (c) => c.kyc.status !== "pending",
      );
      expect(r.kyc.reason.code).toBe("identity_mismatch");
      expect(JSON.stringify(r)).not.toMatch(/OKONKWO|1971/);

      h.enroll.mockRejectedValueOnce(new MapleradError("Service Unavailable", 503));
      const down = await json(await createCustomerRoute(postJson("/v1/customers", liveKey, customerBody(await fileId(liveKey)))));
      const row = await waitFor(
        () => prisma.$queryRawUnsafe<{ kyc_status: string; kyc_attempts: number; kyc_next_attempt_at: Date }[]>(
          `SELECT kyc_status, kyc_attempts, kyc_next_attempt_at FROM dev_customers WHERE id = $1::uuid`,
          fromPublicId("customer", down.id),
        ),
        (rows) => rows[0]?.kyc_attempts === 1 && rows[0].kyc_next_attempt_at !== null && rows[0].kyc_next_attempt_at.getTime() - Date.now() < 6 * 60_000,
      );
      expect(row[0].kyc_status).toBe("pending");
      const inMs = row[0].kyc_next_attempt_at.getTime() - Date.now();
      expect(inMs).toBeGreaterThan(4 * 60_000);
    });

    it("declines an identity that belongs to a blocked CheqPay user", async () => {
      const blockedBvn = bvn();
      await prisma.user.create({ data: { email: `blocked-${tag}@x.test`, status: UserStatus.BLOCKED, bvnFingerprint: fingerprintPii(blockedBvn) } });
      const before = h.enroll.mock.calls.length;
      const c = await json(await createCustomerRoute(postJson("/v1/customers", liveKey, customerBody(await fileId(liveKey), { bvn: blockedBvn }))));
      const r = await waitFor(
        async () => json(await getCustomerRoute(api(`/v1/customers/${c.id}`, liveKey), params({ id: c.id }))),
        (x) => x.kyc.status !== "pending",
      );
      expect(r.kyc.reason.code).toBe("verification_declined");
      expect(h.enroll.mock.calls.length).toBe(before); // the partner was never asked
    });

    it("opens a live virtual account at the partner, adopting one it already opened", async () => {
      h.listVAs.mockResolvedValueOnce([]);
      const nuban = `0${String(randomInt(0, 1e9)).padStart(9, "0")}`;
      h.createVA.mockResolvedValueOnce({ id: `mpl_va_${tag}`, account_number: nuban, bank_name: "Partner Bank", account_name: "ADA OBI", currency: "NGN" });
      const res = await createVaRoute(postJson("/v1/virtual_accounts", liveKey, { customer_id: liveCustomer }));
      expect(res.status).toBe(201);
      const va = await json(res);
      liveVa = va.id;
      expect(va).toMatchObject({ account_number: nuban, bank_name: "Partner Bank", livemode: true });
      expect(h.createVA).toHaveBeenCalledWith({ customerId: `mpl_cus_${tag}`, currency: "NGN" });
    });

    it("credits a verified collection to the customer's wallet exactly once", async () => {
      const txId = `mpl_tx_${tag}`;
      const collection = {
        id: txId,
        status: "SUCCESS",
        entry: "CREDIT",
        type: "COLLECTION",
        amount: 5_000_000,
        currency: "NGN",
        account_id: `mpl_va_${tag}`,
        customer: { id: `mpl_cus_${tag}` },
        source: { account_name: "TUNDE BAKARE", account_number: "0099887766", bank_name: "Some Bank" },
      };
      h.verifyTx.mockResolvedValue(collection);
      const wallet = (await json(await getVaRoute(api(`/v1/virtual_accounts/${liveVa}`, liveKey), params({ id: liveVa })))).wallet_id;
      const before = await walletBalance(wallet);
      expect((await settleCollectionById(txId)).outcome).toBe("credited");
      expect((await settleCollectionById(txId)).outcome).toBe("duplicate");
      const fee = Math.min(Math.floor((5_000_000 * PLAN_DEFAULTS.growth.depositFeeBps) / 10_000), PLAN_DEFAULTS.growth.depositFeeCapMinor);
      expect((await walletBalance(wallet)) - before).toBe(BigInt(5_000_000 - fee));

      // A "deposit" the partner says didn't settle is not money.
      h.verifyTx.mockResolvedValue({ ...collection, id: `${txId}_forged`, status: "FAILED" });
      expect((await settleCollectionById(`${txId}_forged`)).outcome).toBe("ignored");
      // One for an account nobody owns stays unmatched for a human.
      h.verifyTx.mockResolvedValue({ ...collection, id: `${txId}_stray`, account_id: "mpl_va_nobody", customer: { id: "mpl_cus_nobody" } });
      expect((await settleCollectionById(`${txId}_stray`)).outcome).toBe("unmatched");
      expect((await walletBalance(wallet)) - before).toBe(BigInt(5_000_000 - fee));
    });

    it("finds a deposit whose webhook never came", async () => {
      const missed = `mpl_tx_missed_${tag}`;
      h.customerTxs.mockResolvedValue({ deposit: [{ transaction_id: `mpl_tx_${tag}` }, { transaction_id: missed }], withdrawal: [] });
      h.verifyTx.mockImplementation(async (id: string) => ({
        id,
        status: "SUCCESS",
        entry: "CREDIT",
        type: "COLLECTION",
        amount: 200_000,
        currency: "NGN",
        account_id: `mpl_va_${tag}`,
        customer: { id: `mpl_cus_${tag}` },
      }));
      await prisma.$executeRawUnsafe(`UPDATE dev_virtual_accounts SET deposits_checked_at = NULL WHERE id = $1::uuid`, fromPublicId("virtual_account", liveVa));
      const out = await reconcileLiveDeposits(500);
      expect(out.credited).toBe(1);
      const again = await reconcileLiveDeposits(500);
      expect(again.credited).toBe(0);
      h.verifyTx.mockReset();
    });

    it("converts on the live rail: refund on refusal, hold on an unknown outcome, credit what settled", async () => {
      h.providerBalance.mockResolvedValue(10_000_000_000n);
      const margin = await getFxSideMarginBps("sell_usd");
      const liveQuote = async (ref: string) => {
        h.quoteFx.mockResolvedValueOnce({ reference: ref, source: { currency: "NGN", amount: 1_600_000 }, target: { currency: "USD", amount: 1_000 }, rate: 1 / 1600 });
        return json(await quoteRoute(postJson("/v1/fx/quotes", liveKey, { from_currency: "NGN", to_currency: "USD", amount: 1_600_000 })));
      };
      const convert = (q: Json) => convertRoute(postJson("/v1/fx/conversions", liveKey, { quote_id: q.id, from_wallet_id: liveNgnMain, to_wallet_id: liveUsdMain }));

      const start = await walletBalance(liveNgnMain);
      h.exchangeFx.mockRejectedValueOnce(new MapleradError("NGN exchanges are not enabled", 400));
      const refused = await convert(await liveQuote("q-refused"));
      expect(refused.status).toBe(201);
      expect(await json(refused)).toMatchObject({ status: "failed", failure: { code: "conversion_refused" } });
      expect(await walletBalance(liveNgnMain)).toBe(start);

      h.exchangeFx.mockRejectedValueOnce(new MapleradError("socket hang up", 0));
      const unknown = await convert(await liveQuote("q-unknown"));
      expect(unknown.status).toBe(202);
      expect((await json(unknown)).status).toBe("pending");
      expect(start - (await walletBalance(liveNgnMain))).toBe(1_600_000n); // held, not refunded

      const usd = await walletBalance(liveUsdMain);
      h.exchangeFx.mockResolvedValueOnce({ source: { currency: "NGN", amount: 1_600_000 }, target: { currency: "USD", amount: 1_010 }, rate: 1 });
      const settled = await convert(await liveQuote("q-ok"));
      expect(settled.status).toBe(201);
      const credit = 1_010n - feeFromBps(1_010n, margin);
      expect((await walletBalance(liveUsdMain)) - usd).toBe(credit);
      expect(await json(settled)).toMatchObject({ status: "successful", details: { converted_amount: Number(credit) } });
    });

    it("keeps test helpers and test objects away from live keys, and live objects away from test keys", async () => {
      expect((await testDepositRoute(postJson(`/v1/test_helpers/virtual_accounts/${liveVa}/deposit`, liveKey, { amount: 100 }), params({ id: liveVa }))).status).toBe(404);
      expect((await getCustomerRoute(api(`/v1/customers/${liveCustomer}`, key), params({ id: liveCustomer }))).status).toBe(404);
      expect((await getCustomerRoute(api(`/v1/customers/${verifiedId}`, liveKey), params({ id: verifiedId }))).status).toBe(404);
      expect((await getWalletRoute(api(`/v1/wallets/${liveNgnMain}`, key), params({ id: liveNgnMain }))).status).toBe(404);
    });
  });

  describe("what never leaves the server", () => {
    it("no BVN, ID number or date of birth in request logs, events or webhook bodies", async () => {
      await sleep(300);
      const customers = await prisma.$queryRawUnsafe<{ bvn_enc: string; id_number_enc: string; dob_enc: string }[]>(
        `SELECT bvn_enc, id_number_enc, dob_enc FROM dev_customers WHERE account_id = $1::uuid AND bvn_enc IS NOT NULL`,
        acct.id,
      );
      const { decryptPii } = await import("../pii");
      const secrets = customers.flatMap((c) => [decryptPii(c.bvn_enc), decryptPii(c.id_number_enc)]).filter((s) => s.length >= 8);
      expect(secrets.length).toBeGreaterThan(5);
      const logs = await prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT row_to_json(l)::text AS row FROM dev_request_logs l WHERE account_id = $1::uuid`, acct.id);
      const events = await prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT data::text AS row FROM dev_events WHERE account_id = $1::uuid`, acct.id);
      const haystack = [...logs.map((l) => l.row), ...events.map((e) => e.row), ...received.map((r) => r.body)].join("\n");
      for (const s of secrets) expect(haystack).not.toContain(s);
      expect(haystack).not.toContain("1990-04-12");
      expect(haystack).not.toContain("Marina Road");
    });
  });
});

async function settleEmails() {
  await sleep(250);
}
