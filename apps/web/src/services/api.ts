import { supabase } from "./supabase";
import { clearUserCaches } from "@/lib/cache";

// Base URL of the custodial backend (apps/api). Override per-env if needed.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "https://cheqpay-admin453.vercel.app";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The sign-in has ended (signed out on another device, or expired past
 * refreshing). Rather than let every screen quietly show ₦0 because each
 * request was refused, end it here once and send the person to sign in again.
 */
let sessionEnding = false;
async function endExpiredSession(): Promise<void> {
  if (sessionEnding) return;
  sessionEnding = true;
  clearUserCaches();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login/?expired=1";
  }
}

// Many screens fire requests together; when the token is refused they all
// fail at once. Share one refresh between them.
let refreshing: Promise<string | null> | null = null;
function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = supabase.auth
      .refreshSession()
      .then(({ data, error }) => (error ? null : data.session?.access_token ?? null))
      .catch(() => null)
      .finally(() => {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      });
  }
  return refreshing;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await authHeader();
  const send = (authorization: Record<string, string>) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authorization,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
  let res = await send(auth);
  let text = await res.text();
  let data = text ? JSON.parse(text) : null;

  // The token was refused outright (not a PIN prompt, which has its own code).
  // Try one refresh; if the session is really gone, send them to sign in.
  if (res.status === 401 && data?.code === "unauthorized" && auth.Authorization) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await send({ Authorization: `Bearer ${fresh}` });
      text = await res.text();
      data = text ? JSON.parse(text) : null;
    }
    if (res.status === 401 && data?.code === "unauthorized") {
      await endExpiredSession();
    }
  }

  if (!res.ok) {
    // A blocked account is refused on every call. Rather than let each screen
    // fail on its own, end the session once and say why on the login page.
    if (res.status === 403 && data?.code === "account_blocked") {
      await supabase.auth.signOut().catch(() => undefined);
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login/?blocked=1";
      }
    }
    throw new ApiError(res.status, data?.error || res.statusText, data);
  }
  return data as T;
}

function idemKey(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
}

/**
 * The transaction PIN travels as a header, never in the body — the server
 * reads it there for a reason (a `pin` body field risks being spread into a
 * stored transaction payload). Absent PIN sends no header at all, which the
 * server answers with 401 `pin_required` or, if the account has no PIN yet and
 * the platform requires one, 428 `pin_not_set`.
 */
function pinHeader(pin?: string): Record<string, string> {
  return pin ? { "x-transaction-pin": pin } : {};
}

// ---- Types ----
export type AssetSymbol = "BTC" | "USDT" | "USDC";
export type ChartRange = "day" | "week" | "month" | "year" | "all";

export interface MarketPrice {
  asset: string;
  priceUsd: string;
  priceNgn: string | null;
}
export interface Candle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
}
export interface Balance {
  asset: string;
  available: string;
  locked: string;
  availableFormatted: string;
  lockedFormatted: string;
}
export interface Me {
  id: string;
  email: string;
  phone: string | null;
  kycTier: number;
  status: string;
  createdAt: string;
  username: string | null;
  dateOfBirth: string | null;
  nextOfKin: string | null;
  instantWithdrawal: boolean;
  limits: {
    singleTxKobo: string;
    dailyDepositKobo: string;
    dailyWithdrawalKobo: string;
    cryptoWithdrawalEnabled: boolean;
  };
}
export interface Quote {
  quoteId: string;
  side: "buy" | "sell";
  fromAsset: string;
  toAsset: string;
  amountIn: string;
  amountOut: string;
  rate: string;
  /** Convert quotes only: what the spread costs, minor units of toAsset. */
  feeOut?: string;
  /** Convert quotes only: the spread, in basis points (100 = 1%). */
  feeBps?: number;
  expiresAt: string;
}

/** Fees set in the admin dashboard, as the server charges them. */
export interface PublicFees {
  /** Flat, taken out of the amount withdrawn. */
  withdrawalFeeNgn: number;
  depositFeeBps: number;
  swapSpreadBps: number;
  fx: { buyUsdBps: number; sellUsdBps: number };
  /** Most an NGN deposit fee can be, in naira (0 = no cap). */
  depositFeeCapNgn: number;
  usdDepositFeeBps: number;
  usdDepositLargeFeeBps: number;
  usdDepositLargeThresholdUsd: number;
  /** Stablecoins that land as USD. */
  cryptoDepositFeeBps: number;
  /** Per crypto withdrawal, in USD, paid in the coin. */
  cryptoWithdrawalFeeUsd: number;
  cardIssueFeeUsd: number;
  cardFundMinUsd: number;
  cardFundFeeSmallUsd: number;
  cardFundFeeLargeBps: number;
  cardFundThresholdUsd: number;
  cardWithdrawFeeUsd: number;
  /** Markup on bill payments, per service. */
  bills: Record<"airtime" | "data" | "electricity" | "cabletv" | "betting" | "food", number>;
}

export interface PublicLimits {
  deposit: { minUsd: number; enforced: boolean };
  withdrawal: { minNgn: number; minUsd: number; enforced: boolean };
  fees: PublicFees;
}
export type LedgerTxType =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "BUY"
  | "SELL"
  | "CONVERT"
  | "BILL"
  | "CASHBACK"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "CARD_FUND"
  | "CARD_WITHDRAW"
  | "CARD_ISSUE"
  | "GADGET_PURCHASE"
  | "TICKET_PURCHASE"
  | "GIFTCARD_SELL"
  | "GIFTCARD_BUY"
  | "REFERRAL_REWARD"
  | "AD_PURCHASE"
  | "AD_REFUND"
  | "AD_PAYOUT";
