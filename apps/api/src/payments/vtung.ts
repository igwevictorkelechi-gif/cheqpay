// apps/api/src/payments/vtung.ts
//
// vtu.ng: the bills rail (airtime, data, electricity, cable TV).
//
//   Base     https://vtu.ng/wp-json
//   Auth     POST /jwt-auth/v1/token {username, password} -> { token } (7 days)
//   Buy      POST /api/v2/{airtime|data|electricity|tv} with our request_id
//   Check    POST /api/v2/requery {request_id}
//   Verify   POST /api/v2/verify-customer {customer_id, service_id, variation_id?}
//   Plans    GET  /api/v2/variations/{data|tv}?service_id=  (public)
//
// Two things shape this file.
//
// 1. Only the NEWEST token is valid — every login invalidates the last. On
//    serverless each instance logging in for itself would knock the others out
//    in turn. So the token lives in platform_settings, shared by all instances,
//    and a re-login happens under a Postgres advisory lock: whoever gets the
//    lock first logs in, everyone after it re-reads and uses that token.
//
// 2. A purchase's top-level `code` is "success" even while the order is still
//    processing; the real state is data.status. And money is only ever handed
//    back on an explicit refusal: a timeout, a 5xx or a reply we can't read is
//    PENDING, settled later by the webhook or a requery — never refunded on a
//    guess, because the provider may well have delivered.

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@cheqpay/db";
import {
  BillPaymentError,
  type BillPayInput,
  type BillPayResult,
  type BillValidateInput,
  type BillValidateResult,
  type ProviderBillPlan,
} from "./types";

export const VTUNG_BASE = "https://vtu.ng/wp-json";
const TOKEN_KEY = "vtung_token";
const TOKEN_MAX_AGE_MS = 6 * 86_400_000; // refreshed a day before vtu.ng's 7-day expiry
const TIMEOUT_MS = 25_000;

export type BillQueryStatus = "successful" | "failed" | "pending" | "not_found";
export interface BillQueryResult {
  status: BillQueryStatus;
  providerStatus: string | null;
  token?: string | null;
}

interface StoredToken {
  token: string;
  at: number;
}

/** vtu.ng's order status → ours. Anything we don't recognise is still pending. */
export function mapVtuStatus(raw: unknown): "successful" | "failed" | "pending" {
  const s = String(raw ?? "").toLowerCase();
  if (s.startsWith("completed") || s === "successful" || s === "success" || s === "delivered") return "successful";
  if (s.startsWith("refunded") || s.startsWith("failed") || s.startsWith("cancelled") || s.startsWith("canceled") || s === "reversed") {
    return "failed";
  }
  return "pending";
}

/** 08031234567 for any common way of writing a Nigerian mobile number. */
export function nigerianPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("234") && d.length === 13) return `0${d.slice(3)}`;
  if (d.length === 10) return `0${d}`;
  return d;
}

