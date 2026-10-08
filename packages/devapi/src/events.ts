/**
 * Webhook events: what CheqPay tells a developer's server, and when.
 *
 * Each event is also kept for 30 days and readable from GET /v1/events, the
 * polling fallback for a server that missed a delivery. Payloads carry the
 * same objects the API returns — never a BVN, an ID number or a full card
 * number.
 */
export const EVENT_TYPES = [
  {
    type: "customer.verified",
    object: "customer",
    description: "A customer passed identity verification. Their NGN and USD wallets now exist and they can be given a virtual account.",
  },
  {
    type: "customer.rejected",
    object: "customer",
    description: "A customer failed identity verification. `kyc.reason` says why; update the customer to try again.",
  },
  {
    type: "virtual_account.created",
    object: "virtual_account",
    description: "A virtual account is open and can receive bank transfers.",
  },
  {
    type: "deposit.received",
    object: "transaction",
    description: "A bank transfer arrived in a customer's virtual account and was credited to their NGN wallet, less the deposit fee.",
  },
  {
    type: "transfer.completed",
    object: "transaction",
    description: "Money moved between two of your wallets.",
  },
  {
    type: "conversion.completed",
    object: "transaction",
    description: "A currency conversion settled and the target wallet was credited.",
  },
  {
    type: "conversion.failed",
    object: "transaction",
    description: "A currency conversion was refused and the source wallet was refunded in full.",
  },
  {
    type: "ping",
    object: "ping",
    description: "Sent only when you press \"Send test event\" on an endpoint in your dashboard.",
  },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]["type"];

export const EVENT_TYPE_IDS: readonly EventType[] = EVENT_TYPES.map((e) => e.type);

/** Event types an endpoint can subscribe to (everything but the dashboard's test ping). */
export const SUBSCRIBABLE_EVENT_TYPES: readonly EventType[] = EVENT_TYPE_IDS.filter((t) => t !== "ping");

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPE_IDS as readonly string[]).includes(value);
}

/**
 * How long after a failed delivery each retry happens. After the last one the
 * delivery is marked failed (it can still be resent from the dashboard), and an
 * endpoint that has failed every delivery for three days is switched off.
 */
export const WEBHOOK_RETRY_SCHEDULE_SECONDS = [60, 300, 1_800, 7_200, 21_600, 43_200, 86_400] as const;

/** Webhook signing follows the open Standard Webhooks format. */
export const WEBHOOK_HEADERS = {
  id: "webhook-id",
  timestamp: "webhook-timestamp",
  signature: "webhook-signature",
} as const;

/** Reject deliveries whose timestamp is further than this from your clock. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
