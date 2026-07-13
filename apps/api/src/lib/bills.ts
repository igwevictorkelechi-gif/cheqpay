/**
 * Curated Nigerian bill-payment catalog. The single source of truth for the
 * services, billers and plans the app offers; clients fetch it via
 * GET /api/bills/catalog (which strips the provider codes below).
 *
 * Each biller carries the provider's EXACT identifier (`mapleradId`) — verified
 * against Maplerad's live biller lists. A biller with no identifier cannot be
 * paid and is served to clients as "Coming soon".
 *
 * CAUTION — plan prices: the rail matches data bundles and cable plans by exact
 * price, so every `amount` below must equal a real Maplerad bundle/plan price or
 * the purchase is refused. The prices here are NOT yet verified against
 * production (Maplerad's sandbox only exposes ₦100/₦200 test bundles), so
 * reconcile them against the live bundle lists before enabling data or cable.
 */

export type BillService =
  | "airtime"
  | "data"
  | "electricity"
  | "cabletv"
  | "betting"
  | "food";

export interface Biller {
  id: string;
  name: string;
  /** Short wordmark shown on the brand tile (e.g. "MTN", "DStv"). */
  short: string;
  /** Brand colour (hex) for the tile background. */
  color: string;
  /** Optional path/URL to a real brand logo; rendered instead of the wordmark
   * when present. Drop official assets in apps/web/public/billers/ and set this
   * to e.g. "/billers/mtn.svg". */
  logo?: string | null;
  /**
   * The provider's exact biller identifier (Maplerad), e.g. "mtn-data-ng".
   * Passed straight through at purchase — never fuzzy-matched, because the
   * wrong match here bills the wrong biller. A biller without one cannot be
   * paid and ships as "Coming soon".
   */
  mapleradId?: string;
}

export interface BillPlan {
  id: string;
  billerId: string;
  name: string;
  amount: string; // NGN decimal string
}

export interface ServiceConfig {
  service: BillService;
  label: string;
  emoji: string;
  /** Label + placeholder for the customer identifier field. */
  customerLabel: string;
  customerPlaceholder: string;
  /** User enters the amount (airtime/electricity/betting). */
  variableAmount: boolean;
  /** Customer must be validated before paying (electricity/cable TV). */
  requiresValidation: boolean;
  billers: Biller[];
  plans: BillPlan[];
}

/** Airtime: Maplerad has a per-network identifier, so we honour the user's pick
 *  rather than relying on its number-sniffing "ng-airtime" catch-all. */
const AIRTIME_NETWORKS: Biller[] = [
  { id: "mtn", name: "MTN", short: "MTN", color: "#FFCC00", mapleradId: "mtn-ng" },
  { id: "airtel", name: "Airtel", short: "Airtel", color: "#E40000", mapleradId: "airtel-ng" },
  { id: "glo", name: "Glo", short: "Glo", color: "#4CA838", mapleradId: "glo-ng" },
  { id: "9mobile", name: "9mobile", short: "9mobile", color: "#006F46", mapleradId: "9mobile-ng" },
];

const DATA_NETWORKS: Biller[] = [
  { id: "mtn", name: "MTN", short: "MTN", color: "#FFCC00", mapleradId: "mtn-data-ng" },
  { id: "airtel", name: "Airtel", short: "Airtel", color: "#E40000", mapleradId: "airtel-data-ng" },
  { id: "glo", name: "Glo", short: "Glo", color: "#4CA838", mapleradId: "glo-data-ng" },
  { id: "9mobile", name: "9mobile", short: "9mobile", color: "#006F46", mapleradId: "9mobile-data-ng" },
];

function dataPlans(billerId: string): BillPlan[] {
  return [
    { id: `${billerId}-500mb`, billerId, name: "500MB · 30 days", amount: "350" },
    { id: `${billerId}-1gb`, billerId, name: "1GB · 30 days", amount: "600" },
    { id: `${billerId}-2gb`, billerId, name: "2GB · 30 days", amount: "1200" },
    { id: `${billerId}-5gb`, billerId, name: "5GB · 30 days", amount: "2500" },
    { id: `${billerId}-10gb`, billerId, name: "10GB · 30 days", amount: "4000" },
  ];
}