/** The prepaid token, whichever field this order type carries it in. */
function tokenFrom(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  for (const k of ["token", "Token", "purchased_code", "meter_token", "electricity_token"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.replace(/^token\s*:\s*/i, "").trim();
  }
  return null;
}

/** "ikeja-electric:prepaid" → service_id + variation_id. */
function splitBiller(code: string | undefined): { serviceId: string; variation: string | undefined } {
  const [serviceId, variation] = String(code ?? "").split(":");
  return { serviceId, variation: variation || undefined };
}

/** "₦1,200.50" / 1200.5 / "1200" → kobo, or null. */
function toKobo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Verify a vtu.ng webhook. The signature is HMAC-SHA256 of the JSON body keyed
 * with the account PIN, in X-Signature. Checked against the raw bytes first and
 * the compact re-serialisation second (vtu.ng signs compact JSON), so neither
 * whitespace nor key order on the wire can make a genuine event fail.
 */
export function verifyVtuSignature(rawBody: string, signature: string | null, pin: string | undefined): boolean {
  if (!signature || !pin) return false;
  const sig = signature.trim().toLowerCase().replace(/^sha256=/, "");
  const candidates = [rawBody];
  try {
    candidates.push(JSON.stringify(JSON.parse(rawBody)));
  } catch {
    return false;
  }
  return candidates.some((body) => {
    const expected = createHmac("sha256", pin).update(body).digest("hex");
    return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  });
}

/** We never reached the point of sending the order (login/token trouble). */
export class VtuNotSentError extends Error {}

export class VtuNgProvider {
  readonly name = "vtung";

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly store: TokenStore = dbTokenStore,
  ) {}

  // -------------------------------------------------------------------------
  // Auth

  private async login(): Promise<string> {
    const res = await this.fetchImpl(`${VTUNG_BASE}/jwt-auth/v1/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
    if (!res.ok || !body?.token) {
      console.error(`[vtung] login refused (${res.status}): ${body?.message ?? "no token"}`);
      throw new Error("vtu.ng login failed");
    }
    return body.token;
  }

  /** A token every instance agrees on. `stale` is the one that was just rejected. */
  private async token(stale?: string): Promise<string> {
    const current = await this.store.read();
    if (current && current.token !== stale && Date.now() - current.at < TOKEN_MAX_AGE_MS) return current.token;
    return this.store.refresh(stale, () => this.login());
  }

  // -------------------------------------------------------------------------
  // HTTP

  private async call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; auth?: boolean },
  ): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const send = async (token?: string) => {
      const res = await this.fetchImpl(`${VTUNG_BASE}${path}`, {
        method: init.method,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      return { status: res.status, body };
    };
    if (!init.auth) return send();
    let token: string;
    try {
      token = await this.token();
    } catch (err) {
      throw new VtuNotSentError(err instanceof Error ? err.message : String(err));
    }
    let r = await send(token);
    if (isAuthFailure(r.status, r.body)) {
      // Another instance (or vtu.ng's own expiry) retired our token: take the
      // fresh one, once.
      // The first attempt was refused as unauthorised, so no order exists yet.
      try {
        token = await this.token(token);
      } catch (err) {
        throw new VtuNotSentError(err instanceof Error ? err.message : String(err));
      }
      r = await send(token);
    }
    return r;
  }

  // -------------------------------------------------------------------------
  // Bills

  async payBill(input: BillPayInput): Promise<BillPayResult> {
    const { serviceId, variation } = splitBiller(input.billerCode);
    if (!serviceId) throw new BillPaymentError("No vtu.ng service id for this biller", "This biller isn't available right now.");
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BillPaymentError("Invalid bill amount", "Amount must be a positive number");

    let path: string;
    let body: Record<string, unknown>;
    switch (input.service) {
      case "airtime":
        path = "/api/v2/airtime";
        body = { request_id: input.reference, phone: nigerianPhone(input.customer), service_id: serviceId, amount: Math.round(amount) };
        break;
      case "data":
        if (!input.planCode) throw new BillPaymentError("Missing data plan", "Pick a data plan.");
        path = "/api/v2/data";
        body = { request_id: input.reference, phone: nigerianPhone(input.customer), service_id: serviceId, variation_id: input.planCode };
        break;
      case "electricity":
        path = "/api/v2/electricity";
        body = {
          request_id: input.reference,
          customer_id: input.customer.trim(),
          service_id: serviceId,
          variation_id: variation ?? "prepaid",
          amount: Math.round(amount),
        };
        break;
      case "cabletv":
        if (!input.planCode) throw new BillPaymentError("Missing TV plan", "Pick a TV plan.");
        path = "/api/v2/tv";
        body = { request_id: input.reference, customer_id: input.customer.trim(), service_id: serviceId, variation_id: input.planCode };
        break;
      default:
        throw new BillPaymentError(`${input.service} is not offered`, `${input.service} isn't available.`);
    }

    let r: { status: number; body: Record<string, unknown> | null };
    try {
      r = await this.call(path, { method: "POST", body, auth: true });
    } catch (err) {
      if (err instanceof VtuNotSentError) {
        throw new BillPaymentError("Couldn't sign in to vtu.ng", "Bill payments are briefly unavailable. Please try again shortly.");
      }
      // Timeout or network failure after sending: the order may exist. Pending.
      console.error(`[vtung] ${path} no reply for ${input.reference}:`, err instanceof Error ? err.message : err);
      return { providerRef: input.reference, status: "pending" };
    }

    const data = (r.body?.data ?? undefined) as Record<string, unknown> | undefined;
    const code = String(r.body?.code ?? "").toLowerCase();
    const message = typeof r.body?.message === "string" ? r.body.message : "";

    if (r.status >= 500 || !r.body) {
      console.error(`[vtung] ${path} ${r.status} for ${input.reference}: unreadable reply — left pending`);
      return { providerRef: input.reference, status: "pending" };
    }
    if (data && data.status !== undefined && data.status !== null && data.status !== "") {
      // An order exists (whatever the top-level code says): its status rules.
      return { providerRef: input.reference, status: mapVtuStatus(data.status), token: tokenFrom(data) };
    }
    if (code === "success") {
      // Accepted but no readable order status: settle it later.
      return { providerRef: input.reference, status: "pending" };
    }
    if (/duplicate|already exists|already been used/i.test(message)) {
      // Our own request_id is already an order there: it went through on an
      // earlier attempt. Its fate is learnt by requery, not guessed.
      return { providerRef: input.reference, status: "pending" };
    }
    // An explicit refusal before any order was placed (insufficient balance,
    // invalid number, plan unavailable…): safe to refund.
    console.error(`[vtung] ${path} refused ${input.reference} (${r.status} ${code}): ${message}`);
    throw new BillPaymentError(`vtu.ng refused the ${input.service} purchase`, message || "The provider declined this purchase.", r.status);
  }

  async queryBill(reference: string): Promise<BillQueryResult> {
    const r = await this.call("/api/v2/requery", { method: "POST", body: { request_id: reference }, auth: true });
    const data = (r.body?.data ?? undefined) as Record<string, unknown> | undefined;
    const code = String(r.body?.code ?? "").toLowerCase();
    if (code === "success" && data) {
      return { status: mapVtuStatus(data.status), providerStatus: String(data.status ?? ""), token: tokenFrom(data) };
    }
    const message = String(r.body?.message ?? "");
    if (r.status === 404 || /not found|no order|does not exist|invalid request/i.test(message)) {
      return { status: "not_found", providerStatus: null };
    }
    throw new Error(`vtu.ng requery ${r.status}: ${message || "no answer"}`);
  }

  async validateBillCustomer(input: BillValidateInput): Promise<BillValidateResult> {
    const { serviceId, variation } = splitBiller(input.billerCode);
    if (!serviceId) return { valid: false };
    const r = await this.call("/api/v2/verify-customer", {
      method: "POST",
      body: { customer_id: input.customer.trim(), service_id: serviceId, ...(variation ? { variation_id: variation } : {}) },
      auth: true,
    });
    const data = (r.body?.data ?? undefined) as Record<string, unknown> | undefined;
    if (String(r.body?.code ?? "").toLowerCase() !== "success" || !data) return { valid: false };
    const name = data.customer_name ?? data.name ?? data.Customer_Name;
    return { valid: true, customerName: typeof name === "string" ? name.trim() : undefined };
  }

  async listBillPlans(service: "data" | "cabletv", billerCode: string): Promise<ProviderBillPlan[]> {
    const { serviceId } = splitBiller(billerCode);
    const kind = service === "data" ? "data" : "tv";
    const r = await this.call(`/api/v2/variations/${kind}?service_id=${encodeURIComponent(serviceId)}`, { method: "GET" });
    const rows = Array.isArray(r.body?.data) ? (r.body!.data as Record<string, unknown>[]) : [];
    if (!rows.length && r.status >= 400) throw new Error(`vtu.ng variations ${r.status}`);
    return plansFromVariations(rows, serviceId);
  }

  /** Our vtu.ng wallet balance in naira, for the admin panel. */
  async balance(): Promise<number | null> {
    const r = await this.call("/api/v2/balance", { method: "GET", auth: true });
    const data = (r.body?.data ?? undefined) as Record<string, unknown> | undefined;
    const kobo = toKobo(data?.balance ?? data?.wallet_balance);
    return kobo === null ? (data && Number(data.balance) === 0 ? 0 : null) : kobo / 100;
  }
}

