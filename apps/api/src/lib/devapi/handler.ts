// apps/api/src/lib/devapi/handler.ts
//
// The gate every /v1 request passes through, in this order:
//
//   1. the developer API is switched on
//   2. it isn't a browser (secret keys are server-only) and no key is in the URL
//   3. the caller's IP isn't blocked for failed authentication
//   4. a valid, active key — one generic 401 for every failure, the reason in
//      the developer's own log
//   5. the key holds the route's scope
//   6. live keys: a verified business with a current paid plan
//   7. rate limits, per key and per account
//   8. a well-formed body (JSON, size, strict schema) and, on POST, an
//      Idempotency-Key
//   9. the handler, with everything it needs in `ctx` — account and mode come
//      from the key, never from the request
//  10. one error format, one set of headers, and a redacted log line
//
// A route is just `export const GET = withApi({ scope }, handler)`; a guard test
// makes sure no /v1 route exists without it.

import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ERROR_CODES, KEY_LIKE, errorTypeForStatus, toPublicId, type ApiErrorBody, type Scope } from "@cheqpay/devapi";
import { prisma } from "@cheqpay/db";
import { ApiError } from "../http";
import { scrubProviderNames } from "../publicMessage";
import { getFeatureFlags } from "../features";
import { checkRateLimit, type RateStanding } from "../ratelimit";
import { hashKey, keyIsActive, liveKeyProblem, parseBearer, resolveKey, revokeApiKey, touchKey } from "./keys";
import { ipAllowed, trustedClientIp } from "./net";
import { getPlans, isPaidPlanId, type DevPlan, type PlanId } from "./plans";
import { getSubscription, liveAccessProblem } from "./billing";
import { redactForLog } from "./redact";
import { assertNotBlocked, noteAuthFailure } from "./authGuard";
import { alertOwner, later, recordDevAudit } from "./audit";
import type { AccountRow, KeyRow, Mode, SubscriptionRow } from "./types";

export const DEFAULT_MAX_BODY = 100 * 1024;

/** An error with the parameter it is about, for the `param` field. */
export class V1Error extends ApiError {
  constructor(
    status: number,
    message: string,
    code: string,
    public param: string | null = null,
    public retryAfterSeconds: number | null = null,
  ) {
    super(status, message, code);
    this.name = "V1Error";
  }
}

const invalidKey = () =>
  new V1Error(401, "No valid API key provided. Send it as `Authorization: Bearer <key>`; your dashboard log shows why a key was refused.", "invalid_api_key");

export interface ApiContext<B = unknown> {
  requestId: string;
  account: AccountRow;
  key: KeyRow;
  mode: Mode;
  /** Every query in a handler is scoped by this. */
  scope: { accountId: string; mode: Mode };
  plan: DevPlan;
  subscription: SubscriptionRow | null;
  ip: string | null;
  idempotencyKey: string | null;
  body: B;
  query: URLSearchParams;
  method: string;
  path: string;
  /** The raw request, for routes that read their own body (file uploads). */
  request: Request;
}

export interface RouteOptions<S extends ZodTypeAny | undefined> {
  scope: Scope;
  /** A strict zod schema for the JSON body (POST/PATCH). */
  body?: S;
  /** Refused while the account is frozen. */
  moneyMoving?: boolean;
  /** Body fields worth keeping in the request log. Everything else is dropped. */
  logFields?: readonly string[];
  maxBodyBytes?: number;
  /** Test helpers: 404 for live keys. */
  testOnly?: boolean;
  /** The handler reads the body itself (multipart uploads); the gate only checks its declared size. */
  rawBody?: boolean;
}

export interface HandlerResult {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

type RouteParams = { params?: Promise<Record<string, string | string[]>> };

/** The plan an account is on now: its paid plan while that's usable, else the sandbox plan. */
export function currentPlan(sub: SubscriptionRow | null, plans: Record<PlanId, DevPlan>): DevPlan {
  if (sub && isPaidPlanId(sub.plan_id) && sub.status !== "canceled" && liveAccessProblem({ status: "approved" }, sub, plans) === null) {
    return plans[sub.plan_id];
  }
  return plans.sandbox;
}

/** Why an otherwise-valid key may not be used for this request, or null. Logged, never returned. */
export function keyRefusal(key: KeyRow, account: AccountRow, ip: string | null, now: Date = new Date()): string | null {
  if (key.revoked_at) return "revoked";
  if (!keyIsActive(key, now)) return "expired";
  if (account.status === "suspended") return "account_suspended";
  if (key.allowed_ips.length > 0 && !ipAllowed(ip, key.allowed_ips)) return "ip_not_allowed";
  if (key.mode === "live" && liveKeyProblem(account, key.scopes, key.allowed_ips)) return "ip_allowlist_required";
  return null;
}

function rateHeaders(r: RateStanding): Record<string, string> {
  return {
    "ratelimit-limit": String(r.limit),
    "ratelimit-remaining": String(r.remaining),
    "ratelimit-reset": String(Math.max(0, Math.ceil((r.resetAt - Date.now()) / 1000))),
  };
}

const SAFE_INT = (v: unknown) => (typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v);

export function jsonResponse(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body, (_k, v) => SAFE_INT(v)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=63072000; includeSubDomains",
      ...headers,
    },
  });
}

