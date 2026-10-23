import { NextResponse } from "next/server";
import { ZodError } from "zod";
import * as Sentry from "@sentry/nextjs";
import { BillPaymentError } from "@/payments/types";

/** Typed API error carrying an HTTP status + machine-readable code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message = "Unauthorized") {
    super(401, message, "unauthorized");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, message, "forbidden");
  }
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Normalize any thrown value into a safe JSON error response. */
export function toErrorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Validation failed", code: "validation_error", issues: err.issues },
      { status: 422 }
    );
  }
  // The payment partner down, timing out or unreachable: say so plainly (503,
  // retryable) instead of "Internal server error". Never names the partner.
  if (isProviderOutage(err)) {
    Sentry.captureException(err);
    console.error("Provider unavailable:", err);
    return NextResponse.json(
      {
        error: "Our payment partner is temporarily unavailable. Please try again in a few minutes.",
        code: "provider_unavailable",
      },
      { status: 503 }
    );
  }
  // Never leak internals to the client, but do report to Sentry (no-op when
  // no DSN is configured).
  Sentry.captureException(err);
  console.error("Unhandled API error:", err);
  return NextResponse.json(
    { error: "Internal server error", code: "internal_error" },
    { status: 500 }
  );
}

/**
 * An error that means the payment partner couldn't be reached or failed on its
 * side: its 5xx answers, and network failures on the way to it (fetch's
 * "fetch failed" with a connect timeout, reset or DNS cause). Its 4xx refusals
 * are not outages and keep their normal handling.
 */
export function isProviderOutage(err: unknown): boolean {
  if (err instanceof BillPaymentError) {
    return err.providerStatus === undefined ? /timeout|timed out|network|fetch failed/i.test(err.providerMessage ?? err.message) : err.providerStatus >= 500;
  }
  if (err instanceof TypeError && err.message === "fetch failed") {
    const code = (err as TypeError & { cause?: { code?: string } }).cause?.code ?? "";
    return /^(UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)$/.test(code);
  }
  return false;
}
