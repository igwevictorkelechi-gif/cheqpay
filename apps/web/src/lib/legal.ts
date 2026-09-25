/**
 * The facts every legal document on the site states, in one place.
 *
 * The Terms, Privacy Policy, Acceptable Use, AML and Cookie policies each
 * describe the same company, the same partners, the same limits and the same
 * retention rules. When those facts were written separately into each page they
 * drifted from each other and from what the product actually does — the Privacy
 * Policy promised a selfie check that doesn't exist, the Cookie Policy described
 * analytics cookies the site doesn't set, and the About page advertised Bitcoin
 * trading that isn't offered. Every document now reads its facts from here.
 *
 * Anything marked "fill in" below is a fact only the business can supply. It is
 * left null rather than guessed; the pages omit the line until it is set, so the
 * live site never shows a placeholder and never states something untrue.
 */

import { SITE_URL, SUPPORT_EMAIL } from "./site";

/** When the current versions of the documents took effect. */
export const LEGAL_EFFECTIVE_DATE = "25 September 2026";

export const COMPANY = {
  /** The brand users see. */
  brand: "CheqPay",
  /**
   * Fill in: the registered legal name (e.g. "CheqPay Technologies Limited").
   * Required by the NDPA to identify the data controller.
   */
  legalName: null as string | null,
  /** Fill in: CAC registration (RC) number. */
  rcNumber: null as string | null,
  /** Fill in: registered office address. */
  registeredAddress: null as string | null,
  website: SITE_URL,
  supportEmail: SUPPORT_EMAIL,
  /**
   * Where privacy requests go. Point this at a dedicated mailbox (e.g. a DPO
   * address) once one exists; until then requests go to support.
   */
  privacyEmail: SUPPORT_EMAIL,
  /** Where security researchers report vulnerabilities. */
  securityEmail: SUPPORT_EMAIL,
} as const;

/** "CheqPay" or "CheqPay (CheqPay Technologies Limited, RC 123456)". */
export function operatorName(): string {
  const parts = [COMPANY.legalName, COMPANY.rcNumber ? `RC ${COMPANY.rcNumber}` : null].filter(Boolean);
  return parts.length ? `${COMPANY.brand} (${parts.join(", ")})` : COMPANY.brand;
}

/**
 * The regulated partner that holds customer funds, issues accounts and cards,
 * pays out, and provides custody. CheqPay is the technology platform in front
 * of it. This is the structure the documents describe; if CheqPay obtains its
 * own licences, update this and the "Who provides your services" sections.
 *
 * Providers are described by what they do, never by name: the business has
 * chosen not to publish which companies it uses. The NDPA requires telling
 * people the recipients OR categories of recipients of their data, so
 * categories are enough — and the Privacy Policy offers the names on request.
 */
export const PRIMARY_PARTNER = {
  name: "our licensed payment partner",
  role:
    "a licensed payment and financial-infrastructure provider that holds customer funds, issues virtual accounts and cards, processes bank payouts and bill payments, and provides custody for supported digital assets",
} as const;

/** Where personal data is stored or processed, for the cross-border disclosure. */
export const DATA_LOCATIONS = [
  { what: "Account database, authentication and ID-document storage", where: "European Union (Ireland)", provider: "Cloud database provider" },
  { what: "Application servers", where: "United States", provider: "Cloud hosting provider" },
  { what: "Payments, accounts, cards, bill payments and custody", where: "Nigeria", provider: "Licensed payment partner" },
] as const;

/**
 * Service providers that process personal data on our behalf, by category.
 * Keep this list true: add a category here BEFORE sending a new kind of
 * provider personal data.
 */
export const SUB_PROCESSORS = [
  {
    name: "Licensed payment partner",
    purpose: "Identity verification (BVN and ID checks), accounts, payouts, cards, bill payments and digital-asset custody",
    data: "Identity and KYC data, contact details, transaction details",
  },
  {
    name: "Cloud database provider",
    purpose: "Database, sign-in and secure storage of ID-document images",
    data: "All account data",
  },
  {
    name: "Cloud hosting provider",
    purpose: "Hosting and running the CheqPay website and servers",
    data: "Request data, including IP address",
  },
  {
    name: "Error-monitoring service",
    purpose: "Finding and fixing faults",
    data: "Technical error reports, which may include device and request details",
  },
  {
    name: "Email delivery service",
    purpose: "Sending account and security emails",
    data: "Email address and email content",
  },
  {
    name: "Push-notification services",
    purpose: "Delivering notifications to your phone or browser",
    data: "Device or browser push token and notification content",
  },
] as const;

/**
 * Account limits by verification level, in naira. Mirrors KYC_TIER_LIMITS in
 * apps/api/src/lib/kyc.ts — a test asserts the two agree, because a limit the
 * Terms promise and the app doesn't enforce (or the reverse) is the kind of
 * mismatch that ends up in a complaint.
 */
export const TIER_LIMITS = [
  { tier: 1, requires: "Your name, date of birth, address and BVN, verified", singleTx: 50_000, dailyDeposit: 200_000, dailyWithdrawal: 100_000 },
  { tier: 2, requires: "A government-issued ID, verified", singleTx: 1_000_000, dailyDeposit: 5_000_000, dailyWithdrawal: 2_000_000 },
  { tier: 3, requires: "Enhanced due diligence, reviewed by our compliance team", singleTx: 20_000_000, dailyDeposit: 100_000_000, dailyWithdrawal: 50_000_000 },
] as const;

/** Money Laundering (Prevention and Prohibition) Act 2022: at least 5 years. */
export const RECORD_RETENTION_YEARS = 5;

/** Days after delivery to report a gadget that is faulty or not as described. */
export const GADGET_RETURN_DAYS = 7;

/** Days to report a transaction you did not authorise or that went wrong. */
export const DISPUTE_REPORT_DAYS = 30;

/** Complaint-handling commitments. */
export const COMPLAINTS = {
  acknowledgeWithinBusinessDays: 1,
  resolveWithinDays: 14,
} as const;

/** Minimum notice before a change to the Terms that affects users adversely. */
export const TERMS_CHANGE_NOTICE_DAYS = 14;

export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG")}`;
}
