import { supabase } from './supabase';

// Base URL of the custodial backend (apps/api).
const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://cheqpay-admin453.vercel.app';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
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

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // A blocked account is refused on every call. End the session once — the
    // auth listener then returns the app to sign-in — and let the server's
    // message ("This account has been blocked…") explain why.
    if (res.status === 403 && data?.code === 'account_blocked') {
      await supabase.auth.signOut().catch(() => undefined);
    }
    throw new ApiError(res.status, data?.error || res.statusText, data);
  }
  return data as T;
}

/**
 * The transaction PIN travels as a header, never in the body — the server
 * reads it there so it can never be swept into a stored transaction payload.
 */
function pinHeader(pin?: string): Record<string, string> {
  return pin ? { 'x-transaction-pin': pin } : {};
}

function idemKey(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
}

// ---- Types ----
export type AssetSymbol = 'BTC' | 'USDT' | 'USDC';

export interface MarketPrice {
  asset: string;
  priceUsd: string;
  priceNgn: string | null;
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
export interface Quote {
  quoteId: string;
  side: 'buy' | 'sell' | 'convert';
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
  bills: Record<'airtime' | 'data' | 'electricity' | 'cabletv' | 'betting' | 'food', number>;
}

export interface PublicLimits {
  deposit: { minUsd: number; enforced: boolean };
  withdrawal: { minNgn: number; minUsd: number; enforced: boolean };
  fees: PublicFees;
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
  bucket?: 'daily' | 'weekly' | 'monthly' | 'extended' | 'other' | null;
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
  service: 'airtime' | 'data' | 'electricity' | 'cabletv' | 'betting';
  label: string;
  emoji: string;
  customerLabel: string;
  customerPlaceholder: string;
  variableAmount: boolean;
  requiresValidation: boolean;
  billers: BillBiller[];
  plans: BillPlan[];
}
export type LedgerTxType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'BUY'
  | 'SELL'
  | 'CONVERT'
  | 'BILL'
  | 'CASHBACK'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'CARD_FUND'
  | 'CARD_WITHDRAW'
  | 'CARD_ISSUE';
export type LedgerTxStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
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
  | 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
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
  remaining: number | null;
  available: boolean;
}
export interface EventItem {
  id: string;
  title: string;
  description: string;
  venue: string;
  city: string;
  imageUrl: string | null;
  startsAt: string | null;
  active: boolean;
  tiers: EventTier[];
  fromPriceFormatted: string | null;
}
export type TicketStatus = 'VALID' | 'USED' | 'CANCELLED' | 'REFUNDED';
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

