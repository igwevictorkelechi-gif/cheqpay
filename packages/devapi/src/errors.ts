/**
 * Every error the developer API returns has this shape:
 *
 *   { "error": { "type", "code", "message", "param", "request_id" } }
 *
 * `type` is the broad class a client branches on; `code` is the specific
 * reason. This registry is the documented list: the API maps its internal
 * errors through it, and the docs render the errors page from it.
 */
export const ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "idempotency_error",
  "api_error",
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

export interface ErrorCodeInfo {
  status: number;
  type: ErrorType;
  description: string;
}

export const ERROR_CODES = {
  // Authentication: deliberately one generic code. Whether a key was unknown,
  // revoked, expired or refused for its IP is shown in your dashboard log only,
  // so a stolen key can't be probed for why it stopped working.
  invalid_api_key: {
    status: 401,
    type: "authentication_error",
    description: "No valid API key was provided. The key may be missing, mistyped, revoked, expired, or not allowed from this IP address. Your dashboard log shows which.",
  },
  too_many_failed_attempts: {
    status: 429,
    type: "rate_limit_error",
    description: "Too many requests with invalid keys came from your IP address. Requests from it are refused for 15 minutes.",
  },
  browser_requests_not_allowed: {
    status: 403,
    type: "permission_error",
    description: "The request came from a web browser. Secret keys must only be used from your server.",
  },
  key_in_url: {
    status: 400,
    type: "invalid_request_error",
    description: "An API key was sent in the URL, where it can leak into logs. Send it in the Authorization header. A key seen in a URL is revoked automatically.",
  },
  insufficient_scope: {
    status: 403,
    type: "permission_error",
    description: "The API key does not have the scope this endpoint needs. Edit the key's scopes in your dashboard.",
  },
  account_not_approved: {
    status: 403,
    type: "permission_error",
    description: "Live mode needs an approved business. Complete business verification in your dashboard.",
  },
  subscription_inactive: {
    status: 402,
    type: "permission_error",
    description: "Live mode needs an active paid plan. Renew or choose a plan in your dashboard.",
  },
  account_frozen: {
    status: 403,
    type: "permission_error",
    description: "Money movement is paused on this account. Reads still work. Contact dev@mycheqpay.com.",
  },
  feature_disabled: {
    status: 503,
    type: "api_error",
    description: "The developer API is temporarily unavailable.",
  },
  rate_limited: {
    status: 429,
    type: "rate_limit_error",
    description: "Too many requests. Slow down and retry after the number of seconds in the Retry-After header.",
  },
  validation_error: {
    status: 400,
    type: "invalid_request_error",
    description: "A parameter is missing or invalid. `param` names it.",
  },
  invalid_json: {
    status: 400,
    type: "invalid_request_error",
    description: "The request body is not valid JSON.",
  },
  unsupported_media_type: {
    status: 415,
    type: "invalid_request_error",
    description: "Send JSON with Content-Type: application/json (or multipart/form-data for file uploads).",
  },
  body_too_large: {
    status: 413,
    type: "invalid_request_error",
    description: "The request body is larger than the endpoint accepts.",
  },
  idempotency_key_required: {
    status: 400,
    type: "idempotency_error",
    description: "POST requests need an Idempotency-Key header (any unique string up to 255 characters, e.g. a UUID).",
  },
  idempotency_key_reused: {
    status: 409,
    type: "idempotency_error",
    description: "This Idempotency-Key was already used with a different request body. Use a new key for a new request.",
  },
  idempotency_in_progress: {
    status: 409,
    type: "idempotency_error",
    description: "A request with this Idempotency-Key is still being processed. Retry shortly.",
  },
  not_found: {
    status: 404,
    type: "invalid_request_error",
    description: "No such object, or it belongs to another account or mode.",
  },
  insufficient_funds: {
    status: 422,
    type: "invalid_request_error",
    description: "The wallet does not hold enough to cover the amount and its fee.",
  },
  limit_exceeded: {
    status: 422,
    type: "invalid_request_error",
    description: "The amount is over a per-transaction, daily or balance limit on your account.",
  },
  customer_exists: {
    status: 409,
    type: "invalid_request_error",
    description: "A customer with this BVN already exists in this mode. Each person is one customer; the message names the existing one.",
  },
  customer_locked: {
    status: 409,
    type: "invalid_request_error",
    description: "This customer is verified or being verified, so their identity can't change. Only `metadata` can be updated.",
  },
  kyc_required: {
    status: 409,
    type: "invalid_request_error",
    description: "The customer must pass identity verification first.",
  },
  invalid_file: {
    status: 400,
    type: "invalid_request_error",
    description: "The file doesn't exist in this mode, isn't an identity document, or is already attached to another customer.",
  },
  file_type_mismatch: {
    status: 400,
    type: "invalid_request_error",
    description: "The file's contents don't match its declared type.",
  },
  plan_limit_reached: {
    status: 403,
    type: "permission_error",
    description: "Your plan's limit for this kind of object is reached. Upgrade your plan to create more.",
  },
  duplicate_reference: {
    status: 409,
    type: "invalid_request_error",
    description: "Another object in this mode already uses this `reference`. References are unique per mode.",
  },
  currency_mismatch: {
    status: 400,
    type: "invalid_request_error",
    description: "A wallet holds a different currency from the one this operation needs.",
  },
  wallet_frozen: {
    status: 403,
    type: "permission_error",
    description: "The wallet is frozen. It can receive money but not send it.",
  },
  quote_expired: {
    status: 410,
    type: "invalid_request_error",
    description: "The quote is more than 45 seconds old. Request a new one.",
  },
  quote_used: {
    status: 409,
    type: "invalid_request_error",
    description: "The quote has already been used. Each quote converts once.",
  },
  virtual_account_in_progress: {
    status: 409,
    type: "invalid_request_error",
    description: "A virtual account is already being opened for this customer. Retry in a few seconds.",
  },
  service_unavailable: {
    status: 503,
    type: "api_error",
    description: "A partner service didn't respond and nothing was changed. Retry shortly.",
  },
  internal_error: {
    status: 500,
    type: "api_error",
    description: "Something went wrong on our side. Quote the request_id if you contact dev@mycheqpay.com.",
  },
} as const satisfies Record<string, ErrorCodeInfo>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The error class for a status the registry doesn't name. */
export function errorTypeForStatus(status: number): ErrorType {
  if (status === 401) return "authentication_error";
  if (status === 402 || status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

export interface ApiErrorBody {
  error: {
    type: ErrorType;
    code: string;
    message: string;
    param: string | null;
    request_id: string;
  };
}
