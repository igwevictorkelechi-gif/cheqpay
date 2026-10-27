// The parts of the dashboard a Super Admin can open to a sub admin: the pages
// and the dashboard proxies (/api/...) each one covers. Every sub admin keeps
// the Dashboard, Analytics and Live map.
//
// Same ids as apps/api/src/lib/adminSections.ts, which is the one that decides:
// the backend checks every call a sub admin makes against it. This copy decides
// what the menu shows and which pages the middleware lets them open.
//
// Not grantable, so not listed: Roles & Access, Security, Adjust Balance, Fees &
// Trading, Crypto Wallets, Feature Toggles, Payment and Provider settings,
// Provider Check and Admin Profile. Those stay with Super Admins.

export type AdminSection =
  | "giftcards"
  | "users"
  | "kyc"
  | "transactions"
  | "withdrawals"
  | "virtual_accounts"
  | "gadgets"
  | "referrals"
  | "ads"
  | "events"
  | "developers"
  | "bills"
  | "content"
  | "support"
  | "compliance";

export interface SectionInfo {
  id: AdminSection;
  label: string;
  /** What it lets them do, for the Super Admin choosing. */
  hint: string;
  /** Moves money: approving needs the sub admin's own authenticator. */
  money?: boolean;
  pages: string[];
  apis: string[];
}

export const ADMIN_SECTIONS: SectionInfo[] = [
  {
    id: "giftcards",
    label: "Gift cards",
    hint: "Review, approve and reject gift card trades; set rates.",
    money: true,
    pages: ["/gift-cards"],
    apis: ["/api/giftcards"],
  },
  {
    id: "users",
    label: "User management",
    hint: "Look up users, their balances and cards; block, enrol, reconcile.",
    money: true,
    pages: ["/users"],
    apis: ["/api/users", "/api/maplerad/customers"],
  },
  { id: "kyc", label: "KYC review", hint: "Approve or reject identity checks.", pages: ["/kyc"], apis: ["/api/kyc"] },
  {
    id: "transactions",
    label: "Transactions",
    hint: "The full transaction list.",
    pages: ["/transactions"],
    apis: ["/api/transactions"],
  },
  {
    id: "withdrawals",
    label: "Withdrawals review",
    hint: "Approve or reject payouts.",
    money: true,
    pages: ["/withdrawals"],
    apis: ["/api/withdrawals"],
  },
  {
    id: "virtual_accounts",
    label: "Virtual accounts",
    hint: "Customers' deposit accounts.",
    pages: ["/virtual-accounts"],
    apis: ["/api/virtual-accounts"],
  },
  {
    id: "gadgets",
    label: "Gadget store",
    hint: "Catalog, orders and discount codes.",
    pages: ["/gadgets"],
    apis: ["/api/gadgets"],
  },
  {
    id: "referrals",
    label: "Referrals",
    hint: "Applications, influencers, tasks and earnings.",
    money: true,
    pages: ["/referrals"],
    apis: ["/api/referrals"],
  },
  { id: "ads", label: "Ads", hint: "Campaigns, venues, screens and prices.", pages: ["/ads"], apis: ["/api/ads"] },
  { id: "events", label: "Events", hint: "Events, tickets and check-in.", pages: ["/events"], apis: ["/api/events"] },
  {
    id: "developers",
    label: "Developers",
    hint: "Developer applications, accounts and plans.",
    pages: ["/developers"],
    apis: ["/api/developers"],
  },
  { id: "bills", label: "Bill logos", hint: "Logos shown on the bills page.", pages: ["/bill-logos"], apis: ["/api/bill-logos"] },
  {
    id: "content",
    label: "Popup, banners & broadcast",
    hint: "The in-app popup, home banners and broadcast notifications.",
    pages: ["/features/popup", "/features/banner", "/features/broadcast"],
    apis: ["/api/popup", "/api/home-banner", "/api/broadcast"],
  },
  {
    id: "support",
    label: "Support contact",
    hint: "The support details shown in the app.",
    pages: ["/support-contact"],
    apis: ["/api/support-contact"],
  },
  {
    id: "compliance",
    label: "Compliance lookup",
    hint: "Look up a person or account (masked details).",
    pages: ["/compliance"],
    apis: ["/api/subject-lookup"],
  },
];

const IDS = new Set<string>(ADMIN_SECTIONS.map((s) => s.id));

/** Known section ids only, de-duplicated, in catalog order. */
export function cleanSections(input: unknown): AdminSection[] {
  const wanted = new Set(Array.isArray(input) ? input.filter((v): v is string => typeof v === "string") : []);
  return ADMIN_SECTIONS.map((s) => s.id).filter((id) => wanted.has(id) && IDS.has(id));
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Whether `path` (a page or a dashboard /api path) belongs to one of these sections. */
export function inSections(path: string, sections: readonly string[]): boolean {
  return ADMIN_SECTIONS.some(
    (s) => sections.includes(s.id) && [...s.pages, ...s.apis].some((p) => under(path, p)),
  );
}

export function sectionLabel(id: string): string {
  return ADMIN_SECTIONS.find((s) => s.id === id)?.label ?? id;
}