export type LedgerTxStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REVERSED";
export interface LedgerTransaction {
  id: string;
  type: LedgerTxType;
  asset: string;
  network: string | null;
  amount: string;
  amountFormatted: string;
  fee: string;
  feeFormatted: string;
  status: LedgerTxStatus;
  txHash: string | null;
  createdAt: string;
  fromAsset: string | null;
  toAsset: string | null;
  fromFormatted: string | null;
  toFormatted: string | null;
  rate: string | null;
  toAddress: string | null;
  service: string | null;
  billerName: string | null;
  planName: string | null;
  customer: string | null;
  token: string | null;
  counterparty: string | null;
  note: string | null;
}

export interface VirtualAccount {
  accountNumber: string;
  bankName: string;
  bankCode?: string;
  permanent: boolean;
}

export interface UsdAccount {
  accountNumber: string;
  bankName: string;
  accountName?: string;
  currency: string;
  status?: string;
  consentRequired: boolean;
  consentUrl?: string | null;
}

export interface UsdAccountInput {
  identificationNumber: string;
  employmentStatus: string;
  employmentDescription: string;
  nationality: string;
  employerName: string;
  usResidencyStatus: string;
}

export interface UsdAccountStatus {
  status: string;
  messages: string[];
  currency: string;
  kycLink?: string | null;
  accountId?: string;
}

export interface UsdWireInstruction {
  type: string;
  routingNumber: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  accountName: string;
  memo: string;
  swiftCode: string;
}

export interface UsdWireDetails {
  bankName: string;
  accountNumber: string;
  accountName: string;
  instructions: UsdWireInstruction[];
}

export interface BillBiller {
  id: string;
  name: string;
  short: string;
  color: string;
  logo: string | null;
  /** True when the biller isn't payable yet (no provider code). */
  comingSoon?: boolean;
}
export interface BillPlan {
  id: string;
  billerId: string;
  name: string;
  amount: string;
  /** Data bundles only — the API ranks them by value and annotates each one. */
  sizeLabel?: string | null;
  validityLabel?: string | null;
  /** Naira per gigabyte, the metric the plans are ranked on. */
  nairaPerGb?: number | null;
  bucket?: "daily" | "weekly" | "monthly" | "extended" | "other" | null;
  /** A night / off-peak bundle. Also appears under its duration tab. */
  night?: boolean;
  /** An extra the bundle throws in, e.g. "2GB YouTube". */
  bonusLabel?: string | null;
  /** One of the best deals, worth leading with. */
  hot?: boolean;
  /** The single best naira-per-gigabyte plan this biller sells. */
  bestValue?: boolean;
}

/** The live cashback rate, so a plan tile can show what it really earns. */
export interface BillCashback {
  enabled: boolean;
  billBps: number;
  maxNgn: number;
}
export interface BillServiceConfig {
  service: "airtime" | "data" | "electricity" | "cabletv" | "betting";
  label: string;
  emoji: string;
  customerLabel: string;
  customerPlaceholder: string;
  variableAmount: boolean;
  requiresValidation: boolean;
  billers: BillBiller[];
  plans: BillPlan[];
}

// ---- Endpoints ----
export interface GadgetProduct {
  id: string;
  name: string;
  description: string;
  priceMinor: string;
  priceFormatted: string;
  compareAtMinor: string | null;
  compareAtFormatted: string | null;
  discountPercent: number | null;
  imageUrl: string | null;
  category: string;
  specs: { label: string; value: string }[];
  stock: number | null;
  available: boolean;
}
export interface GadgetDelivery {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
}
export type GadgetOrderStatus =
  | "PAID"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "REFUNDED";
export interface GadgetOrder {
  id: string;
  productName: string;
  quantity: number;
  unitPriceFormatted: string;
  totalFormatted: string;
  totalMinor: string;
  discountCode: string | null;
  discountMinor: string;
  discountFormatted: string | null;
  status: GadgetOrderStatus;
  delivery: GadgetDelivery;
  note: string | null;
  createdAt: string;
}
export interface GadgetDiscountQuote {
  code: string;
  subtotalMinor: string;
  subtotalFormatted: string;
  discountMinor: string;
  discountFormatted: string;
  totalMinor: string;
  totalFormatted: string;
}

// ---- Events / tickets ----
export interface EventTier {
  id: string;
  name: string;
  priceMinor: string;
  priceFormatted: string;
  /** A ₦0 tier — claimed without a PIN. */
  free?: boolean;
  remaining: number | null;
  available: boolean;
}
export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  /** Storefront category, e.g. "Music". Empty when not set. */
  category: string;
  imageUrl: string | null;
  startsAt: string | null;
  active: boolean;
  tiers: EventTier[];
  fromPriceFormatted: string | null;
  /** Has a free ticket that can still be claimed. */
  free?: boolean;
}
export type TicketStatus = "VALID" | "USED" | "CANCELLED" | "REFUNDED";
export interface EventTicket {
  id: string;
  reference: string;
  eventId: string;
  eventTitle: string;
  tierName: string;
  priceFormatted: string;
  status: TicketStatus;
  venue: string | null;
  startsAt: string | null;
  createdAt: string;
}
export interface TicketOrderResult {
  id: string;
  eventTitle: string;
  tierName: string;
  quantity: number;
  totalFormatted: string;
  totalMinor: string;
  tickets: { id: string; reference: string; status: TicketStatus }[];
  createdAt: string;
}

