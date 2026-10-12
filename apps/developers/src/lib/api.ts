import { supabase } from "./supabase";

/** Where the dashboard's API lives. Public docs show the API's own address. */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://cheqpay-admin453.vercel.app";
/** The address developers call, as documented. */
export const PUBLIC_API = "https://api.mycheqpay.com/v1";
export const APP_URL = "https://mycheqpay.com";
export const SUPPORT_EMAIL = "dev@mycheqpay.com";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Codes that ask for a second step, not a new sign-in. */
const STEP_UP_CODES = new Set(["mfa_required", "pin_required", "pin_incorrect", "pin_not_set", "pin_locked"]);

export interface CallOptions {
  method?: string;
  body?: unknown;
  pin?: string;
  idempotencyKey?: string;
}

export async function call<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.pin) headers["x-transaction-pin"] = opts.pin;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: { error?: string; code?: string; issues?: { message?: string }[] } & Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : undefined;
    if (res.status === 401 && !STEP_UP_CODES.has(code ?? "") && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      await supabase.auth.signOut().catch(() => undefined);
      window.location.href = `/login/?next=${encodeURIComponent(window.location.pathname)}`;
    }
    const issue = body.issues?.[0]?.message;
    const message = issue && !/^(Required|Invalid|Expected)/.test(issue) ? issue : typeof body.error === "string" ? body.error : res.statusText;
    throw new ApiError(res.status, message || "Something went wrong.", code);
  }
  return body as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ---- Shapes the dashboard reads -------------------------------------------

export type Mode = "test" | "live";

export interface Wallet {
  id: string;
  type: "main" | "customer";
  customer_id: string | null;
  currency: "NGN" | "USD";
  available_balance: number;
  status: string;
  livemode: boolean;
}

export interface Overview {
  account: null | {
    id: string;
    business_name: string;
    status: "sandbox" | "pending_review" | "approved" | "rejected" | "suspended";
    review_note: string | null;
    submitted_at: string | null;
    live_since: string | null;
    frozen: boolean;
    frozen_reason: string | null;
    frozen_by: "owner" | "admin" | "system" | null;
    suspended_reason: string | null;
    require_ip_allowlist: boolean;
  };
  owner: { email: string | null; kyc_tier: number; two_factor: boolean };
  subscription?: Subscription | null;
  live_enabled?: boolean;
  live_problem?: { code: string; message: string } | null;
  limits?: {
    new_account: boolean;
    daily_outflow: Record<string, number>;
    max_balance: Record<string, number>;
    max_single_payment: Record<string, number>;
  };
  wallets?: { test: Wallet[]; live: Wallet[] };
  checklist?: Record<"test_key" | "two_factor" | "identity_verified" | "business_verified" | "plan" | "live_key", boolean>;
}

export interface Subscription {
  plan_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
  next_plan_id?: string | null;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  live: boolean;
  rate_limit_per_minute: number;
  bill_fee: { bps: number; cap: number };
  deposit_fee: { bps: number; cap: number };
  card_issue_fee_usd_cents: number;
  card_funding_fee_bps: number;
  max_customers: number;
  max_virtual_accounts: number;
  max_active_cards: number;
  webhook_endpoints: number;
}