/** Any thrown value as the v1 error body. Internal detail never leaves the server. */
export function toV1Error(err: unknown, requestId: string): { status: number; body: ApiErrorBody; retryAfter: number | null } {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const param = issue?.path.length ? issue.path.join(".") : null;
    return {
      status: 400,
      retryAfter: null,
      body: {
        error: {
          type: "invalid_request_error",
          code: "validation_error",
          message: param ? `${param}: ${issue.message}` : issue?.message ?? "Invalid request",
          param,
          request_id: requestId,
        },
      },
    };
  }
  if (err instanceof ApiError) {
    const known = (ERROR_CODES as Record<string, { type: ApiErrorBody["error"]["type"] }>)[err.code];
    const retryAfter =
      err instanceof V1Error ? err.retryAfterSeconds : ((err as ApiError & { retryAfterSeconds?: number }).retryAfterSeconds ?? null);
    return {
      status: err.status,
      retryAfter,
      body: {
        error: {
          type: known?.type ?? errorTypeForStatus(err.status),
          code: err.code,
          message: scrubProviderNames(err.message),
          param: err instanceof V1Error ? err.param : null,
          request_id: requestId,
        },
      },
    };
  }
  Sentry.captureException(err);
  console.error("[devapi] unhandled error", { requestId, error: err instanceof Error ? err.message : String(err) });
  return {
    status: 500,
    retryAfter: null,
    body: {
      error: {
        type: "api_error",
        code: "internal_error",
        message: "Something went wrong on our side. Quote the request_id if you contact dev@mycheqpay.com.",
        param: null,
        request_id: requestId,
      },
    },
  };
}

async function readJsonBody(req: Request, max: number): Promise<{ raw: unknown; empty: boolean }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new V1Error(413, `The request body is larger than ${Math.round(max / 1024)} KB.`, "body_too_large");
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > max) {
    throw new V1Error(413, `The request body is larger than ${Math.round(max / 1024)} KB.`, "body_too_large");
  }
  if (text.trim() === "") return { raw: {}, empty: true };
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    throw new V1Error(415, "Send JSON with Content-Type: application/json.", "unsupported_media_type");
  }
  try {
    return { raw: JSON.parse(text), empty: false };
  } catch {
    throw new V1Error(400, "The request body is not valid JSON.", "invalid_json");
  }
}