/** vtu.ng variation rows → our plans; unavailable or unpriced rows are dropped. */
export function plansFromVariations(rows: Record<string, unknown>[], serviceId: string): ProviderBillPlan[] {
  const out: ProviderBillPlan[] = [];
  for (const v of rows) {
    if (v.service_id !== undefined && String(v.service_id) !== serviceId) continue;
    const avail = String(v.availability ?? "available").toLowerCase();
    if (avail.startsWith("unavail")) continue;
    const code = v.variation_id ?? v.id;
    const name = v.data_plan ?? v.package_bouquet ?? v.name ?? v.variation_name;
    const kobo = toKobo(v.price ?? v.reseller_price);
    if (code === undefined || code === null || !name || kobo === null) continue;
    out.push({ code: String(code), name: String(name).trim(), amountMinor: kobo });
  }
  return out;
}

function isAuthFailure(status: number, body: Record<string, unknown> | null): boolean {
  if (status === 401) return true;
  const code = String(body?.code ?? "");
  return status === 403 && /jwt|token|auth/i.test(code);
}

// ---------------------------------------------------------------------------
// The shared token

export interface TokenStore {
  read(): Promise<StoredToken | null>;
  /** Replace `stale` with a fresh login — at most one login across instances. */
  refresh(stale: string | undefined, login: () => Promise<string>): Promise<string>;
}

const LOCK_ID = 7_412_011; // arbitrary, unique to this lock

export const dbTokenStore: TokenStore = {
  async read() {
    const row = await prisma.platformSetting.findUnique({ where: { key: TOKEN_KEY } });
    if (!row) return null;
    try {
      const v = JSON.parse(row.value) as StoredToken;
      return typeof v.token === "string" && typeof v.at === "number" ? v : null;
    } catch {
      return null;
    }
  },
  async refresh(stale, login) {
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LOCK_ID})`);
        const row = await tx.platformSetting.findUnique({ where: { key: TOKEN_KEY } });
        if (row) {
          try {
            const v = JSON.parse(row.value) as StoredToken;
            // Someone else refreshed while we waited for the lock: use theirs.
            if (v.token && v.token !== stale && Date.now() - v.at < TOKEN_MAX_AGE_MS) return v.token;
          } catch {
            /* corrupt row: replaced below */
          }
        }
        const token = await login();
        const value = JSON.stringify({ token, at: Date.now() } satisfies StoredToken);
        await tx.platformSetting.upsert({
          where: { key: TOKEN_KEY },
          create: { key: TOKEN_KEY, value, updatedBy: "system:vtung" },
          update: { value, updatedBy: "system:vtung" },
        });
        return token;
      },
      { timeout: 40_000, maxWait: 30_000 },
    );
  },
};
