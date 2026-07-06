import { NextResponse } from "next/server";
import { ZodError } from "zod";
import * as Sentry from "@sentry/nextjs";

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
  // Never leak internals to the client, but do report to Sentry (no-op when
  // no DSN is configured).
  Sentry.captureException(err);
  console.error("Unhandled API error:", err);
  return NextResponse.json(
    { error: "Internal server error", code: "internal_error" },
    { status: 500 }
  );
}