export interface Key {
  id: string;
  label: string;
  mode: Mode;
  preview: string;
  scopes: string[];
  allowed_ips: string[];
  state: "active" | "revoked" | "expired";
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface Endpoint {
  id: string;
  mode: Mode;
  url: string;
  description: string | null;
  events: string[];
  status: "enabled" | "disabled";
  disabled_reason: string | null;
  failing_since: string | null;
  previous_secret_valid_until: string | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface Page<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const dash = {
  overview: () => call<Overview>("/api/developer/account"),
  openAccount: (business_name: string) => call<{ account: Overview["account"] }>("/api/developer/account", { body: { business_name } }),
  rename: (business_name: string) => call("/api/developer/account", { method: "PATCH", body: { business_name } }),
  plans: () => call<{ plans: Plan[] }>("/api/developer/plans"),
  changePlan: (plan_id: string, pin: string) => call<{ change: { kind: string; charged: number } }>("/api/developer/subscription", { body: { plan_id }, pin }),
  cancelPlan: () => call("/api/developer/subscription", { method: "DELETE" }),
  keys: () => call<{ keys: Key[] }>("/api/developer/keys"),
  createKey: (b: { mode: Mode; label: string; scopes: string[]; allowed_ips: string[] }) => call<{ key: Key; secret: string }>("/api/developer/keys", { body: b }),
  updateKey: (id: string, b: { label?: string; scopes?: string[]; allowed_ips?: string[] }) => call<{ key: Key }>(`/api/developer/keys/${id}`, { method: "PATCH", body: b }),
  revokeKey: (id: string) => call<{ key: Key }>(`/api/developer/keys/${id}`, { method: "DELETE" }),
  rollKey: (id: string, keep_old_hours: number) => call<{ key: Key; secret: string }>(`/api/developer/keys/${id}/roll`, { body: { keep_old_hours } }),
  endpoints: () => call<{ endpoints: Endpoint[] }>("/api/developer/webhooks"),
  createEndpoint: (b: { mode: Mode; url: string; events: string[]; description?: string }) => call<{ endpoint: Endpoint; secret: string }>("/api/developer/webhooks", { body: b }),
  updateEndpoint: (id: string, b: { url?: string; events?: string[]; description?: string | null; enabled?: boolean }) =>
    call<{ endpoint: Endpoint }>(`/api/developer/webhooks/${id}`, { method: "PATCH", body: b }),
  deleteEndpoint: (id: string) => call(`/api/developer/webhooks/${id}`, { method: "DELETE" }),
  rollEndpoint: (id: string) => call<{ endpoint: Endpoint; secret: string }>(`/api/developer/webhooks/${id}/roll`, { body: {} }),
  testEndpoint: (id: string) => call<{ delivery: Delivery | null }>(`/api/developer/webhooks/${id}/test`, { body: {} }),
  deliveries: (id: string) => call<{ deliveries: Delivery[] }>(`/api/developer/webhooks/${id}/deliveries`),
  resend: (deliveryId: string) => call<{ delivery: Delivery }>(`/api/developer/deliveries/${deliveryId}/resend`, { body: {} }),
  list: (what: "transactions" | "customers" | "virtual-accounts" | "wallets" | "events", mode: Mode, after?: string) =>
    call<Page<Row>>(`/api/developer/${what}?mode=${mode}&limit=50${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`),
  requestLogs: (mode: Mode, errorsOnly: boolean) => call<{ logs: Row[] }>(`/api/developer/request-logs?mode=${mode}&limit=100${errorsOnly ? "&errors=1" : ""}`),
  audit: () => call<{ events: Row[] }>("/api/developer/audit"),
  sandboxTopUp: (currency: "NGN" | "USD", amount: string) => call<{ wallet: Wallet }>("/api/developer/sandbox/topup", { body: { currency, amount } }),
  sandboxDeposit: (virtual_account_id: string, amount: string, sender_name?: string) =>
    call<{ transaction: Row }>("/api/developer/sandbox/deposit", { body: { virtual_account_id, amount, ...(sender_name ? { sender_name } : {}) } }),
  moveMoney: (b: { direction: "in" | "out"; currency: "NGN" | "USD"; amount: string }, pin: string, idempotencyKey: string) =>
    call<{ transaction: Row; replay: boolean }>("/api/developer/wallet/move", { body: b, pin, idempotencyKey }),
  apply: (b: Record<string, string>) => call<{ account: Overview["account"] }>("/api/developer/application", { body: b }),
  emergencyStop: () => call<Row>("/api/developer/emergency-stop", { body: {} }),
  resume: (pin: string) => call<Row>("/api/developer/resume", { body: {}, pin }),
};
