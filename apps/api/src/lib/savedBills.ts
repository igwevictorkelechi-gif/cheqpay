import { Asset, prisma } from "@cheqpay/db";
import { notifyUser } from "./alerts";
import { getBillCatalog } from "./billCatalog";
import { executeBillPayment } from "./billPay";
import { getBiller, getServiceConfig, type ServiceConfig } from "./bills";
import { getFeatureFlags } from "./features";
import { ApiError } from "./http";
import { formatNairaMinor, fromMinorUnits, toMinorUnits } from "./money";

/**
 * Saved bills: the bills a person pays regularly, under their own name
 * ("Mum's line", "Living room TV"), with optional autopay.
 *
 * Raw-SQL table created lazily. It is a NEW table (no existing model gains a
 * column), so nothing selects it by default and it need not run at boot.
 */
let ensured: Promise<void> | null = null;
export function ensureSavedBillsSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS saved_bills (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          nickname text NOT NULL,
          service text NOT NULL,
          biller_id text NOT NULL,
          customer text NOT NULL,
          plan_id text,
          amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
          autopay boolean NOT NULL DEFAULT false,
          autopay_day integer CHECK (autopay_day IS NULL OR (autopay_day BETWEEN 1 AND 28)),
          autopay_last_run date,
          autopay_note text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, service, customer)
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS saved_bills_autopay_idx ON saved_bills (autopay_day) WHERE autopay`);
    })().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

/** Services that renew on a cycle (shown as "due in N days"). */
const CYCLE_DAYS: Record<string, number> = { cabletv: 30 };
/** Services autopay may pay. Betting and food are one-off by nature. */
export const AUTOPAY_SERVICES = ["airtime", "data", "cabletv", "electricity"] as const;
const MAX_SAVED = 30;

// ---------------------------------------------------------------------------
// Lagos calendar

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST
export const lagosDate = (d = new Date()) => new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
export const lagosMonth = (d = new Date()) => lagosDate(d).slice(0, 7);
/** [start, end) of a Lagos calendar month, as UTC instants. */
export function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - LAGOS_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - LAGOS_OFFSET_MS);
  return [start, end];
}
export const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Rows

interface SavedRow {
  id: string;
  user_id: string;
  nickname: string;
  service: string;
  biller_id: string;
  customer: string;
  plan_id: string | null;
  amount_minor: bigint | null;
  autopay: boolean;
  autopay_day: number | null;
  autopay_note: string | null;
  created_at: Date;
}
const COLS = `id::text, user_id::text, nickname, service, biller_id, customer, plan_id, amount_minor, autopay, autopay_day, autopay_note, created_at`;

interface BillTxn {
  service: string;
  customer: string;
  amount: bigint;
  createdAt: Date;
}

export type SavedBillState = "paid" | "autopay" | "due" | "topup" | "pay";

export interface SavedBillView {
  id: string;
  nickname: string;
  service: string;
  serviceLabel: string;
  billerId: string;
  billerName: string;
  customer: string;
  planId: string | null;
  planName: string | null;
  expectedMinor: string | null;
  expectedFormatted: string | null;
  state: SavedBillState;
  /** The line under the name, e.g. "DStv Compact ₦15,700, due in 3 days". */
  detail: string;
  dueInDays: number | null;
  autopay: boolean;
  autopayDay: number | null;
  autopayNote: string | null;
  canAutopay: boolean;
  lastPaidAt: string | null;
  paidThisMonthFormatted: string | null;
}

/**
 * How one saved bill reads this month. Pure, so the wording is unit-tested:
 * paid → "Paid ₦X on 3 Oct"; autopay → "Glo airtime ₦2,000 on the 10th.
 * Autopay is on"; cable → "DStv Compact ₦15,700, due in 3 days"; prepaid power
 * → "IKEDC prepaid, last topped up 12 days ago".
 */
export function describeSavedBill(
  row: Pick<SavedRow, "service" | "autopay" | "autopay_day" | "autopay_note">,
  ctx: { billerName: string; serviceLabel: string; planName: string | null; expectedMinor: bigint | null; lastPaid: BillTxn | null; paidInMonth: BillTxn | null; now: Date },
): { state: SavedBillState; detail: string; dueInDays: number | null } {
  const money = ctx.expectedMinor ? ` ${formatNairaMinor(ctx.expectedMinor)}` : "";
  const what = ctx.planName ? `${ctx.billerName} ${ctx.planName}` : `${ctx.billerName} ${ctx.serviceLabel.toLowerCase()}`;
  if (ctx.paidInMonth) {
    const on = ctx.paidInMonth.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
    return { state: "paid", detail: `Paid ${formatNairaMinor(ctx.paidInMonth.amount)} on ${on}`, dueInDays: null };
  }
  if (row.autopay && row.autopay_day) {
    const note = row.autopay_note ? ` ${row.autopay_note}` : " Autopay is on";
    return { state: "autopay", detail: `${what}${money} on the ${ordinal(row.autopay_day)}.${note}`, dueInDays: null };
  }
  const cycle = CYCLE_DAYS[row.service];
  if (cycle) {
    if (!ctx.lastPaid) return { state: "due", detail: `${what}${money}, due now`, dueInDays: 0 };
    const due = Math.ceil((ctx.lastPaid.createdAt.getTime() + cycle * DAY_MS - ctx.now.getTime()) / DAY_MS);
    const when = due > 1 ? `due in ${due} days` : due === 1 ? "due tomorrow" : due === 0 ? "due today" : `overdue by ${-due} day${due === -1 ? "" : "s"}`;
    return { state: "due", detail: `${what}${money}, ${when}`, dueInDays: due };
  }
  if (row.service === "electricity") {
    const days = ctx.lastPaid ? Math.floor((ctx.now.getTime() - ctx.lastPaid.createdAt.getTime()) / DAY_MS) : null;
    const last = days === null ? "not topped up yet" : days === 0 ? "last topped up today" : `last topped up ${days} day${days === 1 ? "" : "s"} ago`;
    return { state: "topup", detail: `${ctx.billerName} prepaid, ${last}`, dueInDays: null };
  }
  return { state: "pay", detail: `${what}${money}`, dueInDays: null };
}

function planFor(catalog: ServiceConfig[], service: string, planId: string | null) {
  if (!planId) return null;
  return catalog.find((c) => c.service === service)?.plans.find((p) => p.id === planId) ?? null;
}

async function billTxns(userId: string, since: Date): Promise<BillTxn[]> {
  const rows = await prisma.$queryRawUnsafe<{ service: string | null; customer: string | null; amount: bigint; created_at: Date }[]>(
    `SELECT metadata->>'service' AS service, metadata->>'customer' AS customer, amount, created_at FROM ledger_transactions
      WHERE user_id = $1::uuid AND type::text = 'BILL' AND status::text = 'COMPLETED' AND created_at >= $2::timestamptz
      ORDER BY created_at DESC LIMIT 2000`,
    userId, since.toISOString(),
  );
  return rows.filter((r) => r.service && r.customer).map((r) => ({ service: r.service!, customer: r.customer!.replace(/\s+/g, ""), amount: BigInt(r.amount), createdAt: new Date(r.created_at) }));
}

export interface BillsOverview {
  month: string;
  monthLabel: string;
  isCurrentMonth: boolean;
  months: { key: string; label: string }[];
  paidMinor: string;
  paidFormatted: string;
  cashbackMinor: string;
  cashbackFormatted: string;
  stillToSortMinor: string;
  stillToSortFormatted: string;
  bills: SavedBillView[];
  suggestions: { service: string; serviceLabel: string; billerId: string; billerName: string; customer: string; planId: string | null; amountMinor: string; amountFormatted: string; times: number }[];
}

/** Everything the Pay bills screen shows for one month. */
export async function billsOverview(userId: string, month = lagosMonth(), now = new Date()): Promise<BillsOverview> {
  await ensureSavedBillsSchema();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > lagosMonth(now)) month = lagosMonth(now);
  const [start, end] = monthRange(month);
  const catalog = await getBillCatalog().catch(() => [] as ServiceConfig[]);

  const [rows, txns, cash] = await Promise.all([
    prisma.$queryRawUnsafe<SavedRow[]>(`SELECT ${COLS} FROM saved_bills WHERE user_id = $1::uuid ORDER BY created_at`, userId),
    billTxns(userId, new Date(Math.min(start.getTime(), now.getTime() - 120 * DAY_MS))),
    prisma.$queryRawUnsafe<{ s: bigint | null }[]>(
      `SELECT sum(amount)::bigint AS s FROM ledger_transactions WHERE user_id = $1::uuid AND type::text = 'CASHBACK'
         AND metadata->>'source' = 'bill' AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,
      userId, start.toISOString(), end.toISOString(),
    ),
  ]);
  const inMonth = txns.filter((t) => t.createdAt >= start && t.createdAt < end);
  const paidMinor = inMonth.reduce((a, t) => a + t.amount, 0n);
  const key = (s: string, c: string) => `${s}|${c.replace(/\s+/g, "")}`;

  let stillToSort = 0n;
  const bills: SavedBillView[] = rows.map((r) => {
    const cfg = catalog.find((c) => c.service === r.service) ?? getServiceConfig(r.service);
    const biller = cfg?.billers.find((b) => b.id === r.biller_id) ?? getBiller(r.service, r.biller_id);
    const plan = planFor(catalog, r.service, r.plan_id);
    const k = key(r.service, r.customer);
    const lastPaid = txns.find((t) => key(t.service, t.customer) === k && t.createdAt < end) ?? null;
    const paidInMonth = inMonth.find((t) => key(t.service, t.customer) === k) ?? null;
    const expectedMinor = plan ? toMinorUnits(plan.amount, Asset.NGN) : r.amount_minor !== null ? BigInt(r.amount_minor) : lastPaid?.amount ?? null;
    const d = describeSavedBill(r, {
      billerName: biller?.name ?? r.biller_id,
      serviceLabel: cfg?.label ?? r.service,
      planName: plan?.name ?? null,
      expectedMinor,
      lastPaid,
      paidInMonth,
      now: month === lagosMonth(now) ? now : new Date(end.getTime() - 1),
    });
    if (d.state !== "paid" && expectedMinor) stillToSort += expectedMinor;
    return {
      id: r.id,
      nickname: r.nickname,
      service: r.service,
      serviceLabel: cfg?.label ?? r.service,
      billerId: r.biller_id,
      billerName: biller?.name ?? r.biller_id,
      customer: r.customer,
      planId: r.plan_id,
      planName: plan?.name ?? null,
      expectedMinor: expectedMinor?.toString() ?? null,
      expectedFormatted: expectedMinor ? formatNairaMinor(expectedMinor) : null,
      state: d.state,
      detail: d.detail,
      dueInDays: d.dueInDays,
      autopay: r.autopay,
      autopayDay: r.autopay_day,
      autopayNote: r.autopay_note,
      canAutopay: (AUTOPAY_SERVICES as readonly string[]).includes(r.service),
      lastPaidAt: lastPaid?.createdAt.toISOString() ?? null,
      paidThisMonthFormatted: paidInMonth ? formatNairaMinor(paidInMonth.amount) : null,
    };
  });
  // Unpaid first (soonest due first), paid last.
  const rank = (b: SavedBillView) => (b.state === "paid" ? 2 : b.state === "autopay" ? 1 : 0);
  bills.sort((a, b) => rank(a) - rank(b) || (a.dueInDays ?? 99) - (b.dueInDays ?? 99));

  // Suggestions: paid at least twice in 120 days, not saved yet.
  const saved = new Set(rows.map((r) => key(r.service, r.customer)));
  const groups = new Map<string, { t: BillTxn; n: number }>();
  for (const t of txns) {
    const k = key(t.service, t.customer);
    if (saved.has(k)) continue;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { t, n: 1 });
  }
  const meta = groups.size
    ? await prisma.$queryRawUnsafe<{ service: string; customer: string; biller_id: string | null; biller_name: string | null; plan_id: string | null }[]>(
        `SELECT DISTINCT ON (metadata->>'service', metadata->>'customer') metadata->>'service' AS service, metadata->>'customer' AS customer,
                metadata->>'billerId' AS biller_id, metadata->>'billerName' AS biller_name, metadata->>'planId' AS plan_id
           FROM ledger_transactions WHERE user_id = $1::uuid AND type::text = 'BILL' AND status::text = 'COMPLETED'
          ORDER BY metadata->>'service', metadata->>'customer', created_at DESC`,
        userId,
      )
    : [];
  const suggestions = [...groups.values()]
    .filter((g) => g.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .flatMap((g) => {
      const m = meta.find((x) => x.service === g.t.service && x.customer.replace(/\s+/g, "") === g.t.customer);
      const cfg = catalog.find((c) => c.service === g.t.service) ?? getServiceConfig(g.t.service);
      const biller = m?.biller_id ? cfg?.billers.find((b) => b.id === m.biller_id) : cfg?.billers.find((b) => b.name === m?.biller_name);
      if (!cfg || !biller) return [];
      return [{
        service: g.t.service, serviceLabel: cfg.label, billerId: biller.id, billerName: biller.name, customer: m?.customer ?? g.t.customer,
        planId: m?.plan_id ?? null, amountMinor: g.t.amount.toString(), amountFormatted: formatNairaMinor(g.t.amount), times: g.n,
      }];
    });

  const cur = lagosMonth(now);
  const months = Array.from({ length: 6 }, (_, i) => {
    const [y, m] = cur.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - i, 15));
    const k = d.toISOString().slice(0, 7);
    return { key: k, label: monthName(k) };
  });
  const cashMinor = BigInt(cash[0]?.s ?? 0n);
  return {
    month,
    monthLabel: monthName(month),
    isCurrentMonth: month === cur,
    months,
    paidMinor: paidMinor.toString(),
    paidFormatted: formatNairaMinor(paidMinor),
    cashbackMinor: cashMinor.toString(),
    cashbackFormatted: formatNairaMinor(cashMinor),
    stillToSortMinor: stillToSort.toString(),
    stillToSortFormatted: formatNairaMinor(stillToSort),
    bills,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Save / edit / delete

const nameOk = (s: string) => {
  const n = s.trim().replace(/\s+/g, " ");
  if (n.length < 1 || n.length > 40) throw new ApiError(422, "Give the bill a name up to 40 characters.", "bad_nickname");
  return n;
};

/** Save (or rename) a bill. One per service + number. */
export async function saveBill(userId: string, input: { service: string; billerId: string; customer: string; nickname: string; planId?: string | null; amount?: string | null }): Promise<string> {
  await ensureSavedBillsSchema();
  const cfg = getServiceConfig(input.service);
  if (!cfg || !getBiller(input.service, input.billerId)) throw new ApiError(422, "Unknown service or biller", "bad_biller");
  const customer = input.customer.replace(/\s+/g, "");
  if (customer.length < 3 || customer.length > 40) throw new ApiError(422, `Enter a valid ${cfg.customerLabel.toLowerCase()}.`, "bad_customer");
  const nickname = nameOk(input.nickname);
  const amountMinor = cfg.variableAmount && input.amount ? toMinorUnits(input.amount, Asset.NGN) : null;
  if (amountMinor !== null && amountMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");
  const count = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM saved_bills WHERE user_id = $1::uuid`, userId);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO saved_bills (user_id, nickname, service, biller_id, customer, plan_id, amount_minor)
     SELECT $1::uuid, $2, $3, $4, $5, $6, $7 WHERE $8 < ${MAX_SAVED} OR EXISTS (SELECT 1 FROM saved_bills WHERE user_id = $1::uuid AND service = $3 AND customer = $5)
     ON CONFLICT (user_id, service, customer) DO UPDATE SET nickname = EXCLUDED.nickname, biller_id = EXCLUDED.biller_id,
       plan_id = COALESCE(EXCLUDED.plan_id, saved_bills.plan_id), amount_minor = COALESCE(EXCLUDED.amount_minor, saved_bills.amount_minor), updated_at = now()
     RETURNING id::text`,
    userId, nickname, input.service, input.billerId, customer, cfg.variableAmount ? null : input.planId ?? null, amountMinor, count[0]?.n ?? 0,
  );
  if (!rows[0]) throw new ApiError(409, `You can save up to ${MAX_SAVED} bills. Remove one first.`, "too_many_saved");
  return rows[0].id;
}

/** Whether autopay is currently on for this bill (and that it's the caller's). */
export async function savedBillAutopayOn(userId: string, id: string): Promise<boolean> {
  return (await ownRow(userId, id)).autopay;
}

async function ownRow(userId: string, id: string): Promise<SavedRow> {
  await ensureSavedBillsSchema();
  const rows = await prisma.$queryRawUnsafe<SavedRow[]>(`SELECT ${COLS} FROM saved_bills WHERE id = $1::uuid AND user_id = $2::uuid`, id, userId);
  if (!rows[0]) throw new ApiError(404, "Saved bill not found", "not_found");
  return rows[0];
}

/**
 * Edit a saved bill. Turning autopay ON is a standing instruction to spend, so
 * the route checks the PIN before calling this with `autopay: true`. Turning
 * it off never needs one.
 */
export async function updateSavedBill(
  userId: string,
  id: string,
  patch: { nickname?: string; planId?: string | null; amount?: string | null; autopay?: boolean; autopayDay?: number | null },
): Promise<void> {
  const row = await ownRow(userId, id);
  const cfg = getServiceConfig(row.service)!;
  const next = {
    nickname: patch.nickname !== undefined ? nameOk(patch.nickname) : row.nickname,
    planId: patch.planId !== undefined ? patch.planId : row.plan_id,
    amountMinor: patch.amount !== undefined ? (patch.amount ? toMinorUnits(patch.amount, Asset.NGN) : null) : row.amount_minor !== null ? BigInt(row.amount_minor) : null,
    autopay: patch.autopay ?? row.autopay,
    autopayDay: patch.autopayDay !== undefined ? patch.autopayDay : row.autopay_day,
  };
  if (next.amountMinor !== null && next.amountMinor <= 0n) throw new ApiError(422, "Amount must be positive", "bad_amount");
  if (next.autopay) {
    if (!(AUTOPAY_SERVICES as readonly string[]).includes(row.service)) throw new ApiError(422, `Autopay isn't available for ${cfg.label.toLowerCase()}.`, "autopay_unavailable");
    if (!next.autopayDay || next.autopayDay < 1 || next.autopayDay > 28) throw new ApiError(422, "Pick a day between the 1st and the 28th.", "bad_autopay_day");
    if (cfg.variableAmount ? !next.amountMinor : !next.planId) {
      throw new ApiError(422, cfg.variableAmount ? "Set the amount to pay each month." : "Pick the plan to renew each month.", "autopay_needs_amount");
    }
    if (!cfg.variableAmount) {
      const plan = (await getBillCatalog().catch(() => [] as ServiceConfig[])).find((c) => c.service === row.service)?.plans.find((p) => p.id === next.planId && p.billerId === row.biller_id);
      if (!plan) throw new ApiError(422, "That plan isn't available any more. Pick another.", "bad_plan");
    }
  }
  await prisma.$executeRawUnsafe(
    `UPDATE saved_bills SET nickname = $3, plan_id = $4, amount_minor = $5, autopay = $6, autopay_day = $7,
       autopay_note = CASE WHEN $6 THEN NULL ELSE autopay_note END, updated_at = now() WHERE id = $1::uuid AND user_id = $2::uuid`,
    id, userId, next.nickname, next.planId, next.amountMinor, next.autopay, next.autopayDay,
  );
  if (patch.autopay !== undefined && patch.autopay !== row.autopay) {
    await prisma.auditLog.create({
      data: { userId, action: patch.autopay ? "bill.autopay.on" : "bill.autopay.off", resourceType: "SavedBill", resourceId: id, details: { service: row.service, day: next.autopayDay, amountMinor: next.amountMinor?.toString() ?? null, planId: next.planId } },
    });
  }
}

export async function deleteSavedBill(userId: string, id: string): Promise<void> {
  await ownRow(userId, id);
  await prisma.$executeRawUnsafe(`DELETE FROM saved_bills WHERE id = $1::uuid AND user_id = $2::uuid`, id, userId);
}

// ---------------------------------------------------------------------------
// Autopay

export interface AutopayResult { due: number; paid: number; skipped: number; failed: number }

/**
 * Pay today's autopay bills. Each bill is claimed for the day with a guarded
 * update before any money moves, and the payment's idempotency key is the
 * bill + date, so overlapping or repeated runs pay each bill at most once a day.
 */
export async function runBillAutopay(now = new Date()): Promise<AutopayResult> {
  await ensureSavedBillsSchema();
  const res: AutopayResult = { due: 0, paid: 0, skipped: 0, failed: 0 };
  const flags = await getFeatureFlags();
  if (!flags.bill_payments) return res;
  const today = lagosDate(now);
  const day = Number(today.slice(8, 10));
  const due = await prisma.$queryRawUnsafe<SavedRow[]>(
    `SELECT ${COLS.split(", ").map((c) => `s.${c}`).join(", ")}
       FROM saved_bills s JOIN app_users u ON u.id = s.user_id
      WHERE s.autopay AND s.autopay_day = $1 AND (s.autopay_last_run IS NULL OR s.autopay_last_run < $2::date) AND u.status::text = 'ACTIVE'
      ORDER BY s.created_at LIMIT 500`,
    day, today,
  );
  res.due = due.length;
  for (const b of due) {
    const claimed = await prisma.$executeRawUnsafe(
      `UPDATE saved_bills SET autopay_last_run = $2::date WHERE id = $1::uuid AND autopay AND (autopay_last_run IS NULL OR autopay_last_run < $2::date)`,
      b.id, today,
    );
    if (!claimed) continue;
    // A renewal paid by hand in the last 20 days already covers this month.
    if (CYCLE_DAYS[b.service]) {
      const recent = (await billTxns(b.user_id, new Date(now.getTime() - 20 * DAY_MS))).find((t) => t.service === b.service && t.customer === b.customer.replace(/\s+/g, ""));
      if (recent) {
        res.skipped++;
        continue;
      }
    }
    try {
      const out = await executeBillPayment({
        userId: b.user_id,
        service: b.service,
        billerId: b.biller_id,
        customer: b.customer,
        planId: b.plan_id ?? undefined,
        amount: b.amount_minor !== null ? fromMinorUnits(BigInt(b.amount_minor), Asset.NGN) : undefined,
        idempotencyKey: `autopay:${b.id}:${today}`,
        initiatorIp: null,
        source: "autopay",
        savedBillId: b.id,
      });
      if (!out.replay) res.paid++;
      await prisma.$executeRawUnsafe(`UPDATE saved_bills SET autopay_note = NULL WHERE id = $1::uuid`, b.id);
    } catch (e) {
      res.failed++;
      const low = e instanceof ApiError && e.code === "insufficient_funds";
      if (!low) console.error("[autopay] payment failed", { savedBillId: b.id, service: b.service, error: e instanceof Error ? e.message : String(e) });
      const note = low ? "Last autopay skipped: low balance" : "Last autopay didn't go through";
      await prisma.$executeRawUnsafe(`UPDATE saved_bills SET autopay_note = $2 WHERE id = $1::uuid`, b.id, note);
      await notifyUser(b.user_id, {
        category: "bills",
        title: low ? `Autopay skipped: ${b.nickname}` : `Autopay failed: ${b.nickname}`,
        body: low
          ? `We couldn't pay "${b.nickname}" today because your Naira balance is too low. Add money and pay it from Pay bills.`
          : `We couldn't pay "${b.nickname}" today${e instanceof ApiError ? `: ${e.message}` : ""}. Nothing was charged. You can pay it from Pay bills.`,
        data: { url: "/pay-bill/" },
      }).catch(() => undefined);
    }
  }
  return res;
}
