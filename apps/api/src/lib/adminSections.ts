// apps/api/src/lib/adminSections.ts
//
// The parts of the admin dashboard a Super Admin can open to a sub admin, and
// the backend paths each one covers. Every sub admin keeps the Dashboard,
// Analytics and Live map (read-only); anything listed here is extra, granted
// per person from Roles & Access.
//
// What is NOT here can't be granted, whoever asks: roles and sub admins,
// security (sessions, blocked IPs), adjust balance and crypto credits, fees and
// trading, crypto wallets, payment and provider settings, feature toggles, the
// admin profile and the shared authenticator. Those stay with Super Admins.
//
// Keep the ids in step with apps/admin/lib/adminSections.ts, which maps the same
// ids to dashboard pages. This file is the one that decides: requireAdmin checks
// every backend call against it, so a dashboard list that drifts can only hide a
// menu item, never open one.

export const ADMIN_SECTIONS = {
  giftcards: ["/api/admin/giftcards"],
  users: ["/api/admin/users", "/api/admin/maplerad/customers"],
  kyc: ["/api/admin/kyc"],
  transactions: ["/api/admin/transactions"],
  withdrawals: ["/api/admin/withdrawals"],
  virtual_accounts: ["/api/admin/virtual-accounts"],
  gadgets: ["/api/admin/gadgets"],
  referrals: ["/api/admin/referrals"],
  ads: ["/api/admin/ads"],
  events: ["/api/admin/events"],
  developers: ["/api/admin/developers"],
  bills: ["/api/admin/bills"],
  content: ["/api/admin/popup", "/api/admin/home-banner", "/api/admin/broadcast"],
  support: ["/api/admin/support-contact"],
  compliance: ["/api/admin/subjects"],
} as const satisfies Record<string, readonly string[]>;

export type AdminSection = keyof typeof ADMIN_SECTIONS;

export const ADMIN_SECTION_IDS = Object.keys(ADMIN_SECTIONS) as AdminSection[];

export function isAdminSection(v: unknown): v is AdminSection {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ADMIN_SECTIONS, v);
}

/** Known section ids only, de-duplicated, in catalog order. */
export function cleanSections(input: unknown): AdminSection[] {
  const wanted = new Set(Array.isArray(input) ? input.filter(isAdminSection) : []);
  return ADMIN_SECTION_IDS.filter((s) => wanted.has(s));
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The section a backend path belongs to, or null. */
export function sectionForPath(pathname: string): AdminSection | null {
  for (const id of ADMIN_SECTION_IDS) {
    if (ADMIN_SECTIONS[id].some((p) => under(pathname, p))) return id;
  }
  return null;
}