export function withApi<S extends ZodTypeAny | undefined = undefined>(
  opts: RouteOptions<S>,
  handler: (ctx: ApiContext<S extends ZodTypeAny ? z.infer<S> : undefined>, params: Record<string, string>) => Promise<HandlerResult>,
) {
  return async function route(req: Request, routeCtx?: RouteParams): Promise<Response> {
    const started = Date.now();
    const requestUuid = randomUUID();
    const requestId = toPublicId("request", requestUuid);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const ip = trustedClientIp(req);
    const headers: Record<string, string> = { "x-request-id": requestId };

    let account: AccountRow | null = null;
    let key: KeyRow | null = null;
    let authFailure: string | null = null;
    let status = 200;
    let errorCode: string | null = null;
    let loggedBody: Record<string, unknown> | null = null;
    const idemHeader = req.headers.get("idempotency-key");

    try {
      if (!(await getFeatureFlags()).developer_api) {
        throw new V1Error(503, "The CheqPay developer API is temporarily unavailable.", "feature_disabled");
      }
      if (req.headers.get("origin")) {
        throw new V1Error(
          403,
          "This request came from a web browser. Secret keys must only be used from your server — never in a web page or mobile app.",
          "browser_requests_not_allowed",
        );
      }
      // A key in the URL ends up in proxy and server logs; treat it as leaked.
      for (const [k, v] of url.searchParams) {
        const leaked = KEY_LIKE.exec(v) ?? KEY_LIKE.exec(k);
        if (leaked || /^(api_?key|secret(_key)?|access_token)$/i.test(k)) {
          if (leaked) {
            const found = await resolveKey(hashKey(leaked[0])).catch(() => null);
            if (found && keyIsActive(found.key)) {
              await revokeApiKey(found.account.id, found.key.id, "sent in a URL");
              await recordDevAudit({ accountId: found.account.id, actor: "system", action: "key.revoked_in_url", target: found.key.id, ip });
              alertOwner(found.account, {
                title: "An API key was revoked",
                body: `Your ${found.key.mode} key "${found.key.label}" was sent in a URL, where it can be copied from logs, so we revoked it. Create a new key and send it in the Authorization header.`,
                details: [{ label: "IP address", value: ip ?? "unknown" }],
              });
            }
          }
          throw new V1Error(400, "Never put an API key in a URL. Send it in the Authorization header. A key sent in a URL is revoked automatically.", "key_in_url");
        }
      }

      await assertNotBlocked(ip);

      const bearer = parseBearer(req.headers.get("authorization"));
      const resolved = bearer ? await resolveKey(hashKey(bearer.secret)) : null;
      if (!resolved) {
        await noteAuthFailure(ip);
        throw invalidKey();
      }
      key = resolved.key;
      account = resolved.account;
      const refusal = keyRefusal(key, account, ip);
      if (refusal) {
        authFailure = refusal;
        await noteAuthFailure(ip);
        throw invalidKey();
      }

      if (opts.testOnly && key.mode !== "test") throw new V1Error(404, "Not found.", "not_found");
      if (!key.scopes.includes(opts.scope)) {
        throw new V1Error(403, `This key doesn't have the ${opts.scope} scope. Edit the key's scopes in your dashboard.`, "insufficient_scope");
      }

      const [plans, subscription] = await Promise.all([getPlans(), getSubscription(account.id)]);
      if (key.mode === "live") {
        const problem = liveAccessProblem(account, subscription, plans);
        if (problem) throw new V1Error(problem.status, problem.message, problem.code);
      }
      const plan = currentPlan(subscription, plans);

      const perKey = await checkRateLimit(`devapi:key:${key.id}`, plan.rpm, 60_000);
      Object.assign(headers, rateHeaders(perKey));
      if (!perKey.allowed) {
        throw new V1Error(429, "Too many requests. Slow down and retry after the Retry-After header.", "rate_limited", null, Math.max(1, Math.ceil((perKey.resetAt - Date.now()) / 1000)));
      }
      const perAccount = await checkRateLimit(`devapi:acct:${account.id}`, plan.rpm * 3, 60_000);
      if (!perAccount.allowed) {
        throw new V1Error(429, "Too many requests across your keys. Slow down and retry after the Retry-After header.", "rate_limited", null, Math.max(1, Math.ceil((perAccount.resetAt - Date.now()) / 1000)));
      }

      if (opts.moneyMoving && account.frozen) {
        throw new V1Error(403, "Money movement is paused on this account. Reads still work.", "account_frozen");
      }

      let body: unknown = undefined;
      if (opts.rawBody) {
        if (Number(req.headers.get("content-length") ?? "0") > (opts.maxBodyBytes ?? DEFAULT_MAX_BODY)) {
          throw new V1Error(413, `The request body is larger than ${Math.round((opts.maxBodyBytes ?? DEFAULT_MAX_BODY) / 1024)} KB.`, "body_too_large");
        }
      } else if (method === "POST" || method === "PATCH" || method === "PUT") {
        const { raw } = await readJsonBody(req, opts.maxBodyBytes ?? DEFAULT_MAX_BODY);
        loggedBody = redactForLog(raw, opts.logFields ?? []);
        body = opts.body ? opts.body.parse(raw) : raw;
      }
      if (method === "POST" && (!idemHeader || !/^[A-Za-z0-9_\-:.]{1,255}$/.test(idemHeader) || idemHeader.startsWith("cp:"))) {
        throw new V1Error(400, "POST requests need an Idempotency-Key header: a unique string (e.g. a UUID) per request.", "idempotency_key_required");
      }

      const params: Record<string, string> = {};
      const raw = routeCtx?.params ? await routeCtx.params : {};
      for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v.join("/") : v;

      headers["cheqpay-mode"] = key.mode;
      const ctx: ApiContext = {
        requestId,
        account,
        key,
        mode: key.mode,
        scope: { accountId: account.id, mode: key.mode },
        plan,
        subscription,
        ip,
        idempotencyKey: idemHeader,
        body,
        query: url.searchParams,
        method,
        path: url.pathname,
        request: req,
      };
      const result = await handler(ctx as ApiContext<S extends ZodTypeAny ? z.infer<S> : undefined>, params);
      status = result.status ?? 200;
      return jsonResponse(status, result.body, { ...headers, ...(result.headers ?? {}) });
    } catch (err) {
      const out = toV1Error(err, requestId);
      status = out.status;
      errorCode = out.body.error.code;
      if (out.retryAfter) headers["retry-after"] = String(out.retryAfter);
      return jsonResponse(out.status, out.body, headers);
    } finally {
      if (account) {
        const accountId = account.id;
        const keyId = key?.id ?? null;
        const mode = key?.mode ?? "test";
        const entry = {
          id: requestId,
          duration: Date.now() - started,
          status,
          errorCode,
          authFailure,
          body: loggedBody,
        };
        later(async () => {
          await prisma.$executeRawUnsafe(
            `INSERT INTO dev_request_logs (id, account_id, key_id, mode, method, path, status, duration_ms, error_code, auth_failure,
               ip, user_agent, idempotency_key, request_body)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
            requestUuid,
            accountId,
            keyId,
            mode,
            method,
            url.pathname.slice(0, 300),
            entry.status,
            entry.duration,
            entry.errorCode,
            entry.authFailure,
            ip,
            req.headers.get("user-agent")?.slice(0, 300) ?? null,
            idemHeader?.slice(0, 255) ?? null,
            entry.body ? JSON.stringify(entry.body) : null,
          );
          if (keyId && !entry.authFailure) await touchKey(keyId, ip);
          // Due webhook retries and verifications ride on API traffic (at most once a minute).
          if (!entry.authFailure) await (await import("./jobs")).maybeRunJobs();
        });
      }
    }
  };
}
