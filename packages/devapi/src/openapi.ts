// The CheqPay API reference as an OpenAPI 3.1 document.
//
// Served at GET /v1/openapi.json and rendered by the developer portal. A guard
// test in apps/api checks that every /v1 route is described here (with the
// scope it really requires) and that everything described here exists, so the
// reference can't drift from the API.

import { ERROR_CODES } from "./errors";
import { EVENT_TYPES, WEBHOOK_RETRY_SCHEDULE_SECONDS } from "./events";
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

const CARD_ID = idParam("card", "card");

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
  /** A request body with several content types (file uploads); replaces `body`. */
  bodyContent?: Record<string, { schema: Schema }>;
  response: { status?: string; description: string; schema: Schema };
  /** Other success responses, e.g. 200 when an existing object is returned. */
  alsoReturns?: Record<string, string>;
  errors?: Record<string, string>;
  /** Moves money: refused while the account is frozen; needs an Idempotency-Key. */
  money?: boolean;
}

function op(o: OpSpec): Schema {
  const responses: Record<string, Schema> = {
    [o.response.status ?? "200"]: { description: o.response.description, content: { "application/json": { schema: o.response.schema } } },
    ...STANDARD_ERRORS,
  };
  for (const [status, description] of Object.entries(o.alsoReturns ?? {})) {
    responses[status] = { description, content: { "application/json": { schema: o.response.schema } } };
  }
  for (const [status, description] of Object.entries(o.errors ?? {})) responses[status] = errorResponse(description);
  return {
    operationId: o.id,
    summary: o.summary,
    description: o.description,
    tags: [o.tag],
    "x-cheqpay-scope": o.scope,
    ...(o.money ? { "x-cheqpay-money": true } : {}),
    parameters: o.parameters ?? [],
    ...(o.bodyContent
      ? { requestBody: { required: true, content: o.bodyContent } }
      : o.body
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

const idempotencyHeader: Schema = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "A unique string per request (a UUID works). Retrying with the same key returns the first result instead of acting twice; reusing it for a different request is refused.",
  schema: { type: "string", maxLength: 255 },
};

const metadata: Schema = {
  type: "object",
  description: "Up to 20 key/value strings of your own (keys up to 40 characters, values up to 500). Returned as sent; never used by CheqPay.",
  additionalProperties: { type: "string", maxLength: 500 },
};

const reference: Schema = {
  type: "string",
  maxLength: 100,
  pattern: "^[A-Za-z0-9_\\-.:/]+$",
  description: "Your own id for this object, unique per mode.",
};

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
    { name: "Customers", description: "Your own customers, and their identity verification (KYC)." },
    { name: "Files", description: "Identity documents to attach to customers." },
    { name: "Virtual accounts", description: "Dedicated NGN bank account numbers for verified customers." },
    { name: "Transfers", description: "Moving money between your own wallets." },
    { name: "Conversions", description: "Converting between NGN and USD wallets." },
    { name: "Bills", description: "Airtime, data, electricity and cable TV, paid from your NGN wallets." },
    { name: "Cards", description: "USD virtual cards for your verified customers." },
    { name: "Events", description: "Everything that happened, as delivered to your webhooks." },
    { name: "Test helpers", description: "Sandbox-only tools. Live keys get 404." },
  ],
  "x-cheqpay-scopes": SCOPES,
  "x-cheqpay-error-codes": ERROR_CODES,
  "x-cheqpay-events": EVENT_TYPES,
  "x-cheqpay-webhook-retries-seconds": WEBHOOK_RETRY_SCHEDULE_SECONDS,
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
    "/files": {
      post: op({
        id: "createFile",
        tag: "Files",
        scope: "files:write",
        summary: "Upload an identity document",
        description:
          "Upload a photo of a customer's government ID (JPG or PNG, up to 3 MB) and use the returned id in `identity.document_front` (and `document_back`) when you create the customer. Send multipart/form-data with `purpose` and `file`, or JSON with a `file` data URL. Files are stored encrypted, can be attached to one customer only, and their contents are never returned.",
        parameters: [idempotencyHeader],
        bodyContent: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["purpose", "file"],
              properties: { purpose: { type: "string", enum: ["identity_document"] }, file: { type: "string", format: "binary" } },
            },
          },
          "application/json": {
            schema: {
              type: "object",
              required: ["purpose", "file"],
              properties: {
                purpose: { type: "string", enum: ["identity_document"] },
                file: { type: "string", description: "A data URL: `data:image/jpeg;base64,…` or `data:image/png;base64,…`." },
              },
            },
          },
        },
        response: { status: "201", description: "The stored file.", schema: ref("File") },
        errors: { "400": "Not JPG/PNG, or the contents don't match the type (`file_type_mismatch`).", "413": "Over 3 MB (`body_too_large`)." },
      }),
    },
    "/customers": {
      get: op({
        id: "listCustomers",
        tag: "Customers",
        scope: "customers:read",
        summary: "List customers",
        description: "Your customers in the key's mode, newest first.",
        parameters: [
          { name: "kyc_status", in: "query", schema: { type: "string", enum: ["pending", "verified", "rejected"] } },
          { name: "email", in: "query", schema: { type: "string" } },
          { name: "reference", in: "query", schema: { type: "string" } },
          ...pageParams,
        ],
        response: { description: "A page of customers.", schema: listOf("Customer") },
      }),
      post: op({
        id: "createCustomer",
        tag: "Customers",
        scope: "customers:write",
        summary: "Create a customer",
        description:
          "Create a customer and start their identity verification. In test mode the outcome is immediate (see the sandbox test values); in live mode the customer starts `pending` and you receive `customer.verified` or `customer.rejected`. A verified customer has an NGN and a USD wallet and can be given a virtual account. BVN, ID number, date of birth and address are write-only: only `bvn_last4` comes back. One customer per BVN per mode.",
        parameters: [idempotencyHeader],
        body: ref("CustomerCreate"),
        response: { status: "201", description: "The customer, with its verification status.", schema: ref("Customer") },
        errors: {
          "400": "A field is invalid (`validation_error`), or a document id is unusable (`invalid_file`).",
          "409": "A customer with this BVN already exists (`customer_exists`), or the reference is taken (`duplicate_reference`).",
        },
      }),
    },
    "/customers/{id}": {
      get: op({
        id: "getCustomer",
        tag: "Customers",
        scope: "customers:read",
        summary: "Retrieve a customer",
        description: "One customer and their verification status.",
        parameters: [idParam("cus", "customer")],
        response: { description: "The customer.", schema: ref("Customer") },
        errors: { "404": "No such customer (`not_found`)." },
      }),
      patch: op({
        id: "updateCustomer",
        tag: "Customers",
        scope: "customers:write",
        summary: "Update a customer",
        description:
          "Change `metadata` at any time. A rejected customer's identity details can be corrected (send `kyc_consent: true` again), which restarts verification. A pending or verified customer's identity can't change (`customer_locked`).",
        parameters: [idParam("cus", "customer")],
        body: ref("CustomerUpdate"),
        response: { description: "The customer.", schema: ref("Customer") },
        errors: { "404": "No such customer (`not_found`).", "409": "The customer's identity can't change now (`customer_locked`)." },
      }),
    },
    "/virtual_accounts": {
      get: op({
        id: "listVirtualAccounts",
        tag: "Virtual accounts",
        scope: "virtual_accounts:read",
        summary: "List virtual accounts",
        description: "Your customers' virtual accounts in the key's mode, newest first.",
        parameters: [{ name: "customer_id", in: "query", schema: { type: "string" } }, ...pageParams],
        response: { description: "A page of virtual accounts.", schema: listOf("VirtualAccount") },
      }),
      post: op({
        id: "createVirtualAccount",
        tag: "Virtual accounts",
        scope: "virtual_accounts:write",
        summary: "Create a virtual account",
        description:
          "Open a dedicated NGN bank account number for a verified customer. Transfers into it credit the customer's NGN wallet, less your plan's deposit fee, and send `deposit.received`. One per customer: asking again returns the existing account with status 200.",
        parameters: [idempotencyHeader],
        body: ref("VirtualAccountCreate"),
        response: { status: "201", description: "The new virtual account.", schema: ref("VirtualAccount") },
        alsoReturns: { "200": "The customer already had one; here it is." },
        errors: {
          "409": "The customer isn't verified (`kyc_required`), or an account is already being opened (`virtual_account_in_progress`).",
          "503": "The banking partner didn't respond; nothing was created (`service_unavailable`).",
        },
      }),
    },
    "/virtual_accounts/{id}": {
      get: op({
        id: "getVirtualAccount",
        tag: "Virtual accounts",
        scope: "virtual_accounts:read",
        summary: "Retrieve a virtual account",
        description: "One virtual account.",
        parameters: [idParam("va", "virtual account")],
        response: { description: "The virtual account.", schema: ref("VirtualAccount") },
        errors: { "404": "No such virtual account (`not_found`)." },
      }),
    },
    "/transfers": {
      post: op({
        id: "createTransfer",
        tag: "Transfers",
        scope: "transfers:write",
        money: true,
        summary: "Transfer between wallets",
        description:
          "Move money between two of your wallets in the same currency: from your main wallet to a customer's, back, or between customers. Instant, free, and internal — money never leaves CheqPay this way. Sends `transfer.completed`.",
        parameters: [idempotencyHeader],
        body: ref("TransferCreate"),
        response: { status: "201", description: "The completed transfer.", schema: ref("Transaction") },
        errors: {
          "400": "The wallets hold different currencies (`currency_mismatch`).",
          "403": "The source wallet is frozen (`wallet_frozen`) or money movement is paused on your account (`account_frozen`).",
          "422": "Not enough in the source wallet (`insufficient_funds`), or over a limit (`limit_exceeded`).",
        },
      }),
    },
    "/fx/quotes": {
      post: op({
        id: "createFxQuote",
        tag: "Conversions",
        scope: "fx:write",
        summary: "Quote a conversion",
        description:
          "Price converting an amount between NGN and USD. The quote states exactly what will arrive (`converted_amount`) after CheqPay's fee, is good for 45 seconds, and can be used once, only by your account.",
        parameters: [idempotencyHeader],
        body: ref("FxQuoteCreate"),
        response: { status: "201", description: "The quote.", schema: ref("FxQuote") },
        errors: { "503": "Conversions can't be priced right now (`service_unavailable`)." },
      }),
    },
    "/fx/conversions": {
      post: op({
        id: "createFxConversion",
        tag: "Conversions",
        scope: "fx:write",
        money: true,
        summary: "Convert with a quote",
        description:
          "Spend a quote: debit the source wallet and credit the target wallet with the quoted amount. Both wallets must belong to the same owner (both your main wallets, or both one customer's). Answers 201 when settled. In live mode it can answer 202 with a `pending` transaction while the exchange confirms; you then receive `conversion.completed` or `conversion.failed` (which refunds the source wallet in full).",
        parameters: [idempotencyHeader],
        body: ref("FxConversionCreate"),
        response: { status: "201", description: "The conversion.", schema: ref("Transaction") },
        alsoReturns: { "202": "Live only: still confirming; watch for conversion.completed." },
        errors: {
          "409": "The quote was already used (`quote_used`).",
          "410": "The quote expired (`quote_expired`).",
          "422": "Not enough in the source wallet (`insufficient_funds`).",
        },
      }),
    },
    "/bills/services": {
      get: op({
        id: "listBillServices",
        tag: "Bills",
        scope: "bills:read",
        summary: "List bill services",
        description:
          "The services you can pay (airtime, data, electricity, cable TV) and their billers. `amount_type` says whether you send an `amount` or a `plan_id`. In live mode `available: false` means a biller can't be paid right now.",
        response: { description: "Every service, with its billers.", schema: listOf("BillService") },
      }),
    },
    "/bills/plans": {
      get: op({
        id: "listBillPlans",
        tag: "Bills",
        scope: "bills:read",
        summary: "List plans",
        description: "The data bundles or TV bouquets a biller sells today, with their prices. Live plans come straight from the biller, so prices can change; send the `amount` you saw with your payment to be told if one did.",
        parameters: [
          { name: "service", in: "query", required: true, schema: { type: "string", enum: ["data", "cabletv"] } },
          { name: "biller_id", in: "query", required: true, schema: { type: "string" } },
        ],
        response: { description: "The biller's plans.", schema: listOf("BillPlan") },
        errors: { "400": "service isn't data or cabletv (`validation_error`).", "404": "No such biller (`not_found`)." },
      }),
    },
    "/bills/validate": {
      post: op({
        id: "validateBillCustomer",
        tag: "Bills",
        scope: "bills:write",
        summary: "Validate a customer",
        description:
          "Check a meter, smartcard or phone number with the biller before paying, and get the name it's registered to. Moves no money. Recommended for electricity and cable TV. Sandbox: numbers ending in 0000 are invalid.",
        parameters: [idempotencyHeader],
        body: ref("BillValidate"),
        response: { description: "Whether the biller recognises the customer.", schema: ref("BillCustomerValidation") },
        errors: { "404": "No such biller (`not_found`).", "503": "The biller can't be reached (`service_unavailable`) or paid right now (`biller_unavailable`)." },
      }),
    },
    "/bills/payments": {
      get: op({
        id: "listBillPayments",
        tag: "Bills",
        scope: "bills:read",
        summary: "List bill payments",
        description: "Your bill payments in the key's mode, newest first. Each is a transaction of kind `bill_payment`.",
        parameters: [
          { name: "status", in: "query", schema: ref("TransactionStatus") },
          { name: "wallet_id", in: "query", schema: { type: "string" } },
          { name: "customer_id", in: "query", schema: { type: "string" } },
          { name: "reference", in: "query", schema: { type: "string" } },
          ...pageParams,
        ],
        response: { description: "A page of bill payments.", schema: listOf("Transaction") },
      }),
      post: op({
        id: "createBillPayment",
        tag: "Bills",
        scope: "bills:write",
        money: true,
        summary: "Pay a bill",
        description:
          "Pay a bill from an NGN wallet: your main wallet unless you send `wallet_id` (a customer's wallet works too). The wallet is debited the amount plus your plan's bill fee. " +
          "Answers 201 when the payment settled at once: `successful`, or `failed` with the amount and fee returned to the wallet. Answers 202 with a `pending` payment while the biller confirms; you then receive `bill_payment.successful` or `bill_payment.failed`. " +
          "Prepaid electricity tokens are in `details.token`. Live payments count toward your daily outflow limit. " +
          "Sandbox: customer numbers ending in 0000 fail, ending in 1111 stay pending (settle them with the test helper), anything else succeeds.",
        parameters: [idempotencyHeader],
        body: ref("BillPaymentCreate"),
        response: { status: "201", description: "The settled payment (successful or failed and refunded).", schema: ref("Transaction") },
        alsoReturns: { "202": "Still confirming with the biller; watch for bill_payment.successful or bill_payment.failed." },
        errors: {
          "400": "A field is wrong for this service (`validation_error`), or the wallet doesn't hold NGN (`currency_mismatch`).",
          "403": "The wallet is frozen (`wallet_frozen`) or money movement is paused on your account (`account_frozen`).",
          "404": "No such biller, plan or wallet (`not_found`).",
          "409": "The plan's price changed (`price_changed`), or the reference is taken (`duplicate_reference`).",
          "422": "Not enough in the wallet (`insufficient_funds`), or over a limit (`limit_exceeded`).",
          "503": "This biller can't be paid right now (`biller_unavailable`), or bill payments are paused (`feature_disabled`, `service_unavailable`).",
        },
      }),
    },
    "/bills/payments/{id}": {
      get: op({
        id: "getBillPayment",
        tag: "Bills",
        scope: "bills:read",
        summary: "Retrieve a bill payment",
        description: "One bill payment, with its current status and, once delivered, any token.",
        parameters: [idParam("txn", "bill payment")],
        response: { description: "The bill payment.", schema: ref("Transaction") },
        errors: { "404": "No such bill payment (`not_found`)." },
      }),
    },
    "/cards": {
      get: op({
        id: "listCards",
        tag: "Cards",
        scope: "cards:read",
        summary: "List cards",
        description: "Your customers' cards in the key's mode, newest first. Never the full card number.",
        parameters: [{ name: "customer_id", in: "query", schema: { type: "string" } }, ...pageParams],
        response: { description: "A page of cards.", schema: listOf("Card") },
      }),
      post: op({
        id: "createCard",
        tag: "Cards",
        scope: "cards:write",
        money: true,
        summary: "Issue a card",
        description:
          "Issue a USD virtual card to a verified customer, with a first top-up (`amount`, at least the minimum top-up). The funding wallet (the customer's USD wallet unless you send `wallet_id`; your main USD wallet also works) is debited the top-up plus your plan's card price and top-up fee. " +
          "Sandbox cards are issued at once (201, `card.active`). Live cards answer 202 `pending` while the issuer creates them; you then receive `card.active`, or `card.failed`, which returns the top-up and fees to the wallet. Live cards count toward your daily outflow limit and your plan's card limit.",
        parameters: [idempotencyHeader],
        body: ref("CardCreate"),
        response: { status: "201", description: "The issued card.", schema: ref("Card") },
        alsoReturns: { "202": "Live only: being issued; watch for card.active or card.failed." },
        errors: {
          "400": "Below the minimum top-up, or the wallet isn't USD or belongs to another customer (`validation_error`, `currency_mismatch`).",
          "403": "Your plan's card limit is reached (`plan_limit_reached`), or money movement is paused (`account_frozen`).",
          "404": "No such customer or wallet (`not_found`).",
          "409": "The customer isn't verified (`kyc_required`), or the reference is taken (`duplicate_reference`).",
          "422": "Not enough in the wallet (`insufficient_funds`), or over a limit (`limit_exceeded`).",
          "503": "Cards are paused (`feature_disabled`).",
        },
      }),
    },
    "/cards/{id}": {
      get: op({
        id: "getCard",
        tag: "Cards",
        scope: "cards:read",
        summary: "Retrieve a card",
        description: "One card, with its last four digits and status. In live mode `balance` is read from the issuer (null if it can't be reached).",
        parameters: [CARD_ID],
        response: { description: "The card.", schema: ref("Card") },
        errors: { "404": "No such card (`not_found`)." },
      }),
    },
    "/cards/{id}/details": {
      get: op({
        id: "getCardDetails",
        tag: "Cards",
        scope: "cards:details",
        summary: "Reveal card details",
        description:
          "The full card number, CVV and expiry, fetched from the issuer and never stored. Needs the `cards:details` scope; a live key with it must have an IP allowlist. At most 10 reveals per card per hour, each recorded in your security log. Sent with `Cache-Control: no-store`: never cache or log it.",
        parameters: [CARD_ID],
        response: { description: "The card's details.", schema: ref("CardDetails") },
        errors: { "404": "No such card (`not_found`).", "409": "The card isn't issued (`card_not_active`).", "429": "Revealed 10 times this hour (`rate_limited`)." },
      }),
    },
    "/cards/{id}/fund": {
      post: op({
        id: "fundCard",
        tag: "Cards",
        scope: "cards:write",
        money: true,
        summary: "Fund a card",
        description:
          "Load money onto a card from a USD wallet of the same owner (the card's own wallet unless you send `wallet_id`), plus your plan's top-up fee. 201 when loaded (`card.funded`), or `failed` with the amount and fee returned if the issuer refused. Live can answer 202 while the issuer confirms.",
        parameters: [CARD_ID, idempotencyHeader],
        body: ref("CardMove"),
        response: { status: "201", description: "The top-up transaction.", schema: ref("Transaction") },
        alsoReturns: { "202": "Live only: the issuer hasn't confirmed yet." },
        errors: {
          "409": "The card isn't active or is frozen (`card_not_active`).",
          "422": "Not enough in the wallet (`insufficient_funds`), or over a limit (`limit_exceeded`).",
        },
      }),
    },
    "/cards/{id}/withdraw": {
      post: op({
        id: "withdrawFromCard",
        tag: "Cards",
        scope: "cards:write",
        money: true,
        summary: "Withdraw from a card",
        description:
          "Take money off a card into a USD wallet of the same owner. The card is debited first; the wallet is credited only once the issuer confirms (`card.withdrawn`). A refusal (often: the card doesn't hold that much) answers `failed` and moves nothing.",
        parameters: [CARD_ID, idempotencyHeader],
        body: ref("CardMove"),
        response: { status: "201", description: "The withdrawal transaction.", schema: ref("Transaction") },
        alsoReturns: { "202": "Live only: the issuer hasn't confirmed yet; nothing has been credited." },
        errors: { "409": "The card isn't active or is frozen (`card_not_active`).", "422": "Sandbox: the card doesn't hold that much (`insufficient_funds`)." },
      }),
    },
    "/cards/{id}/freeze": {
      post: op({
        id: "freezeCard",
        tag: "Cards",
        scope: "cards:write",
        summary: "Freeze a card",
        description: "Stop the card being used or funded until it's unfrozen. Freezing a frozen card changes nothing. Sends `card.frozen`.",
        parameters: [CARD_ID, idempotencyHeader],
        response: { description: "The card.", schema: ref("Card") },
        errors: { "409": "The card isn't issued (`card_not_active`).", "503": "The issuer didn't respond; nothing changed (`service_unavailable`)." },
      }),
    },
    "/cards/{id}/unfreeze": {
      post: op({
        id: "unfreezeCard",
        tag: "Cards",
        scope: "cards:write",
        summary: "Unfreeze a card",
        description: "Let a frozen card be used again. Sends `card.unfrozen`.",
        parameters: [CARD_ID, idempotencyHeader],
        response: { description: "The card.", schema: ref("Card") },
        errors: { "409": "The card isn't issued (`card_not_active`).", "503": "The issuer didn't respond; nothing changed (`service_unavailable`)." },
      }),
    },
    "/cards/{id}/transactions": {
      get: op({
        id: "listCardTransactions",
        tag: "Cards",
        scope: "cards:read",
        summary: "List card transactions",
        description: "What the card was used for, newest first, as the issuer records it (purchases, declines, refunds). Up to `limit` (max 100) items.",
        parameters: [CARD_ID, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }],
        response: { description: "The card's transactions.", schema: listOf("CardTransaction") },
        errors: { "404": "No such card (`not_found`)." },
      }),
    },
    "/events": {
      get: op({
        id: "listEvents",
        tag: "Events",
        scope: "events:read",
        summary: "List events",
        description: "The last 30 days of events in the key's mode, newest first — the same objects your webhooks receive. Use it to catch up after downtime.",
        parameters: [{ name: "type", in: "query", schema: { type: "string", enum: EVENT_TYPES.map((e) => e.type) } }, ...pageParams],
        response: { description: "A page of events.", schema: listOf("Event") },
      }),
    },
    "/events/{id}": {
      get: op({
        id: "getEvent",
        tag: "Events",
        scope: "events:read",
        summary: "Retrieve an event",
        description: "One event, as delivered.",
        parameters: [idParam("evt", "event")],
        response: { description: "The event.", schema: ref("Event") },
        errors: { "404": "No such event (`not_found`)." },
      }),
    },
    "/test_helpers/virtual_accounts/{id}/deposit": {
      post: op({
        id: "simulateDeposit",
        tag: "Test helpers",
        scope: "virtual_accounts:write",
        summary: "Simulate a deposit",
        description:
          "Test mode only: pretend a bank transfer arrived in a virtual account. It is credited exactly like a real deposit (less the deposit fee) and sends `deposit.received`. At most ₦10,000,000 per call. Live keys get 404.",
        parameters: [idParam("va", "virtual account"), idempotencyHeader],
        body: {
          type: "object",
          required: ["amount"],
          additionalProperties: false,
          properties: { amount: money("How much arrived."), sender_name: { type: "string", maxLength: 80 } },
        },
        response: { status: "201", description: "The deposit transaction.", schema: ref("Transaction") },
        errors: { "404": "No such test virtual account (`not_found`)." },
      }),
    },
    "/test_helpers/cards/{id}/purchase": {
      post: op({
        id: "simulateCardPurchase",
        tag: "Test helpers",
        scope: "cards:write",
        summary: "Simulate a card purchase",
        description: "Test mode only: spend on a sandbox card. Approved when the card is active and holds enough; otherwise recorded as declined with a reason. Live keys get 404.",
        parameters: [CARD_ID, idempotencyHeader],
        body: {
          type: "object",
          required: ["amount"],
          additionalProperties: false,
          properties: { amount: money("How much the purchase is."), merchant_name: { type: "string", maxLength: 60 } },
        },
        response: { status: "201", description: "The card transaction (approved or declined).", schema: ref("CardTransaction") },
        errors: { "404": "No such test card (`not_found`).", "409": "The card isn't issued (`card_not_active`)." },
      }),
    },
    "/test_helpers/bill_payments/{id}/settle": {
      post: op({
        id: "settleTestBillPayment",
        tag: "Test helpers",
        scope: "bills:write",
        summary: "Settle a pending bill payment",
        description:
          "Test mode only: settle a pending sandbox bill payment (one whose customer number ends in 1111) as `successful` or `failed`. Failing it refunds the amount and fee. Sends the matching event. A payment that already settled is returned unchanged. Live keys get 404.",
        parameters: [idParam("txn", "bill payment"), idempotencyHeader],
        body: {
          type: "object",
          required: ["outcome"],
          additionalProperties: false,
          properties: { outcome: { type: "string", enum: ["successful", "failed"] } },
        },
        response: { description: "The bill payment.", schema: ref("Transaction") },
        errors: { "404": "No such test bill payment (`not_found`)." },
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
      File: {
        type: "object",
        properties: {
          object: { type: "string", const: "file" },
          id: { type: "string", example: "file_5d1e0f2a3b4c4d5e8f6a7b8c9d0e1f2a" },
          purpose: { type: "string", enum: ["identity_document"] },
          content_type: { type: "string", enum: ["image/jpeg", "image/png"] },
          size: { type: "integer", description: "Bytes." },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      Address: {
        type: "object",
        required: ["street", "city", "state", "postal_code"],
        additionalProperties: false,
        properties: {
          street: { type: "string", maxLength: 120 },
          city: { type: "string", maxLength: 60 },
          state: { type: "string", maxLength: 60 },
          postal_code: { type: "string", maxLength: 12 },
        },
      },
      Identity: {
        type: "object",
        required: ["type", "number", "document_front"],
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["NIN", "PASSPORT", "VOTERS_CARD", "DRIVERS_LICENSE"] },
          number: { type: "string", maxLength: 30 },
          document_front: { type: "string", description: "A file id from POST /files." },
          document_back: { type: "string", description: "Optional second side." },
        },
      },
      CustomerCreate: {
        type: "object",
        required: ["first_name", "last_name", "email", "phone", "date_of_birth", "bvn", "address", "identity", "kyc_consent"],
        additionalProperties: false,
        properties: {
          first_name: { type: "string", maxLength: 60 },
          middle_name: { type: "string", maxLength: 60 },
          last_name: { type: "string", maxLength: 60 },
          email: { type: "string", format: "email" },
          phone: { type: "string", description: "A Nigerian mobile number, e.g. 08031234567 or +2348031234567." },
          date_of_birth: { type: "string", format: "date", description: "YYYY-MM-DD. Customers must be 18 or over." },
          bvn: {
            type: "string",
            pattern: "^\\d{11}$",
            description: "Write-only. Sandbox: 22222222222 is rejected, 33333333333 stays pending for a minute, any other 11 digits verifies.",
          },
          address: ref("Address"),
          identity: ref("Identity"),
          kyc_consent: { type: "boolean", const: true, description: "You confirm the customer agreed to identity verification." },
          reference,
          metadata,
        },
      },
      CustomerUpdate: {
        type: "object",
        additionalProperties: false,
        description: "Every field optional. Identity fields are accepted only for a rejected customer.",
        properties: {
          first_name: { type: "string" },
          middle_name: { type: ["string", "null"] },
          last_name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          date_of_birth: { type: "string", format: "date" },
          bvn: { type: "string" },
          address: ref("Address"),
          identity: ref("Identity"),
          kyc_consent: { type: "boolean", const: true },
          metadata,
        },
      },
      Customer: {
        type: "object",
        properties: {
          object: { type: "string", const: "customer" },
          id: { type: "string", example: "cus_9c2e4a1b0d3f4e5a8b7c6d5e4f3a2b1c" },
          first_name: { type: "string" },
          middle_name: { type: ["string", "null"] },
          last_name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          bvn_last4: { type: "string", description: "The only part of the BVN ever returned." },
          identity: { type: "object", properties: { type: { type: "string" } } },
          kyc: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["pending", "verified", "rejected"] },
              reason: {
                type: ["object", "null"],
                description: "Why a customer was rejected.",
                properties: {
                  code: { type: "string", enum: ["identity_mismatch", "id_document_rejected", "verification_declined", "verification_unavailable"] },
                  message: { type: "string" },
                },
              },
              verified_at: { type: ["string", "null"], format: "date-time" },
            },
          },
          reference: { type: ["string", "null"] },
          metadata: { type: "object" },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      VirtualAccountCreate: {
        type: "object",
        required: ["customer_id"],
        additionalProperties: false,
        properties: { customer_id: { type: "string" }, reference, metadata },
      },
      VirtualAccount: {
        type: "object",
        properties: {
          object: { type: "string", const: "virtual_account" },
          id: { type: "string", example: "va_2b4d6f8a0c1e4a3b9d5f7e6c8a0b2d4f" },
          customer_id: { type: "string" },
          wallet_id: { type: "string", description: "The customer's NGN wallet that deposits credit." },
          currency: { type: "string", const: "NGN" },
          status: { type: "string", enum: ["active", "closed"] },
          account_number: { type: "string", description: "10 digits. Sandbox numbers start with 99." },
          bank_name: { type: "string" },
          account_name: { type: "string" },
          reference: { type: ["string", "null"] },
          metadata: { type: "object" },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      TransferCreate: {
        type: "object",
        required: ["from_wallet_id", "to_wallet_id", "amount"],
        additionalProperties: false,
        properties: {
          from_wallet_id: { type: "string" },
          to_wallet_id: { type: "string" },
          amount: money("How much to move."),
          reference,
          description: { type: "string", maxLength: 200 },
          metadata,
        },
      },
      Card: {
        type: "object",
        properties: {
          object: { type: "string", const: "card" },
          id: { type: "string", example: "card_2f4e6a8c0b1d3e5f7a9c1e3b5d7f9a1c" },
          customer_id: { type: "string" },
          wallet_id: { type: "string", description: "The wallet it was first funded from; the default for top-ups and withdrawals." },
          status: { type: "string", enum: ["pending", "active", "frozen", "failed"] },
          brand: { type: "string", enum: ["VISA", "MASTERCARD"] },
          last4: { type: ["string", "null"] },
          expiry_month: { type: ["integer", "null"] },
          expiry_year: { type: ["integer", "null"] },
          currency: { type: "string", const: "USD" },
          balance: { type: ["integer", "null"], description: "In cents. Live: read from the issuer when one card is retrieved; null in lists." },
          reference: { type: ["string", "null"] },
          metadata: { type: "object" },
          failure: { type: ["object", "null"], properties: { code: { type: "string" }, message: { type: "string" } } },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      CardDetails: {
        type: "object",
        properties: {
          object: { type: "string", const: "card_details" },
          card_id: { type: "string" },
          number: { type: ["string", "null"], description: "The full card number. Sensitive: never store or log it." },
          cvv: { type: ["string", "null"] },
          expiry_month: { type: ["integer", "null"] },
          expiry_year: { type: ["integer", "null"] },
        },
      },
      CardTransaction: {
        type: "object",
        properties: {
          object: { type: "string", const: "card_transaction" },
          id: { type: "string" },
          card_id: { type: "string" },
          type: { type: "string", enum: ["debit", "credit"] },
          status: { type: ["string", "null"] },
          amount: money("The amount."),
          currency: { type: "string" },
          description: { type: ["string", "null"] },
          merchant: { type: ["object", "null"], properties: { name: { type: ["string", "null"] }, city: { type: ["string", "null"] }, country: { type: ["string", "null"] } } },
          decline_reason: { type: ["string", "null"] },
          created_at: { type: ["string", "null"], format: "date-time" },
        },
      },
      CardCreate: {
        type: "object",
        required: ["customer_id", "amount"],
        additionalProperties: false,
        properties: {
          customer_id: { type: "string", description: "A verified customer." },
          amount: money("The first top-up, loaded onto the card when it's issued."),
          wallet_id: { type: "string", description: "A USD wallet: the customer's (the default) or your main wallet." },
          brand: { type: "string", enum: ["VISA", "MASTERCARD"], default: "VISA" },
          reference,
          metadata,
        },
      },
      CardMove: {
        type: "object",
        required: ["amount"],
        additionalProperties: false,
        properties: {
          amount: money("How much to move."),
          wallet_id: { type: "string", description: "A USD wallet of the card's owner, or your main wallet. Defaults to the card's own wallet." },
          reference,
          metadata,
        },
      },
      BillService: {
        type: "object",
        properties: {
          object: { type: "string", const: "bill_service" },
          id: { type: "string", enum: ["airtime", "data", "electricity", "cabletv"] },
          name: { type: "string" },
          customer_label: { type: "string", description: "What the customer number is: a phone, meter or smartcard number." },
          amount_type: { type: "string", enum: ["amount", "plan"], description: "Send `amount` (airtime, electricity) or `plan_id` (data, cable TV)." },
          requires_validation: { type: "boolean", description: "Validate the customer first; the biller may refuse unknown numbers." },
          billers: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string", example: "mtn" }, name: { type: "string" }, available: { type: "boolean" } },
            },
          },
        },
      },
      BillPlan: {
        type: "object",
        properties: {
          object: { type: "string", const: "bill_plan" },
          id: { type: "string", description: "Send as `plan_id`." },
          biller_id: { type: "string" },
          name: { type: "string", example: "1GB · 30 days" },
          amount: money("The plan's price."),
          currency: { type: "string", const: "NGN" },
          data: { type: ["string", "null"], example: "1GB" },
          validity: { type: ["string", "null"], example: "30 days" },
        },
      },
      BillValidate: {
        type: "object",
        required: ["service", "biller_id", "customer"],
        additionalProperties: false,
        properties: {
          service: { type: "string", enum: ["airtime", "data", "electricity", "cabletv"] },
          biller_id: { type: "string" },
          customer: { type: "string", maxLength: 30, description: "Phone number (airtime, data) or meter / smartcard number." },
        },
      },
      BillCustomerValidation: {
        type: "object",
        properties: {
          object: { type: "string", const: "bill_customer_validation" },
          service: { type: "string" },
          biller_id: { type: "string" },
          customer: { type: "string", description: "The number as it will be sent to the biller." },
          valid: { type: "boolean" },
          customer_name: { type: ["string", "null"], description: "The name the biller has for this customer, when it gives one." },
        },
      },
      BillPaymentCreate: {
        type: "object",
        required: ["service", "biller_id", "customer"],
        additionalProperties: false,
        properties: {
          service: { type: "string", enum: ["airtime", "data", "electricity", "cabletv"] },
          biller_id: { type: "string", example: "mtn" },
          customer: { type: "string", maxLength: 30, description: "Nigerian phone number (airtime, data) or meter / smartcard number." },
          plan_id: { type: "string", description: "Data and cable TV: a plan id from GET /bills/plans." },
          amount: money("Airtime and electricity: how much, in whole naira (a multiple of 100 kobo). With a plan: optional, the price you expect; a different current price is refused with `price_changed`."),
          wallet_id: { type: "string", description: "An NGN wallet to pay from. Defaults to your main NGN wallet." },
          reference,
          description: { type: "string", maxLength: 200 },
          metadata,
        },
      },
      FxQuoteCreate: {
        type: "object",
        required: ["from_currency", "to_currency", "amount"],
        additionalProperties: false,
        properties: {
          from_currency: { type: "string", enum: ["NGN", "USD"] },
          to_currency: { type: "string", enum: ["NGN", "USD"] },
          amount: money("How much of `from_currency` to convert."),
        },
      },
      FxQuote: {
        type: "object",
        properties: {
          object: { type: "string", const: "fx_quote" },
          id: { type: "string", example: "fxq_7e5c3a1f9d2b4e6a8c0f1e3d5b7a9c2e" },
          from_currency: { type: "string" },
          to_currency: { type: "string" },
          amount: money("What leaves the source wallet."),
          converted_amount: money("What arrives in the target wallet, after the fee."),
          fee: money("CheqPay's fee, in `fee_currency`."),
          fee_currency: { type: "string" },
          rate: { type: "number", description: "Whole units of to_currency per whole unit of from_currency, after the fee." },
          status: { type: "string", enum: ["open", "used", "expired"] },
          expires_at: timestamp,
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
      FxConversionCreate: {
        type: "object",
        required: ["quote_id", "from_wallet_id", "to_wallet_id"],
        additionalProperties: false,
        properties: {
          quote_id: { type: "string" },
          from_wallet_id: { type: "string" },
          to_wallet_id: { type: "string" },
          reference,
          description: { type: "string", maxLength: 200 },
          metadata,
        },
      },
      Event: {
        type: "object",
        properties: {
          object: { type: "string", const: "event" },
          id: { type: "string", example: "evt_4a6c8e0b2d4f4a1c9e7b5d3f1a8c6e4b", description: "Also the `webhook-id` header. Deduplicate on it." },
          type: { type: "string", enum: EVENT_TYPES.map((e) => e.type) },
          data: { type: "object", properties: { object: { type: "object", description: "The customer, virtual account or transaction the event is about." } } },
          livemode: { type: "boolean" },
          created_at: timestamp,
        },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openapiDocument;
