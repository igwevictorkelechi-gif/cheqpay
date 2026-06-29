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
  | "betting";

export interface Biller {
  id: string;
  name: string;
  emoji: string;
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
  { id: "mtn", name: "MTN", emoji: "🟡", flwBillerCode: "BIL099" },
  { id: "airtel", name: "Airtel", emoji: "🔴", flwBillerCode: "BIL100" },
  { id: "glo", name: "Glo", emoji: "🟢", flwBillerCode: "BIL102" },
  { id: "9mobile", name: "9mobile", emoji: "🟩", flwBillerCode: "BIL103" },
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
  { id: "ikedc", name: "Ikeja Electric", emoji: "💡", flwBillerCode: "BIL113" },
  { id: "ekedc", name: "Eko Electric", emoji: "💡", flwBillerCode: "BIL112" },
  { id: "aedc", name: "Abuja Electric", emoji: "💡", flwBillerCode: "BIL115" },
  { id: "phed", name: "Port Harcourt Electric", emoji: "💡", flwBillerCode: "BIL117" },
  { id: "kedco", name: "Kano Electric", emoji: "💡", flwBillerCode: "BIL116" },
  { id: "ibedc", name: "Ibadan Electric", emoji: "💡", flwBillerCode: "BIL118" },
];

const CABLE: Biller[] = [
  { id: "dstv", name: "DStv", emoji: "📺", flwBillerCode: "BIL121" },
  { id: "gotv", name: "GOtv", emoji: "📺", flwBillerCode: "BIL122" },
  { id: "startimes", name: "StarTimes", emoji: "📺", flwBillerCode: "BIL123" },
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

const BETTING: Biller[] = [
  { id: "bet9ja", name: "Bet9ja", emoji: "🎰", flwBillerCode: "BIL310" },
  { id: "sportybet", name: "SportyBet", emoji: "🎰", flwBillerCode: "BIL311" },
  { id: "betking", name: "BetKing", emoji: "🎰", flwBillerCode: "BIL312" },
  { id: "1xbet", name: "1xBet", emoji: "🎰", flwBillerCode: "BIL313" },
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
];

export function getServiceConfig(service: string): ServiceConfig | undefined {
  return BILL_CATALOG.find((s) => s.service === service);
}

export function getBiller(service: string, billerId: string): Biller | undefined {
  return getServiceConfig(service)?.billers.find((b) => b.id === billerId);
}

export function getPlan(service: string, planId: string): BillPlan | undefined {
  return getServiceConfig(service)?.plans.find((p) => p.id === planId);
}