export const api = {
  /** Idempotently create the app-side profile + wallets. Call after login. */
  async ensureProvisioned(): Promise<void> {
    await apiFetch('/api/me', { method: 'POST' });
    await apiFetch('/api/wallets', { method: 'POST' });
  },

  getMe(): Promise<Me> {
    return apiFetch('/api/me');
  },

  /** Update editable profile fields (username, next of kin, DOB if unverified). */
  updateProfile(patch: {
    username?: string;
    dateOfBirth?: string;
    nextOfKin?: string;
  }): Promise<Me> {
    return apiFetch('/api/me', { method: 'PATCH', body: JSON.stringify(patch) });
  },

  /** Toggle instant withdrawal (skip 2FA on crypto withdrawals). */
  setInstantWithdrawal(enabled: boolean): Promise<{ instantWithdrawal: boolean }> {
    return apiFetch('/api/security/instant-withdrawal', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  /** Permanently delete the account. Refuses if the wallet holds a balance. */
  deleteAccount(pin?: string): Promise<{ deleted: boolean }> {
    return apiFetch('/api/me', { method: 'DELETE', headers: pinHeader(pin) });
  },

  getBalances(): Promise<{ balances: Balance[] }> {
    return apiFetch('/api/balances');
  },

  /** Public: withdrawal minimums and the fees set in the admin dashboard. */
  getLimits(): Promise<PublicLimits> {
    return apiFetch('/api/limits');
  },

  getWallets(): Promise<{ wallets: { asset: string; network: string; address: string }[] }> {
    return apiFetch('/api/wallets');
  },

  getPrice(asset: AssetSymbol): Promise<MarketPrice> {
    return apiFetch(`/api/market/${asset}/price`);
  },

  /** Ledger history. `asset` narrows to one currency (both legs of a convert count). */
  getTransactions(limit = 50, asset?: string): Promise<{ transactions: LedgerTransaction[] }> {
    const q = asset ? `&asset=${encodeURIComponent(asset)}` : '';
    return apiFetch(`/api/transactions?limit=${limit}${q}`);
  },

  getTransaction(id: string): Promise<{ transaction: LedgerTransaction }> {
    return apiFetch(`/api/transactions/${id}`);
  },

  createQuote(side: 'buy' | 'sell', asset: AssetSymbol, amount: string): Promise<Quote> {
    return apiFetch('/api/quotes', {
      method: 'POST',
      body: JSON.stringify({ side, asset, amount }),
    });
  },

  createConvertQuote(fromAsset: string, toAsset: string, amount: string): Promise<Quote> {
    return apiFetch('/api/quotes/convert', {
      method: 'POST',
      body: JSON.stringify({ fromAsset, toAsset, amount }),
    });
  },

  executeSwap(quoteId: string, pin?: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch('/api/swaps', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ quoteId }),
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
    return apiFetch('/api/crypto/deposit-addresses');
  },

  /** Mint a deposit address for one asset/network pair. */
  createWallet(
    asset: string,
    network: string,
    offramp?: boolean,
  ): Promise<{ wallets: { asset: string; network: string; address: string }[]; offramp?: boolean }> {
    return apiFetch('/api/wallets', {
      method: 'POST',
      body: JSON.stringify({ asset, network, offramp }),
    });
  },

  createCryptoWithdrawal(input: {
    asset: AssetSymbol;
    network: 'BITCOIN' | 'TRON' | 'ETHEREUM' | 'BSC';
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
    return apiFetch('/api/withdrawals/crypto', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ ...input, feeInclusive: true }),
    });
  },

  getTransactionPinStatus(): Promise<{
    isSet: boolean;
    locked: boolean;
    lockedUntil: string | null;
    attemptsRemaining: number | null;
    minLength: number;
    maxLength: number;
  }> {
    return apiFetch('/api/security/transaction-pin');
  },

  setTransactionPin(pin: string): Promise<{ isSet: boolean }> {
    return apiFetch('/api/security/transaction-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  /** Prove a PIN is correct without moving money. Same lockout as a payment. */
  verifyTransactionPin(pin: string): Promise<{ valid: boolean }> {
    return apiFetch('/api/security/transaction-pin/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  changeTransactionPin(currentPin: string, pin: string): Promise<{ isSet: boolean }> {
    return apiFetch('/api/security/transaction-pin', {
      method: 'PUT',
      body: JSON.stringify({ currentPin, pin }),
    });
  },

  getGadgets(): Promise<{ products: GadgetProduct[] }> {
    return apiFetch('/api/gadgets');
  },

  getGadget(id: string): Promise<{ product: GadgetProduct }> {
    return apiFetch(`/api/gadgets/${id}`);
  },

  validateGadgetDiscount(input: {
    code: string;
    productId: string;
    quantity: number;
  }): Promise<{ quote: GadgetDiscountQuote }> {
    return apiFetch('/api/gadgets/discount', {
      method: 'POST',
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
    return apiFetch('/api/gadgets/orders', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
  },

  getGadgetOrders(): Promise<{ orders: GadgetOrder[] }> {
    return apiFetch('/api/gadgets/orders');
  },

  // ---- Events / tickets ----
  getEvents(): Promise<{ events: EventItem[] }> {
    return apiFetch('/api/events');
  },
  getEvent(id: string): Promise<{ event: EventItem }> {
    return apiFetch(`/api/events/${id}`);
  },
  getMyTickets(): Promise<{ tickets: EventTicket[] }> {
    return apiFetch('/api/events/tickets');
  },
  buyTickets(
    input: { eventId: string; tierId: string; quantity: number },
    pin?: string,
  ): Promise<{ order: TicketOrderResult }> {
    return apiFetch('/api/events/tickets', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
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
    return apiFetch('/api/withdrawals/ngn', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      // The fee comes out of `amount`: the balance drops by exactly this much
      // and the bank receives amount − fee. See apps/api/src/lib/fees.ts.
      body: JSON.stringify({ ...input, feeInclusive: true }),
    });
  },

  getKyc(): Promise<{
    kycTier: number;
    limits: {
      singleTxKobo: string;
      dailyDepositKobo: string;
      dailyWithdrawalKobo: string;
      cryptoWithdrawalEnabled: boolean;
    };
    records: { id: string; tier: number; status: string; createdAt: string }[];
    /**
     * Enrolled with the payment provider. Separate from being verified: a
     * verified user with this false has no deposit account and no crypto
     * wallet. Optional because older API deployments don't send it.
     */
    providerEnrolled?: boolean;
    /** Name recorded at verification, used to prefill the form. */
    legalName?: string | null;
    /** YYYY-MM-DD, used to prefill the date picker. */
    dateOfBirth?: string | null;
  }> {
    return apiFetch('/api/kyc');
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
      type: 'NIN' | 'PASSPORT' | 'VOTERS_CARD' | 'DRIVERS_LICENSE';
      number: string;
      frontRef: string;
      backRef: string;
    };
    /**
     * Phone and address are the provider's requirements for enrolling a
     * customer, and a customer id is what a deposit account and a crypto
     * address both hang off. Omitting them silently costs the user both.
     */
    phone?: string;
    address?: { street: string; city: string; state: string; postalCode: string };
  }): Promise<{ id: string; status: string; tier: number; autoVerified: boolean; message: string }> {
    return apiFetch('/api/kyc', { method: 'POST', body: JSON.stringify(input) });
  },

  /** Upload one government-ID image (front or back). Returns a storage ref. */
  uploadKycDocument(
    image: string,
    side: 'front' | 'back',
    contentType: 'image/jpeg' | 'image/png'
  ): Promise<{ ref: string; side: 'front' | 'back' }> {
    return apiFetch('/api/kyc/documents', {
      method: 'POST',
      body: JSON.stringify({ image, side, contentType }),
    });
  },

  getNotificationPrefs(): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch('/api/notifications/preferences');
  },

  updateNotificationPrefs(
    patch: Record<string, boolean>
  ): Promise<{ preferences: Record<string, boolean> }> {
    return apiFetch('/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  registerPushToken(token: string): Promise<{ registered: boolean }> {
    return apiFetch('/api/push/register', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  getVirtualAccount(): Promise<{ virtualAccount: VirtualAccount | null }> {
    return apiFetch('/api/virtual-accounts');
  },

  createVirtualAccount(input: {
    firstName: string;
    lastName: string;
    phone?: string;
    bvn?: string;
  }): Promise<{ virtualAccount: VirtualAccount }> {
    return apiFetch('/api/virtual-accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getUsdAccount(): Promise<{ usdAccount: UsdAccount | null }> {
    return apiFetch('/api/virtual-accounts/usd');
  },

  createUsdAccount(input: UsdAccountInput): Promise<{ usdAccount: UsdAccount }> {
    return apiFetch('/api/virtual-accounts/usd', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getUsdAccountStatus(): Promise<{ usdStatus: UsdAccountStatus | null }> {
    return apiFetch('/api/virtual-accounts/usd/status');
  },

  getUsdAccountWire(): Promise<{ wire: UsdWireDetails | null }> {
    return apiFetch('/api/virtual-accounts/usd/wire');
  },

  getBillCatalog(): Promise<{ services: BillServiceConfig[]; cashback?: BillCashback }> {
    return apiFetch('/api/bills/catalog');
  },

  validateBillCustomer(input: {
    service: string;
    billerId: string;
    customer: string;
  }): Promise<{ valid: boolean; customerName: string | null }> {
    return apiFetch('/api/bills/validate', { method: 'POST', body: JSON.stringify(input) });
  },

  payBill(input: {
    service: string;
    billerId: string;
    customer: string;
    planId?: string;
    amount?: string;
  }, pin?: string): Promise<{ transactionId: string; status: string; providerRef?: string; token?: string | null }> {
    return apiFetch('/api/bills/pay', {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify(input),
    });
  },

  // ---- NGN payout (bank accounts / beneficiaries) ----
  getBanks(): Promise<{ banks: Bank[] }> {
    return apiFetch('/api/banks');
  },

  resolveBankAccount(input: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{ accountName: string }> {
    return apiFetch('/api/banks/resolve', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getBeneficiaries(): Promise<{ beneficiaries: Beneficiary[] }> {
    return apiFetch('/api/beneficiaries');
  },

  addBeneficiary(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }): Promise<{ beneficiary: Beneficiary }> {
    return apiFetch('/api/beneficiaries', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteBeneficiary(id: string): Promise<{ deleted: boolean }> {
    return apiFetch(`/api/beneficiaries/${id}`, { method: 'DELETE' });
  },

  // ---- Support ----
  getSupportContact(): Promise<{ email: string; phone: string; whatsapp: string }> {
    return apiFetch('/api/support/contact');
  },

  /** Admin feature switches — used to hide disabled features in the UI. */
  getFeatures(): Promise<{ features: FeatureFlags }> {
    return apiFetch('/api/features');
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
    return apiFetch('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
    });
  },

  /** Whether emailed statements are available (email delivery configured). */
  getStatementAvailability(): Promise<{ available: boolean; maxRangeDays: number }> {
    return apiFetch('/api/statements/request');
  },

  /** Generate a statement for the range and email it to the account address. */
  requestStatement(input: {
    from: string;
    to: string;
    format: 'pdf' | 'csv';
  }): Promise<{ sent: boolean; email: string; count: number }> {
    return apiFetch('/api/statements/request', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /** The user's virtual cards + whether issuing is currently available. */
  getCards(): Promise<{ cards: VirtualCard[]; available: boolean }> {
    return apiFetch('/api/cards');
  },

  /** Charges the card price (fees.cardIssueFeeUsd) from the USD wallet. */
  createCard(): Promise<{ card: VirtualCard; fee?: string }> {
    // Idempotent, so a double tap can't buy two cards.
    return apiFetch('/api/cards', { method: 'POST', headers: { 'idempotency-key': idemKey() } });
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
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ amount }),
    });
  },

  withdrawFromCard(id: string, amount: string, pin?: string): Promise<{ transactionId: string; status: string }> {
    return apiFetch(`/api/cards/${id}/withdraw`, {
      method: 'POST',
      headers: { 'idempotency-key': idemKey(), ...pinHeader(pin) },
      body: JSON.stringify({ amount }),
    });
  },

  setCardFrozen(id: string, freeze: boolean): Promise<{ status: string }> {
    return apiFetch(`/api/cards/${id}/freeze`, {
      method: 'POST',
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
    return apiFetch('/api/popup');
  },

  supportChat(
    messages: { role: 'user' | 'assistant'; content: string }[]
  ): Promise<{ reply: string; agent: boolean }> {
    return apiFetch('/api/support/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
  },
};

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
  /** The provider's current status, when read live. */
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