/**
 * Electricity. Maplerad bills PREPAID and POSTPAID meters as separate billers,
 * so the customer must pick their meter type — we cannot infer it, and paying a
 * prepaid meter through the postpaid biller does not deliver a token. Each entry
 * therefore maps to exactly one Maplerad identifier.
 *
 * Maplerad also carries Enugu, Benin, Aba, Jos and Kaduna if we want to add them.
 */
const DISCOS: Biller[] = [
  { id: "ikedc-prepaid", name: "Ikeja Electric — Prepaid", short: "IKEDC", color: "#C8102E", mapleradId: "ikeja-electricity-prepaid-ng" },
  { id: "ikedc-postpaid", name: "Ikeja Electric — Postpaid", short: "IKEDC", color: "#C8102E", mapleradId: "ikeja-electricity-postpaid-ng" },
  { id: "ekedc-prepaid", name: "Eko Electric — Prepaid", short: "EKEDC", color: "#0033A0", mapleradId: "eko-electricity-prepaid-ng" },
  { id: "ekedc-postpaid", name: "Eko Electric — Postpaid", short: "EKEDC", color: "#0033A0", mapleradId: "eko-electricity-postpaid-ng" },
  { id: "aedc-prepaid", name: "Abuja Electric — Prepaid", short: "AEDC", color: "#0066B3", mapleradId: "abuja-electric-prepaid-ng" },
  { id: "aedc-postpaid", name: "Abuja Electric — Postpaid", short: "AEDC", color: "#0066B3", mapleradId: "abuja-electric-postpaid-ng" },
  { id: "phed-prepaid", name: "Port Harcourt Electric — Prepaid", short: "PHED", color: "#00833E", mapleradId: "portharcourt-electric-prepaid-ng" },
  { id: "phed-postpaid", name: "Port Harcourt Electric — Postpaid", short: "PHED", color: "#00833E", mapleradId: "portharcourt-electric-postpaid-ng" },
  // Kano's disco is KEDCO — the old brand-matching looked for "kano" and would
  // never have found it.
  { id: "kedco-prepaid", name: "Kano Electric — Prepaid", short: "KEDCO", color: "#1A8A3B", mapleradId: "kedco-electricity-prepaid-ng" },
  { id: "kedco-postpaid", name: "Kano Electric — Postpaid", short: "KEDCO", color: "#1A8A3B", mapleradId: "kedco-electricity-postpaid-ng" },
  { id: "ibedc-prepaid", name: "Ibadan Electric — Prepaid", short: "IBEDC", color: "#E2231A", mapleradId: "ibadan-electricity-prepaid-ng" },
  { id: "ibedc-postpaid", name: "Ibadan Electric — Postpaid", short: "IBEDC", color: "#E2231A", mapleradId: "ibadan-electricity-postpaid-ng" },
];

const CABLE: Biller[] = [
  { id: "dstv", name: "DStv", short: "DStv", color: "#0072CE", mapleradId: "dstv-ng" },
  { id: "gotv", name: "GOtv", short: "GOtv", color: "#74AA50", mapleradId: "gotv-ng" },
  { id: "startimes", name: "StarTimes", short: "StarTimes", color: "#E60012", mapleradId: "startimes-ng" },
];

function cablePlans(billerId: string): BillPlan[] {
  if (billerId === "gotv") {
    return [
      { id: "gotv-smallie", billerId, name: "GOtv Smallie", amount: "1575" },
      { id: "gotv-jinja", billerId, name: "GOtv Jinja", amount: "3300" },
      { id: "gotv-jolli", billerId, name: "GOtv Jolli", amount: "4850" },
      { id: "gotv-max", billerId, name: "GOtv Max", amount: "7200" },
    ];
  }
  if (billerId === "startimes") {
    return [
      { id: "st-nova", billerId, name: "Nova Bouquet", amount: "1900" },
      { id: "st-basic", billerId, name: "Basic Bouquet", amount: "3700" },
      { id: "st-smart", billerId, name: "Smart Bouquet", amount: "5100" },
      { id: "st-classic", billerId, name: "Classic Bouquet", amount: "6000" },
    ];
  }
  return [
    { id: "dstv-padi", billerId, name: "DStv Padi", amount: "3600" },
    { id: "dstv-yanga", billerId, name: "DStv Yanga", amount: "5100" },
    { id: "dstv-confam", billerId, name: "DStv Confam", amount: "9300" },
    { id: "dstv-compact", billerId, name: "DStv Compact", amount: "15700" },
    { id: "dstv-premium", billerId, name: "DStv Premium", amount: "44500" },
  ];
}