// Profile + wallet setup is idempotent but not free: two of the heaviest API
// calls, and almost every page asks for it. Run it once per signed-in user per
// half hour (per tab session) instead of on every page load.
const PROVISION_TTL_MS = 30 * 60_000;
const PROVISION_KEY = "cheqpay.provisioned";
let provisioning: { userId: string; done: Promise<void> } | null = null;

function provisionedRecently(userId: string): boolean {
  try {
    const raw = sessionStorage.getItem(PROVISION_KEY);
    if (!raw) return false;
    const { u, at } = JSON.parse(raw) as { u?: string; at?: number };
    return u === userId && typeof at === "number" && Date.now() - at < PROVISION_TTL_MS;
  } catch {
    return false;
  }
}

function markProvisioned(userId: string): void {
  try {
    sessionStorage.setItem(PROVISION_KEY, JSON.stringify({ u: userId, at: Date.now() }));
  } catch {
    /* storage unavailable: the in-memory guard still applies */
  }
}

export const api = {
  /**
   * Idempotently create the app-side profile + wallets. Call after login.
   * Skipped when it already ran for this user in the last half hour.
   */
  async ensureProvisioned(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id ?? "";
    if (provisioning && provisioning.userId === userId) return provisioning.done;
    if (userId && provisionedRecently(userId)) return;
    const done = (async () => {
      await apiFetch("/api/me", { method: "POST" });
      await apiFetch("/api/wallets", { method: "POST" });
      if (userId) markProvisioned(userId);
    })();
    provisioning = { userId, done };
    // A failed run must not stick: the next page tries again.
    done.catch(() => {
      if (provisioning?.done === done) provisioning = null;
    });
    return done;
  },

  getMe(): Promise<Me> {
    return apiFetch("/api/me");
  },

  /** Update editable profile fields (username, next of kin, DOB if unverified). */
  updateProfile(patch: {
    username?: string;
    dateOfBirth?: string;
    nextOfKin?: string;
  }): Promise<Me> {
    return apiFetch("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
  },

  /** Toggle instant withdrawal (skip 2FA on crypto withdrawals). */
  setInstantWithdrawal(enabled: boolean): Promise<{ instantWithdrawal: boolean }> {
    return apiFetch("/api/security/instant-withdrawal", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  },

  /** Permanently delete the account. Refuses if the wallet holds a balance. */
  deleteAccount(pin?: string): Promise<{ deleted: boolean }> {
    return apiFetch("/api/me", { method: "DELETE", headers: pinHeader(pin) });
  },

  getBalances(): Promise<{ balances: Balance[] }> {
    return apiFetch("/api/balances");
  },

  /** Public: withdrawal minimums and the fees set in the admin dashboard. */
  getLimits(): Promise<PublicLimits> {
    return apiFetch("/api/limits");
  },

  getWallets(): Promise<{ wallets: { asset: string; network: string; address: string }[] }> {
    return apiFetch("/api/wallets");
  },

  /** Ledger history. `asset` narrows to one currency (both legs of a convert count). */
  getTransactions(limit = 50, asset?: string): Promise<{ transactions: LedgerTransaction[] }> {
    const q = asset ? `&asset=${encodeURIComponent(asset)}` : "";
    return apiFetch(`/api/transactions?limit=${limit}${q}`);
  },

  getTransaction(id: string): Promise<{ transaction: LedgerTransaction }> {
    return apiFetch(`/api/transactions/${id}`);
  },

  getKyc(): Promise<{
    kycTier: number;
    /**
     * Enrolled with the payment provider. Separate from being verified: a
     * verified user with this false has no deposit account and no crypto
     * wallet, and needs to supply the contact details the provider requires.
     * Optional because older API deployments don't send it.
     */
    providerEnrolled?: boolean;
    /** Name recorded at verification, used to prefill the form. */
    legalName?: string | null;
    /** YYYY-MM-DD, used to prefill the date picker. */
    dateOfBirth?: string | null;
    limits: {
      singleTxKobo: string;
      dailyDepositKobo: string;
      dailyWithdrawalKobo: string;
      cryptoWithdrawalEnabled: boolean;
    };
    records: { id: string; tier: number; status: string; createdAt: string }[];
  }> {
    return apiFetch("/api/kyc");
  },

  submitKyc(input: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    bvn?: string;
    documentRefs?: string[];
    /**
     * The government ID. `type` + `number` are entered; the two refs are the
     * storage paths returned by uploadKycDocument for the front and back images.
     */
    identity: {
      type: "NIN" | "PASSPORT" | "VOTERS_CARD" | "DRIVERS_LICENSE";
      number: string;
      frontRef: string;
      backRef: string;
    };
    /**
     * Phone and address are not ours — they are Maplerad's requirements for
     * enrolling a customer, and a customer id is what a deposit account and a
     * crypto address both hang off. Omitting them silently costs the user both.
     */
    phone?: string;
    address?: {
      street: string;
      city: string;
      state: string;
      postalCode: string;
    };
  }): Promise<{
    id: string;
    status: string;
    tier: number;
    autoVerified: boolean;
    message: string;
  }> {
    return apiFetch("/api/kyc", { method: "POST", body: JSON.stringify(input) });
  },

  /**
   * Upload one government-ID image (front or back). Returns a storage ref to
   * pass back in submitKyc's `identity`. The image never becomes public.
   */
  uploadKycDocument(
    image: string,
    side: "front" | "back",
    contentType: "image/jpeg" | "image/png"
  ): Promise<{ ref: string; side: "front" | "back" }> {
    return apiFetch("/api/kyc/documents", {
      method: "POST",
      body: JSON.stringify({ image, side, contentType }),
    });
  },

  /** The key this browser subscribes with; null when push is off server-side. */
  getWebPushKey(): Promise<{ publicKey: string | null }> {
    return apiFetch("/api/push/web/key");
  },

  subscribeWebPush(sub: PushSubscriptionJSON): Promise<{ subscribed: boolean }> {
    return apiFetch("/api/push/web/subscribe", { method: "POST", body: JSON.stringify(sub) });
  },

  testWebPush(): Promise<{ sent: number }> {
    return apiFetch("/api/push/web/test", { method: "POST" });
  },

  unsubscribeWebPush(endpoint: string): Promise<{ removed: number }> {
    return apiFetch("/api/push/web/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) });
  },

  getNotificationPrefs(): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch("/api/notifications/preferences");
  },

  updateNotificationPrefs(
    patch: Record<string, boolean>
  ): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch("/api/notifications/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /** The user's NGN virtual account (dedicated NUBAN), or null if not created. */
  getVirtualAccount(): Promise<{ virtualAccount: VirtualAccount | null }> {
    return apiFetch("/api/virtual-accounts");
  },

  /** Create the NGN virtual account. A valid BVN mints a permanent NUBAN. */
  createVirtualAccount(input: {
    firstName: string;
    lastName: string;
    phone?: string;
    bvn?: string;
  }): Promise<{ virtualAccount: VirtualAccount }> {
    return apiFetch("/api/virtual-accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** The user's USD virtual account, or null if not opened. */
  getUsdAccount(): Promise<{ usdAccount: UsdAccount | null }> {
    return apiFetch("/api/virtual-accounts/usd");
  },

  /** Open the USD virtual account. Requires a verified (enrolled) profile. */
  createUsdAccount(input: UsdAccountInput): Promise<{ usdAccount: UsdAccount }> {
    return apiFetch("/api/virtual-accounts/usd", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** Check the approval status of the USD account request (null if not pollable). */
  getUsdAccountStatus(): Promise<{ usdStatus: UsdAccountStatus | null }> {
    return apiFetch("/api/virtual-accounts/usd/status");
  },

  /** ACH/FEDWIRE/SWIFT wire instructions for the USD account (null if none). */
  getUsdAccountWire(): Promise<{ wire: UsdWireDetails | null }> {
    return apiFetch("/api/virtual-accounts/usd/wire");
  },

  getPrice(asset: AssetSymbol): Promise<MarketPrice> {
    return apiFetch(`/api/market/${asset}/price`);
  },

  getChart(asset: AssetSymbol, range: ChartRange): Promise<{ candles: Candle[] }> {
    return apiFetch(`/api/market/${asset}/chart?range=${range}`);
  },

  createQuote(side: "buy" | "sell", asset: AssetSymbol, amount: string): Promise<Quote> {
    return apiFetch("/api/quotes", {
      method: "POST",
      body: JSON.stringify({ side, asset, amount }),
    });
  },

  /** Convert quote between any two supported assets, e.g. BTC -> USDT or USD -> NGN. */
  createConvertQuote(
    fromAsset: string,
    toAsset: string,
    amount: string
  ): Promise<Quote> {
    return apiFetch("/api/quotes/convert", {
      method: "POST",
      body: JSON.stringify({ fromAsset, toAsset, amount }),
    });
  },

  getBillCatalog(): Promise<{ services: BillServiceConfig[]; cashback?: BillCashback }> {
    return apiFetch("/api/bills/catalog");
  },

  validateBillCustomer(input: {
    service: string;
    billerId: string;
    customer: string;
  }): Promise<{ valid: boolean; customerName: string | null }> {
    return apiFetch("/api/bills/validate", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  payBill(input: {
    service: string;
    billerId: string;
    customer: string;
    planId?: string;
    amount?: string;
  }, pin?: string): Promise<{ transactionId: string; status: string; providerRef?: string; token?: string | null }> {
    return apiFetch("/api/bills/pay", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
  },

  executeSwap(quoteId: string, pin?: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch("/api/swaps", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ quoteId }),
    });
  },

  createCryptoWithdrawal(input: {
    asset: AssetSymbol;
    network: "BITCOIN" | "TRON" | "ETHEREUM" | "BSC";
    toAddress: string;
    amount: string;
  }, pin?: string): Promise<{
    transactionId: string;
    status: string;
    txHash?: string;
    amount?: string;
    fee?: string;
    youReceive?: string;
  }> {
    // The network fee comes out of the amount, so Max always works.
    return apiFetch("/api/withdrawals/crypto", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ ...input, feeInclusive: true }),
    });
  },

  /** Live crypto deposit addresses (manual custody). Absent asset = coming soon. */
  getCryptoDepositAddresses(): Promise<{
    addresses: {
      asset: string;
      address: string;
      network: string;
      networkLabel: string;
      /** Minted for this user — deposits credit automatically. */
      managed?: boolean;
    }[];
    /** Chains the user can additionally request an address on. */
    networks?: { network: string; label: string }[];
  }> {
    return apiFetch("/api/crypto/deposit-addresses");
  },

  /** Mint a deposit address for one asset/network pair. */
  createWallet(
    asset: string,
    network: string,
    offramp?: boolean
  ): Promise<{ wallets: { asset: string; network: string; address: string }[] }> {
    return apiFetch("/api/wallets", {
      method: "POST",
      body: JSON.stringify({ asset, network, offramp }),
    });
  },

  // ---- NGN payout (withdrawal) ----
  getBanks(): Promise<{ banks: Bank[] }> {
    return apiFetch("/api/banks");
  },

  resolveBankAccount(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{ accountName: string }> {
    return apiFetch("/api/banks/resolve", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  getBeneficiaries(): Promise<{ beneficiaries: Beneficiary[] }> {
    return apiFetch("/api/beneficiaries");
  },

  addBeneficiary(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }): Promise<{ beneficiary: Beneficiary }> {
    return apiFetch("/api/beneficiaries", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  deleteBeneficiary(id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/beneficiaries/${id}`, { method: "DELETE" });
  },

  /** Public support contact details (admin-editable). */
  getSupportContact(): Promise<{ email: string; phone: string; whatsapp: string }> {
    return apiFetch("/api/support/contact");
  },

  /** Admin feature switches — used to hide disabled features in the UI. */
  /** Gift cards we're buying right now, with the ₦ rate per country and type. */
  getGiftCardRates(): Promise<{ brands: GiftCardBrand[] }> {
    return apiFetch("/api/giftcards/sell/rates");
  },

  /** Upload one photo of a card (JPEG base64, no data: prefix). */
  uploadGiftCardPhoto(image: string, contentType: "image/jpeg" | "image/png" | "image/webp"): Promise<{ id: string }> {
    return apiFetch("/api/giftcards/sell/files", { method: "POST", body: JSON.stringify({ image, contentType }) });
  },

  /** Submit a card for review. The key makes a retried submit safe. */
  submitGiftCardTrade(
    input: { rateId: string; faceValue: number; code?: string; pin?: string; fileIds: string[]; note?: string },
    key: string,
  ): Promise<{ trade: GiftCardTrade }> {
    return apiFetch("/api/giftcards/sell/trades", {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(input),
    });
  },

  getGiftCardTrades(): Promise<{ trades: GiftCardTrade[] }> {
    return apiFetch("/api/giftcards/sell/trades");
  },

  // ---- CheqPay Ads ----
  getAdOptions(): Promise<AdOptions> {
    return apiFetch("/api/ads/options");
  },

  quoteAd(input: AdQuoteInput): Promise<AdQuote> {
    return apiFetch("/api/ads/quote", { method: "POST", body: JSON.stringify(input) });
  },

  createAdCampaign(input: AdCampaignInput, pin?: string): Promise<{ campaign: AdCampaign }> {
    return apiFetch("/api/ads/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
    });
  },

  getMyAdCampaigns(): Promise<{ campaigns: AdCampaign[] }> {
    return apiFetch("/api/ads/campaigns");
  },

  cancelAdCampaign(id: string): Promise<{ campaign: AdCampaign }> {
    return apiFetch(`/api/ads/campaigns/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },

  serveAd(placement: AdPlacement, opts: { lat?: number; lng?: number } = {}): Promise<{ ad: ServedAd | null }> {
    const q = new URLSearchParams({ placement, platform: "web" });
    if (opts.lat !== undefined && opts.lng !== undefined) {
      q.set("lat", opts.lat.toFixed(2));
      q.set("lng", opts.lng.toFixed(2));
    }
    return apiFetch(`/api/ads/serve?${q.toString()}`);
  },

  adEvent(campaignId: string, channel: string, kind: "view" | "click"): Promise<{ counted: boolean }> {
    return apiFetch("/api/ads/event", { method: "POST", body: JSON.stringify({ campaignId, channel, kind }) });
  },

  getAdVenues(state?: string | null): Promise<{ venues: AdVenueOption[]; myVenues: { id: string; name: string; city: string }[] }> {
    return apiFetch(`/api/ads/venues${state ? `?state=${encodeURIComponent(state)}` : ""}`);
  },

  nearbyVenues(opts: { lat?: number; lng?: number; category?: string | null } = {}): Promise<{ venues: NearbyVenue[]; basis: "location" | "state" | "all"; categories: { key: string; label: string }[] }> {
    const q = new URLSearchParams();
    if (opts.lat !== undefined && opts.lng !== undefined) {
      q.set("lat", opts.lat.toFixed(2));
      q.set("lng", opts.lng.toFixed(2));
    }
    if (opts.category) q.set("category", opts.category);
    const qs = q.toString();
    return apiFetch(`/api/venues/nearby${qs ? `?${qs}` : ""}`);
  },

  venueEvent(venueId: string, kind: "view" | "tap", campaignId?: string | null): Promise<{ counted: boolean }> {
    return apiFetch("/api/venues/event", { method: "POST", body: JSON.stringify({ venueId, kind, campaignId: campaignId ?? null }) });
  },

  getAdPrefs(): Promise<{ prefs: AdPrefs; categories: { key: string; label: string }[] }> {
    return apiFetch("/api/ads/prefs");
  },

  setAdPrefs(prefs: AdPrefs): Promise<{ prefs: AdPrefs }> {
    return apiFetch("/api/ads/prefs", { method: "POST", body: JSON.stringify(prefs) });
  },

  getMyReferral(): Promise<MyReferral> {
    return apiFetch("/api/referrals/me");
  },

  applyReferral(code: string): Promise<{ referrerName: string }> {
    return apiFetch("/api/referrals/apply", { method: "POST", body: JSON.stringify({ code }) });
  },

  getFeatures(): Promise<{ features: FeatureFlags }> {
    return apiFetch("/api/features");
  },

  /** Confirm a username exists before sending — never returns PII. */
  lookupUser(username: string): Promise<{ username: string; self: boolean }> {
    return apiFetch(`/api/users/lookup?username=${encodeURIComponent(username)}`);
  },

  /** Send NGN or crypto to another CheqPay user. */
  sendToUser(input: {
    username: string;
    asset: string;
    amount: string;
    note?: string;
  }, pin?: string): Promise<{
    transactionId: string;
    status: string;
    asset: string;
    amountFormatted: string;
    recipient: string;
  }> {
    return apiFetch("/api/transfers", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
    });
  },

  /** Whether emailed statements are available (email delivery configured). */
  getStatementAvailability(): Promise<{ available: boolean; maxRangeDays: number }> {
    return apiFetch("/api/statements/request");
  },

  /** Generate a statement for the range and email it to the account address. */
  requestStatement(input: {
    from: string;
    to: string;
    format: "pdf" | "csv";
  }): Promise<{ sent: boolean; email: string; count: number }> {
    return apiFetch("/api/statements/request", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  /** The user's virtual cards + whether issuing is currently available. */
  getCards(): Promise<{ cards: VirtualCard[]; available: boolean }> {
    return apiFetch("/api/cards");
  },

  /** Charges the card price (fees.cardIssueFeeUsd) from the USD wallet. */
  /**
   * Step 1: pay the card fee. Returns a card in status "unfunded" — nothing is
   * issued until it is funded (activateCard). A person who already paid for an
   * unfunded card gets that one back (alreadyPaid) rather than paying again.
   */
  createCard(): Promise<{ card: VirtualCard; fee?: string; alreadyPaid?: boolean }> {
    // Idempotent, so a double tap can't buy two cards.
    return apiFetch("/api/cards", { method: "POST", headers: { "idempotency-key": idemKey() } });
  },

  /** Step 2: fund a paid card with its first top-up; this is when it is created. */
  activateCard(id: string, amount: string, pin?: string): Promise<{ card: VirtualCard; fee: string }> {
    return apiFetch(`/api/cards/${id}/activate`, {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ amount }),
    });
  },

  /** Cancel a paid card that was never funded; its card fee is refunded. */
  cancelCard(id: string): Promise<{ cancelled: boolean }> {
    return apiFetch(`/api/cards/${id}`, { method: "DELETE" });
  },

  getCard(id: string): Promise<{ card: VirtualCard }> {
    return apiFetch(`/api/cards/${id}`);
  },

  /** Full PAN, CVV and expiry — requires step-up 2FA. Never cache these. */
  revealCard(id: string, pin?: string): Promise<{
    card: {
      name: string | null;
      number: string | null;
      maskedPan: string | null;
      expiry: string | null;
      cvv: string | null;
      brand: string | null;
    };
  }> {
    return apiFetch(`/api/cards/${id}/reveal`, { headers: pinHeader(pin) });
  },

  fundCard(id: string, amount: string, pin?: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch(`/api/cards/${id}/fund`, {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ amount }),
    });
  },

  withdrawFromCard(id: string, amount: string, pin?: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch(`/api/cards/${id}/withdraw`, {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ amount }),
    });
  },

  setCardFrozen(id: string, freeze: boolean): Promise<{ status: string }> {
    return apiFetch(`/api/cards/${id}/freeze`, {
      method: "POST",
      body: JSON.stringify({ freeze }),
    });
  },

  getCardTransactions(id: string): Promise<{ transactions: CardTransaction[] }> {
    return apiFetch(`/api/cards/${id}/transactions`);
  },

  /** Admin-published in-app popup (null when none is live). */
  getPopup(): Promise<{
    popup: {
      id: string;
      title: string;
      message: string;
      imageUrl: string | null;
      buttonText: string | null;
      buttonUrl: string | null;
    } | null;
  }> {
    return apiFetch("/api/popup");
  },

  /** Ask the AI support agent a question (FAQ-grounded). */
  supportChat(
    messages: { role: "user" | "assistant"; content: string }[]
  ): Promise<{ reply: string; agent: boolean }> {
    return apiFetch("/api/support/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
  },

  /** Whether this account has a transaction PIN, and whether it is locked. */
  getTransactionPinStatus(): Promise<{
    isSet: boolean;
    locked: boolean;
    lockedUntil: string | null;
    attemptsRemaining: number | null;
    minLength: number;
    maxLength: number;
  }> {
    return apiFetch("/api/security/transaction-pin");
  },

  /** Set a PIN for the first time. Refused (409) if one already exists. */
  setTransactionPin(pin: string): Promise<{ isSet: boolean }> {
    return apiFetch("/api/security/transaction-pin", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },

  /** Prove a PIN is correct without moving money. Same lockout as a payment. */
  verifyTransactionPin(pin: string): Promise<{ valid: boolean }> {
    return apiFetch("/api/security/transaction-pin/verify", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },

  /** Replace an existing PIN. The current one is verified, and counts to lockout. */
  changeTransactionPin(currentPin: string, pin: string): Promise<{ isSet: boolean }> {
    return apiFetch("/api/security/transaction-pin", {
      method: "PUT",
      body: JSON.stringify({ currentPin, pin }),
    });
  },

  // ---- Gadget store ----
  getGadgets(): Promise<{ products: GadgetProduct[] }> {
    return apiFetch("/api/gadgets");
  },

  getGadget(id: string): Promise<{ product: GadgetProduct }> {
    return apiFetch(`/api/gadgets/${id}`);
  },

  validateGadgetDiscount(input: {
    code: string;
    productId: string;
    quantity: number;
  }): Promise<{ quote: GadgetDiscountQuote }> {
    return apiFetch("/api/gadgets/discount", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  buyGadget(
    input: {
      productId: string;
      quantity: number;
      delivery: GadgetDelivery;
      note?: string;
      discountCode?: string;
    },
    pin?: string,
  ): Promise<{ order: GadgetOrder }> {
    return apiFetch("/api/gadgets/orders", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
  },

  getGadgetOrders(): Promise<{ orders: GadgetOrder[] }> {
    return apiFetch("/api/gadgets/orders");
  },

  // ---- Events / tickets ----
  /** Active events, optionally narrowed by search text, city, category and free-only. */
  getEvents(filters: { q?: string; city?: string; category?: string; free?: boolean } = {}): Promise<{
    events: EventItem[];
    filters?: { cities: string[]; categories: string[]; hasFree?: boolean };
  }> {
    const qs = new URLSearchParams();
    if (filters.q?.trim()) qs.set("q", filters.q.trim());
    if (filters.city) qs.set("city", filters.city);
    if (filters.category) qs.set("category", filters.category);
    if (filters.free) qs.set("free", "1");
    const s = qs.toString();
    return apiFetch(`/api/events${s ? `?${s}` : ""}`);
  },

  getEvent(id: string): Promise<{ event: EventItem }> {
    return apiFetch(`/api/events/${id}`);
  },

  getMyTickets(): Promise<{ tickets: EventTicket[] }> {
    return apiFetch("/api/events/tickets");
  },

  buyTickets(
    input: { eventId: string; tierId: string; quantity: number },
    pin?: string,
  ): Promise<{ order: TicketOrderResult }> {
    return apiFetch("/api/events/tickets", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
  },

  getGadgetOrder(id: string): Promise<{ order: GadgetOrder }> {
    return apiFetch(`/api/gadgets/orders/${id}`);
  },

  createNgnWithdrawal(input: {
    amount: string;
    bankCode: string;
    accountNumber: string;
    narration?: string;
  }, pin?: string): Promise<{
    transactionId: string;
    status: string;
    amount?: string;
    fee?: string;
    youReceive?: string;
  }> {
    return apiFetch("/api/withdrawals/ngn", {
      method: "POST",
      headers: { "idempotency-key": idemKey(), ...pinHeader(pin) },
      // The fee comes out of `amount`: the balance drops by exactly this much
      // and the bank receives amount − fee. See apps/api/src/lib/fees.ts.
      body: JSON.stringify({ ...input, feeInclusive: true }),
    });
  },
};

export type GiftCardType = "PHYSICAL" | "ECODE";
export type GiftCardTradeStatus = "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";

export interface GiftCardRate {
  id: string;
  country: string;
  countryName: string;
  cardType: GiftCardType;
  currency: string;
  symbol: string;
  /** ₦ per 1 unit of the card's currency, in kobo. */
  rateMinor: string;
  rateFormatted: string;
  minValue: number;
  maxValue: number;
  active: boolean;
}

export interface GiftCardBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  active: boolean;
  rates: GiftCardRate[];
}

export interface GiftCardTrade {
  id: string;
  brandName: string;
  country: string;
  countryName: string;
  cardType: GiftCardType;
  currency: string;
  faceValue: number;
  faceValueFormatted: string;
  rateFormatted: string;
  payoutMinor: string;
  payoutFormatted: string;
  status: GiftCardTradeStatus;
  rejectReason: string | null;
  hasCode: boolean;
  photos: number;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ReferralEarning {
  id: string;
  kind: "COMMISSION" | "BASIC_BONUS" | "WELCOME_BONUS" | "TASK";
  amountMinor: string;
  amountFormatted: string;
  status: "HELD" | "PAID" | "VOID";
  note: string | null;
  releaseAt: string;
  paidAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export type AdPlacement = "home" | "receipt" | "paybills";
export interface AdTargeting {
  states: string[];
  radius: { lat: number; lng: number; km: number } | null;
  ageMin: number;
  ageMax: number;
  segments: string[];
  platforms: string[];
  newUsersOnly: boolean;
  dayparts: string[];
  frequencyCap: number;
}
export interface AdOptions {
  today: string;
  canAdvertise: boolean;
  placements: { key: AdPlacement; label: string; perDayMinor: string; perDayFormatted: string; slotsPerDay: number }[];
  categories: { key: string; label: string; adultOnly: boolean }[];
  segments: { key: string; label: string }[];
  dayparts: { key: string; label: string }[];
  platforms: string[];
  states: string[];
  maxDays: number;
  minAudience: number;
  maxFrequencyCap: number;
  nearby: { perDayMinor: string; perDayFormatted: string };
  minScreenHours: number;
  influencer: { feePercent: number; minPayMinor: string; minPayFormatted: string; maxPosts: number };
  defaults: AdTargeting;
}
export interface AdQuoteInput {
  placements: AdPlacement[];
  venues?: string[];
  nearbyVenueId?: string | null;
  /** Paid posts by CheqPay influencers: pay per approved post (kobo), how many, and what to post. */
  influencer?: { payPerPostMinor: string; posts: number; brief: string } | null;
  startDay: string;
  days: number;
  category: string;
  targeting: AdTargeting;
}
export interface AdCampaignInput extends AdQuoteInput {
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl?: string | null;
  cta?: string;
}
export interface AdQuoteLine {
  channel: string;
  label: string;
  perDayMinor: string;
  days: number;
  totalMinor: string;
  totalFormatted: string;
  /** What `days` counts: days (default) or influencer posts. */
  unit?: "day" | "post";
}
export interface AdQuote {
  lines: AdQuoteLine[];
  totalMinor: string;
  totalFormatted: string;
  availability: Record<string, { day: string; free: number }[]>;
  soldOut: { channel: string; label: string; day: string }[];
  /** null when the campaign has no in-app placements (screens / Nearby only). */
  audience: number | null;
  minAudience: number;
  audienceOk: boolean;
}
export interface AdCampaign {
  id: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
  category: string;
  categoryLabel: string;
  targeting: AdTargeting;
  startDay: string;
  endDay: string;
  days: number;
  status: "PENDING_REVIEW" | "APPROVED" | "LIVE" | "ENDED" | "REJECTED" | "CANCELLED";
  reason: string | null;
  placements: AdPlacement[];
  paidFormatted: string;
  refundedFormatted: string;
  breakdown: AdQuoteLine[];
  createdAt: string;
  stats: {
    views: number;
    clicks: number;
    byChannel: { channel: string; label: string; views: number; clicks: number }[];
    byDay: { day: string; views: number; clicks: number }[];
  };
  influencer: { maxPosts: number; usedPosts: number; refundedPosts: number; payFormatted: string; brief: string } | null;
}
export interface ServedAd {
  campaignId: string;
  channel: string;
  businessName: string;
  headline: string;
  body: string;
  image: string;
  linkUrl: string | null;
  cta: string;
  why: string[];
}
export interface AdVenueOption {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  city: string;
  state: string;
  photo: string | null;
  perDayMinor: string;
  perDayFormatted: string;
  screens: number;
  online: boolean;
}
export interface NearbyVenue {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  photo: string | null;
  address: string;
  city: string;
  state: string;
  distanceKm: number | null;
  openNow: boolean | null;
  hours: string | null;
  mapsUrl: string | null;
  featured: boolean;
  offer: { campaignId: string; headline: string; body: string; image: string; linkUrl: string | null; cta: string } | null;
}
export interface AdPrefs {
  personalised: boolean;
  mutedCategories: string[];
}

export interface MyReferral {
  code: string;
  kind: "BASIC" | "INFLUENCER";
  link: string;
  active: boolean;
  basicBonusFormatted: string;
  welcomeBonusFormatted: string | null;
  qualifyMinFormatted: string;
  holdHours: number;
  counts: { signedUp: number; qualified: number };
  totals: { heldFormatted: string; paidFormatted: string; lifetimeFormatted: string; thisMonthFormatted: string };
  earnings: ReferralEarning[];
  referredBy: string | null;
  canApply: boolean;
  application: { status: string; reason: string | null } | null;
  portalUrl: string;
}

export interface FeatureFlags {
  ngn_deposits: boolean;
  ngn_withdrawals: boolean;
  crypto_trading: boolean;
  crypto_deposits: boolean;
  crypto_withdrawals: boolean;
  bill_payments: boolean;
  virtual_cards: boolean;
  p2p_transfers: boolean;
  gadgets: boolean;
  events: boolean;
  gift_cards_sell: boolean;
  gift_cards_buy: boolean;
  referrals: boolean;
  ads: boolean;
}

export interface CardTransaction {
  id: string;
  amountMinor: string | null;
  currency: string;
  description: string | null;
  status: string | null;
  entry: string | null;
  merchant: string | null;
  createdAt: string | null;
}
export interface VirtualCard {
  id: string;
  currency: string;
  brand: string | null;
  maskedPan: string | null;
  status: string;
  createdAt: string;
  /** Live balance in minor units (cents), or null when it could not be read. */
  balanceMinor?: string | null;
  /** The provider's current status, when read live (e.g. "ACTIVE"/"DISABLED"). */
  liveStatus?: string | null;
}

export interface Bank {
  code: string;
  name: string;
}

export interface Beneficiary {
  id: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}
