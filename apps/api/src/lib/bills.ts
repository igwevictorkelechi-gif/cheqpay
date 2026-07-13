/**
 * Curated Nigerian bill-payment catalog. This is the single source of truth for
 * services, billers and plans the app offers; the web client fetches it via
 * GET /api/bills/catalog. Flutterwave codes (`flwBillerCode` / `flwItemCode`)
 * and `flwType` are wired in provider-correct shape — validate against current
 * Flutterwave docs before enabling live billing.
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
  /** Flutterwave biller code, where known. */
  flwBillerCode?: string;
}

export interface BillPlan {
  id: string;
  billerId: string;
  name: string;
  amount: string; // NGN decimal string
  flwItemCode?: string;
}

export interface ServiceConfig {
  service: BillService;
  label: string;
  emoji: string;
  /** Flutterwave bill `type` for POST /v3/bills. */
  flwType: string;
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

const NETWORKS: Biller[] = [
  { id: "mtn", name: "MTN", short: "MTN", color: "#FFCC00", flwBillerCode: "BIL099" },
  { id: "airtel", name: "Airtel", short: "Airtel", color: "#E40000", flwBillerCode: "BIL100" },
  { id: "glo", name: "Glo", short: "Glo", color: "#4CA838", flwBillerCode: "BIL102" },
  { id: "9mobile", name: "9mobile", short: "9mobile", color: "#006F46", flwBillerCode: "BIL103" },
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

const DISCOS: Biller[] = [
  { id: "ikedc", name: "Ikeja Electric", short: "IKEDC", color: "#C8102E", flwBillerCode: "BIL113" },
  { id: "ekedc", name: "Eko Electric", short: "EKEDC", color: "#0033A0", flwBillerCode: "BIL112" },
  { id: "aedc", name: "Abuja Electric", short: "AEDC", color: "#0066B3", flwBillerCode: "BIL115" },
  { id: "phed", name: "Port Harcourt Electric", short: "PHED", color: "#00833E", flwBillerCode: "BIL117" },
  { id: "kedco", name: "Kano Electric", short: "KEDCO", color: "#1A8A3B", flwBillerCode: "BIL116" },
  { id: "ibedc", name: "Ibadan Electric", short: "IBEDC", color: "#E2231A", flwBillerCode: "BIL118" },
];

const CABLE: Biller[] = [
  { id: "dstv", name: "DStv", short: "DStv", color: "#0072CE", flwBillerCode: "BIL121" },
  { id: "gotv", name: "GOtv", short: "GOtv", color: "#74AA50", flwBillerCode: "BIL122" },
  { id: "startimes", name: "StarTimes", short: "StarTimes", color: "#E60012", flwBillerCode: "BIL123" },
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

// Food / delivery wallet top-ups. Chowdeck has no public top-up API today; the
// tile ships as "Coming soon" and goes LIVE the moment a Flutterwave biller
// code exists for it — set CHOWDECK_FLW_BILLER_CODE on the API project (check
// your Flutterwave dashboard's biller catalog), no code change needed.
const FOOD: Biller[] = [
  {
    id: "chowdeck",
    name: "Chowdeck",
    short: "Chowdeck",
    color: "#0AA859",
    flwBillerCode: process.env.CHOWDECK_FLW_BILLER_CODE || undefined,
  },
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
    flwType: "AIRTIME",
    customerLabel: "Phone number",
    customerPlaceholder: "0801 234 5678",
    variableAmount: true,
    requiresValidation: false,
    billers: NETWORKS,
    plans: [],
  },
  {
    service: "data",
    label: "Data",
    emoji: "📶",
    flwType: "DATA BUNDLE",
    customerLabel: "Phone number",
    customerPlaceholder: "0801 234 5678",
    variableAmount: false,
    requiresValidation: false,
    billers: NETWORKS,
    plans: NETWORKS.flatMap((n) => dataPlans(n.id)),
  },
  {
    service: "electricity",
    label: "Electricity",
    emoji: "💡",
    flwType: "ELECTRICITY BILL",
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
    flwType: "CABLEBILLS",
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
    flwType: "BETTING",
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
    flwType: "FOOD",
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
