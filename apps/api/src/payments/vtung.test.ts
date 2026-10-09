import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BillPaymentError } from "./types";
import {
  VtuNgProvider,
  mapVtuStatus,
  nigerianPhone,
  plansFromVariations,
  verifyVtuSignature,
  type TokenStore,
} from "./vtung";

// A token store with no database: one shared token, refreshed under a "lock".
function memoryStore(initial?: string): TokenStore & { logins: number } {
  let current = initial ? { token: initial, at: Date.now() } : null;
  const store = {
    logins: 0,
    async read() {
      return current;
    },
    async refresh(stale: string | undefined, login: () => Promise<string>) {
      if (current && current.token !== stale) return current.token;
      store.logins += 1;
      current = { token: await login(), at: Date.now() };
      return current.token;
    },
  };
  return store;
}

type Reply = { status?: number; body?: unknown } | Error;
/** A fake fetch that answers each path from a queue of replies. */
function fakeFetch(routes: Record<string, Reply[]>) {
  const calls: { path: string; auth: string | null; body: unknown }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/wp-json", "");
    const headers = new Headers(init?.headers);
    calls.push({ path, auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    const queue = routes[path];
    const reply = queue?.length ? (queue.length > 1 ? queue.shift()! : queue[0]) : { status: 404, body: { message: "no route" } };
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const login = { "/jwt-auth/v1/token": [{ body: { token: "tok-1" } }] };
const buy = (over: Partial<Parameters<VtuNgProvider["payBill"]>[0]> = {}) => ({
  service: "airtime",
  billerCode: "mtn",
  customer: "+234 803 000 0000",
  amount: "100",
  reference: "tx-1",
  ...over,
});

describe("vtu.ng status and inputs", () => {
  it("reads order status, not the top-level code", () => {
    expect(mapVtuStatus("completed-api")).toBe("successful");
    expect(mapVtuStatus("processing-api")).toBe("pending");
    expect(mapVtuStatus("refunded")).toBe("failed");
    expect(mapVtuStatus("failed-api")).toBe("failed");
    expect(mapVtuStatus("something-new")).toBe("pending");
    expect(mapVtuStatus(undefined)).toBe("pending");
  });

  it("writes Nigerian numbers the way vtu.ng expects", () => {
    expect(nigerianPhone("+234 803 000 0000")).toBe("08030000000");
    expect(nigerianPhone("8030000000")).toBe("08030000000");
    expect(nigerianPhone("0803-000-0000")).toBe("08030000000");
  });

  it("turns variations into plans and drops unavailable or unpriced ones", () => {
    const plans = plansFromVariations(
      [
        { variation_id: "1", service_id: "mtn", data_plan: "MTN 1GB · 30 days", price: "500" },
        { variation_id: "2", service_id: "mtn", data_plan: "MTN 2GB", price: 1000, availability: "Unavailable" },
        { variation_id: "3", service_id: "glo", data_plan: "Glo 1GB", price: "400" },
        { variation_id: "4", service_id: "mtn", data_plan: "No price" },
      ],
      "mtn",
    );
    expect(plans).toEqual([{ code: "1", name: "MTN 1GB · 30 days", amountMinor: 50_000 }]);
  });
});

describe("vtu.ng webhook signature", () => {
  const pin = "1234";
  const body = JSON.stringify({ request_id: "tx-1", status: "completed-api" });
  const sign = (b: string) => createHmac("sha256", pin).update(b).digest("hex");

  it("accepts a genuine event and rejects tampering, a wrong PIN or no signature", () => {
    expect(verifyVtuSignature(body, sign(body), pin)).toBe(true);
    expect(verifyVtuSignature(body.replace("completed", "refunded"), sign(body), pin)).toBe(false);
    expect(verifyVtuSignature(body, createHmac("sha256", "9999").update(body).digest("hex"), pin)).toBe(false);
    expect(verifyVtuSignature(body, null, pin)).toBe(false);
    expect(verifyVtuSignature(body, sign(body), undefined)).toBe(false);
  });

  it("tolerates whitespace on the wire when vtu.ng signed compact JSON", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyVtuSignature(pretty, sign(body), pin)).toBe(true);
  });
});

describe("vtu.ng purchases never refund on a guess", () => {
  it("a completed order is successful and carries the meter token", async () => {
    const f = fakeFetch({
      ...login,
      "/api/v2/electricity": [{ body: { code: "success", data: { status: "completed-api", order_id: 9, token: "Token : 1234-5678" } } }],
    });
    const vtu = new VtuNgProvider("u", "p", f.impl, memoryStore());
    const r = await vtu.payBill(buy({ service: "electricity", billerCode: "ikeja-electric:prepaid", customer: "45160826181", amount: "1000" }));
    expect(r).toEqual({ providerRef: "tx-1", status: "successful", token: "1234-5678" });
    expect(f.calls.at(-1)?.body).toEqual({
      request_id: "tx-1",
      customer_id: "45160826181",
      service_id: "ikeja-electric",
      variation_id: "prepaid",
      amount: 1000,
    });
    expect(f.calls.at(-1)?.auth).toBe("Bearer tok-1");
  });

  it("a processing order, a timeout, a 5xx and a duplicate request_id are all pending", async () => {
    for (const reply of [
      { body: { code: "success", data: { status: "processing-api" } } },
      new Error("The operation was aborted due to timeout"),
      { status: 502, body: null },
      { status: 400, body: { code: "failure", message: "Duplicate request_id" } },
    ]) {
      const f = fakeFetch({ ...login, "/api/v2/airtime": [reply as Reply] });
      const vtu = new VtuNgProvider("u", "p", f.impl, memoryStore());
      await expect(vtu.payBill(buy())).resolves.toMatchObject({ status: "pending", providerRef: "tx-1" });
    }
  });

  it("an explicit refusal is a BillPaymentError (safe to refund)", async () => {
    const f = fakeFetch({ ...login, "/api/v2/airtime": [{ status: 400, body: { code: "failure", message: "Insufficient wallet balance" } }] });
    const vtu = new VtuNgProvider("u", "p", f.impl, memoryStore());
    await expect(vtu.payBill(buy())).rejects.toBeInstanceOf(BillPaymentError);
  });

  it("a login failure means nothing was sent, so it is a refusal too", async () => {
    const f = fakeFetch({ "/jwt-auth/v1/token": [{ status: 403, body: { message: "bad password" } }] });
    const vtu = new VtuNgProvider("u", "p", f.impl, memoryStore());
    await expect(vtu.payBill(buy())).rejects.toBeInstanceOf(BillPaymentError);
    expect(f.calls.some((c) => c.path === "/api/v2/airtime")).toBe(false);
  });

  it("data and TV need the plan the user picked", async () => {
    const vtu = new VtuNgProvider("u", "p", fakeFetch(login).impl, memoryStore());
    await expect(vtu.payBill(buy({ service: "data" }))).rejects.toBeInstanceOf(BillPaymentError);
    await expect(vtu.payBill(buy({ service: "cabletv", billerCode: "gotv" }))).rejects.toBeInstanceOf(BillPaymentError);
  });
});

describe("vtu.ng shared token", () => {
  it("reuses the stored token and logs in again once when it is rejected", async () => {
    const store = memoryStore("old");
    const f = fakeFetch({
      "/jwt-auth/v1/token": [{ body: { token: "new" } }],
      "/api/v2/balance": [{ status: 401, body: { code: "jwt_auth_invalid_token" } }, { body: { code: "success", data: { balance: "2500.50" } } }],
    });
    const vtu = new VtuNgProvider("u", "p", f.impl, store);
    await expect(vtu.balance()).resolves.toBe(2500.5);
    expect(store.logins).toBe(1);
    expect(f.calls.filter((c) => c.path === "/api/v2/balance").map((c) => c.auth)).toEqual(["Bearer old", "Bearer new"]);
  });
});

describe("vtu.ng requery", () => {
  it("reports success, pending and not-found distinctly", async () => {
    const f = fakeFetch({
      ...login,
      "/api/v2/requery": [
        { body: { code: "success", data: { status: "completed-api", token: "1111" } } },
        { body: { code: "success", data: { status: "processing-api" } } },
        { status: 404, body: { code: "failure", message: "Order not found" } },
      ],
    });
    const vtu = new VtuNgProvider("u", "p", f.impl, memoryStore());
    await expect(vtu.queryBill("tx-1")).resolves.toMatchObject({ status: "successful", token: "1111" });
    await expect(vtu.queryBill("tx-1")).resolves.toMatchObject({ status: "pending" });
    await expect(vtu.queryBill("tx-1")).resolves.toMatchObject({ status: "not_found" });
  });
});