// Food / delivery wallet top-ups. Chowdeck has no public top-up API, and no rail
// we use can settle one, so the tile ships as "Coming soon".
const FOOD: Biller[] = [
  { id: "chowdeck", name: "Chowdeck", short: "Chowdeck", color: "#0AA859" },
];

// Betting wallet top-ups. Maplerad — our only rail — has no betting biller, so
// these ship as "Coming soon": with no provider code the pay route refuses
// before any money moves. Restore the codes here the day a rail can settle them.
const BETTING: Biller[] = [
  { id: "bet9ja", name: "Bet9ja", short: "Bet9ja", color: "#16723A" },
  { id: "sportybet", name: "SportyBet", short: "SportyBet", color: "#D6001C" },
  { id: "betking", name: "BetKing", short: "BetKing", color: "#00A859" },
  { id: "1xbet", name: "1xBet", short: "1xBet", color: "#1A5CB0" },
];

export const BILL_CATALOG: ServiceConfig[] = [
  {
    service: "airtime",
    label: "Airtime",
    emoji: "📲",
    customerLabel: "Phone number",
    customerPlaceholder: "0801 234 5678",
    variableAmount: true,
    requiresValidation: false,
    billers: AIRTIME_NETWORKS,
    plans: [],
  },
  {
    service: "data",
    label: "Data",
    emoji: "📶",
    customerLabel: "Phone number",
    customerPlaceholder: "0801 234 5678",
    variableAmount: false,
    requiresValidation: false,
    billers: DATA_NETWORKS,
    plans: DATA_NETWORKS.flatMap((n) => dataPlans(n.id)),
  },
  {
    service: "electricity",
    label: "Electricity",
    emoji: "💡",
    customerLabel: "Meter number",
    customerPlaceholder: "Enter meter number",
    variableAmount: true,
    requiresValidation: true,
    billers: DISCOS,
    plans: [],
  },
  {
    service: "cabletv",
    label: "Cable TV",
    emoji: "📺",
    customerLabel: "Smartcard / IUC number",
    customerPlaceholder: "Enter smartcard number",
    variableAmount: false,
    requiresValidation: true,
    billers: CABLE,
    plans: CABLE.flatMap((c) => cablePlans(c.id)),
  },
  {
    service: "betting",
    label: "Betting",
    emoji: "🎰",
    customerLabel: "User ID",
    customerPlaceholder: "Enter your account/user ID",
    variableAmount: true,
    requiresValidation: false,
    billers: BETTING,
    plans: [],
  },
  {
    service: "food",
    label: "Food delivery",
    emoji: "🛵",
    customerLabel: "Chowdeck phone number",
    customerPlaceholder: "0801 234 5678",
    variableAmount: true,
    requiresValidation: false,
    billers: FOOD,
    plans: [],
  },
];

export function getServiceConfig(service: string): ServiceConfig | undefined {
  return BILL_CATALOG.find((s) => s.service === service);
}

export function getBiller(service: string, billerId: string): Biller | undefined {
  return getServiceConfig(service)?.billers.find((b) => b.id === billerId);
}

/** Every biller across all services, tagged with its service. */
export function getAllBillers(): (Biller & { service: BillService; serviceLabel: string })[] {
  return BILL_CATALOG.flatMap((s) =>
    s.billers.map((b) => ({ ...b, service: s.service, serviceLabel: s.label }))
  );
}

/** True if a biller id exists anywhere in the catalog. */
export function billerExists(billerId: string): boolean {
  return getAllBillers().some((b) => b.id === billerId);
}

export function getPlan(service: string, planId: string): BillPlan | undefined {
  return getServiceConfig(service)?.plans.find((p) => p.id === planId);
}
