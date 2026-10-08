// The CheqPay API reference as an OpenAPI 3.1 document.
//
// Served at GET /v1/openapi.json and rendered by the developer portal. A guard
// test in apps/api checks that every /v1 route is described here (with the
// scope it really requires) and that everything described here exists, so the
// reference can't drift from the API.

import { ERROR_CODES } from "./errors";
import { SCOPES } from "./scopes";

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const listOf = (name: string): Schema => ({
  type: "object",
  required: ["object", "data", "has_more"],
  properties: {
    object: { type: "string", const: "list" },
    data: { type: "array", items: ref(name) },
    has_more: { type: "boolean", description: "True when there are more results. Pass the last id as `starting_after` to get them." },
  },
});

const idParam = (prefix: string, what: string): Schema => ({
  name: "id",
  in: "path",
  required: true,
  description: `The ${what} id (starts with \`${prefix}_\`).`,
  schema: { type: "string", pattern: `^${prefix}_[0-9a-f]{32}$` },
});

const pageParams: Schema[] = [
  { name: "limit", in: "query", description: "How many results to return, 1–100. Default 20.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "starting_after", in: "query", description: "A cursor: the id of the last object on the previous page.", schema: { type: "string" } },
];

const errorResponse = (description: string): Schema => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

const STANDARD_ERRORS: Record<string, Schema> = {
  "401": errorResponse("Invalid API key (`invalid_api_key`)."),
  "403": errorResponse("The key lacks the scope (`insufficient_scope`), live mode isn't open to the account, or the request came from a browser."),
  "429": errorResponse("Rate limited (`rate_limited`) or too many failed authentications (`too_many_failed_attempts`)."),
};

interface OpSpec {
  id: string;
  summary: string;
  description: string;
  tag: string;
  scope: string;
  parameters?: Schema[];
  body?: Schema;
  response: { status?: string; description: string; schema: Schema };
  errors?: Record<string, string>;
  /** Moves money: refused while the account is frozen; needs an Idempotency-Key. */
  money?: boolean;
}

function op(o: OpSpec): Schema {
  const responses: Record<string, Schema> = {
    [o.response.status ?? "200"]: { description: o.response.description, content: { "application/json": { schema: o.response.schema } } },
    ...STANDARD_ERRORS,
  };
  for (const [status, description] of Object.entries(o.errors ?? {})) responses[status] = errorResponse(description);
  return {
    operationId: o.id,
    summary: o.summary,
    description: o.description,
    tags: [o.tag],
    "x-cheqpay-scope": o.scope,
    ...(o.money ? { "x-cheqpay-money": true } : {}),
    parameters: o.parameters ?? [],
    ...(o.body
      ? { requestBody: { required: true, content: { "application/json": { schema: o.body } } } }
      : {}),
    responses,
  };
}

const money = (description: string): Schema => ({
  type: "integer",
  description: `${description} In minor units: kobo for NGN, cents for USD.`,
  example: 150000,
});

const timestamp = { type: "string", format: "date-time" } as const;

export const openapiDocument = {
  openapi: "3.1.0",
  info: {
    title: "CheqPay API",
    version: "1.0.0",
    description:
      "Build on CheqPay: wallets and virtual accounts for your customers, bill payments, and USD virtual cards. " +
      "Every request is authenticated with a secret key sent as `Authorization: Bearer <key>`. " +
      "Test keys (`cp_test_sk_…`) work on simulated money; live keys (`cp_live_sk_…`) move real money.",
    contact: { name: "CheqPay developer support", email: "dev@mycheqpay.com", url: "https://developers.mycheqpay.com" },
  },
  servers: [{ url: "https://api.mycheqpay.com/v1", description: "Test and live (the key decides which)" }],
  security: [{ secretKey: [] }],
  tags: [
    { name: "Account", description: "Your developer account, plan and limits." },
    { name: "Wallets", description: "Balances held in your main wallets and your customers' wallets." },
    { name: "Transactions", description: "Every money movement, of every kind." },
  ],
  "x-cheqpay-scopes": SCOPES,
  "x-cheqpay-error-codes": ERROR_CODES,
  paths: {
    "/account": {
      get: op({
        id: "getAccount",
        tag: "Account",
        scope: "account:read",
        summary: "Retrieve your account",
        description: "The account the key belongs to: its plan, the mode the key works in, whether live mode is open, and (for live keys) the limits that apply.",
        response: { description: "The account.", schema: ref("Account") },
      }),
    },
    "/wallets": {
      get: op({
        id: "listWallets",
        tag: "Wallets",
        scope: "wallets:read",
        summary: "List wallets",
        description: "Your main NGN and USD wallets and your customers' wallets in the key's mode, newest first.",
        parameters: [
          { name: "currency", in: "query", schema: { type: "string", enum: ["NGN", "USD"] } },
          { name: "type", in: "query", description: "`main` for your own wallets, `customer` for your customers'.", schema: { type: "string", enum: ["main", "customer"] } },
          { name: "customer_id", in: "query", description: "Only this customer's wallets.", schema: { type: "string" } },
          ...pageParams,
        ],
        response: { description: "A page of wallets.", schema: listOf("Wallet") },
      }),
    },
    "/wallets/{id}": {
      get: op({
        id: "getWallet",
        tag: "Wallets",
        scope: "wallets:read",
        summary: "Retrieve a wallet",
        description: "One wallet and its available balance.",
        parameters: [idParam("wal", "wallet")],
        response: { description: "The wallet.", schema: ref("Wallet") },
        errors: { "404": "No such wallet in this account and mode (`not_found`)." },
      }),
    },
    "/wallets/{id}/transactions": {
      get: op({
        id: "listWalletEntries",
        tag: "Wallets",
        scope: "wallets:read",
        summary: "Wallet statement",
        description: "Every change to the wallet's balance, newest first, each with the balance after it. Use it to reconcile your own records.",
        parameters: [idParam("wal", "wallet"), ...pageParams],
        response: { description: "A page of statement entries.", schema: listOf("WalletEntry") },
        errors: { "404": "No such wallet (`not_found`)." },
      }),
    },
    "/transactions": {
      get: op({
        id: "listTransactions",
        tag: "Transactions",
        scope: "transactions:read",
        summary: "List transactions",
        description: "Every money movement in the key's mode, newest first.",
        parameters: [
          { name: "kind", in: "query", schema: ref("TransactionKind") },
          { name: "status", in: "query", schema: ref("TransactionStatus") },
          { name: "wallet_id", in: "query", description: "Movements into or out of this wallet.", schema: { type: "string" } },
          { name: "customer_id", in: "query", schema: { type: "string" } },
          { name: "reference", in: "query", description: "The reference you sent when you created it.", schema: { type: "string" } },
          ...pageParams,
        ],
        response: { description: "A page of transactions.", schema: listOf("Transaction") },
      }),
    },
    "/transactions/{id}": {
      get: op({
        id: "getTransaction",
        tag: "Transactions",
        scope: "transactions:read",
        summary: "Retrieve a transaction",
        description: "One transaction, with its current status.",
        parameters: [idParam("txn", "transaction")],
        response: { description: "The transaction.", schema: ref("Transaction") },
        errors: { "404": "No such transaction (`not_found`)." },
      }),
    },
  },
  components: {
    securitySchemes: {
      secretKey: {
        type: "http",
        scheme: "bearer",
        description: "Your secret key. Server-side only: requests from a browser are refused, and a key sent in a URL is revoked.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["type", "code", "message", "param", "request_id"],
            properties: {
              type: { type: "string", enum: ["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "idempotency_error", "api_error"] },
              code: { type: "string", description: "A specific, stable reason. See the errors guide." },
              message: { type: "string", description: "A human-readable explanation. May change; branch on `code`." },
              param: { type: ["string", "null"], description: "The parameter the error is about, if any." },
              request_id: { type: "string", description: "Quote this if you contact support." },
            },
          },
        },
      },
      Account: {
        type: "object",
        properties: {
          object: { type: "string", const: "account" },
          id: { type: "string", example: "acct_8a1f0c3e9b2d4f6a8c0e1d2f3a4b5c6d" },
          business_name: { type: "string" },
          status: { type: "string", enum: ["sandbox", "pending_review", "approved", "rejected", "suspended"] },
          mode: { type: "string", enum: ["test", "live"] },
          livemode: { type: "boolean" },
          live_enabled: { type: "boolean", description: "Whether live keys work right now (verified business and a current paid plan)." },
          plan: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" }, rate_limit_per_minute: { type: "integer" } },
          },
          limits: {
            type: ["object", "null"],
            description: "Live keys only: the limits on money leaving the account, per currency in minor units.",
            properties: {
              daily_outflow: { type: "object", properties: { NGN: { type: "integer" }, USD: { type: "integer" } } },
              max_balance: { type: "object", properties: { NGN: { type: "integer" }, USD: { type: "integer" } } },
              max_single_payment: { type: "object", properties: { NGN: { type: "integer" }, USD: { type: "integer" } } },
            },
          },
          created_at: timestamp,
        },
      },
      Wallet: {
        type: "object",
        properties: {
          object: { type: "string", const: "wallet" },
          id: { type: "string", example: "wal_3f0c9a8e5b7d4e21a6f1c2b3d4e5f607" },
          type: { type: "string", enum: ["main", "customer"] },
          customer_id: { type: ["string", "null"] },
          currency: { type: "string", enum: ["NGN", "USD"] },
          available_balance: money("What the wallet holds."),
          status: { type: "string", enum: ["active", "frozen"], description: "A frozen wallet can receive money but not send it." },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      WalletEntry: {
        type: "object",
        properties: {
          object: { type: "string", const: "wallet_entry" },
          id: { type: "string", description: "Use as `starting_after` to page." },
          transaction_id: { type: "string" },
          kind: { type: "string" },
          amount: { type: "integer", description: "Signed, in minor units: negative left the wallet, positive arrived." },
          balance_after: { type: "integer" },
          created_at: timestamp,
        },
      },
      TransactionKind: {
        type: "string",
        enum: ["top_up", "wallet_move", "subscription", "deposit", "transfer", "conversion", "bill_payment", "card_issue", "card_funding", "card_withdrawal", "fee", "adjustment"],
      },
      TransactionStatus: { type: "string", enum: ["pending", "successful", "failed", "reversed"] },
      Transaction: {
        type: "object",
        properties: {
          object: { type: "string", const: "transaction" },
          id: { type: "string", example: "txn_0b6c4f1e2d3a4b5c6d7e8f9a0b1c2d3e" },
          kind: ref("TransactionKind"),
          status: ref("TransactionStatus"),
          currency: { type: "string", enum: ["NGN", "USD"] },
          amount: money("The amount."),
          fee: money("CheqPay's fee on it."),
          wallet_id: { type: ["string", "null"] },
          counterparty_wallet_id: { type: ["string", "null"] },
          customer_id: { type: ["string", "null"] },
          reference: { type: ["string", "null"], description: "Your own reference, unique per mode." },
          description: { type: ["string", "null"] },
          details: { type: "object", description: "Kind-specific facts, e.g. the plan for a subscription charge." },
          metadata: { type: "object", description: "What you attached when you created it." },
          failure: { type: ["object", "null"], properties: { code: { type: "string" }, message: { type: "string" } } },
          livemode: { type: "boolean" },
          created_at: timestamp,
          completed_at: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openapiDocument;
