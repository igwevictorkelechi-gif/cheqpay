// apps/api/src/lib/whatsapp/compose.ts
//
// Turning "send 5000 to @tobi" into a validated proposal and a link.
//
// Two rules shape this file.
//
// 1. A NARROW GRAMMAR, not natural language. Getting the parse wrong here
//    spends someone's money, so anything that does not match exactly is
//    answered with the grammar rather than a guess. "send my brother 5k" gets
//    help, not a payment to whoever we thought that meant.
// 2. VALIDATE BEFORE OFFERING. Every gate is checked before a link exists, so
//    a user is never walked to a page that will refuse them.
//
// Nothing here moves money: it writes a proposal to wa_pending_actions and
// returns a URL. See whatsapp.guard.test.ts.

import { TransactionType, prisma } from "@cheqpay/db";
import { assertFeatureEnabled } from "../features";
import { formatNairaMinor, toMinorUnits } from "../money";
import { ajoArrearsKobo } from "../ajo/lien";
import { createPendingAction, type ActionPayload } from "./actions";

export const GRAMMAR = [
  "To pay from here, send one of:",
  "",
  "• *send 5000 to @tobi* — to a CheqPay user you've paid before",
  "• *withdraw 5000* — to your saved bank account",
  "• *pay nepa* — a bill you've saved (add an amount if it varies)",
  "",
  "I'll send a link to confirm it with your PIN on our website.",
].join("\n");

/**
 * Naira as people actually write it: 5000, 5,000, ₦5000, 5k, 2.5m.
 *
 * Returns null rather than guessing. `toMinorUnits` does the final conversion,
 * so there is exactly one money parser in the codebase and anything it rejects
 * is rejected here too.
 */
export function parseAmountMinor(raw: string): bigint | null {
  const cleaned = raw.trim().toLowerCase().replace(/[₦,\s]/g, "");
  const m = /^(\d+(?:\.\d{1,2})?)(k|m)?$/.exec(cleaned);
  if (!m) return null;
  let value = m[1];
  if (m[2]) {
    const scale = m[2] === "k" ? 1_000 : 1_000_000;
    const n = Number(value) * scale;
    if (!Number.isSafeInteger(n)) return null;
    value = String(n);
  }
  try {
    const minor = toMinorUnits(value, "NGN");
    return minor > 0n ? minor : null;
  } catch {
    return null;
  }
}

export interface ComposeResult {
  /** Reply text, already including the link when there is one. */
  text: string;
}

/** The URL the user opens to confirm. A query param, not a path segment: the
 *  web app is a static export, so an unbounded route cannot be pre-rendered. */
function approveUrl(code: string): string {
  const base = process.env.WEB_PUBLIC_URL?.trim() || "https://mycheqpay.com";
  return `${base.replace(/\/$/, "")}/approve/?code=${encodeURIComponent(code)}`;
}

async function offer(userId: string, payload: ActionPayload, summary: string): Promise<ComposeResult> {
  const code = await createPendingAction(userId, payload);
  return {
    text: [
      summary,
      "",
      `Confirm it here (expires in 15 minutes):`,
      approveUrl(code),
      "",
      "You'll enter your PIN on our website — never here.",
    ].join("\n"),
  };
}

/**
 * Owing an Ajo circle pauses every money-out route (HTTP 423 `ajo_arrears`).
 * Checked up front so the refusal explains itself here, instead of surfacing
 * as a failure after the user has opened a link and typed their PIN.
 */
async function arrearsBlock(userId: string): Promise<string | null> {
  const owed = await ajoArrearsKobo(userId).catch(() => 0n);
  if (owed <= 0n) return null;
  return [
    `You owe ${formatNairaMinor(owed)} to your Ajo circle, so payments are paused.`,
    "",
    "Top up your wallet and it settles by itself — then try again.",
  ].join("\n");
}

/** `send <amount> to @<username>` */
export async function composeTransfer(userId: string, amountRaw: string, usernameRaw: string): Promise<ComposeResult> {
  try {
    await assertFeatureEnabled("p2p_transfers");
  } catch {
    return { text: "Sending to other users is turned off right now." };
  }
  const amountMinor = parseAmountMinor(amountRaw);
  if (!amountMinor) return { text: `I couldn't read "${amountRaw}" as an amount.\n\n${GRAMMAR}` };

  const username = usernameRaw.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { text: `"${usernameRaw}" isn't a valid CheqPay username.` };

  const recipient = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true, username: true, status: true },
  });
  // username is nullable on the model (it is auto-assigned at provisioning),
  // and it is the only thing that identifies a payee here, so an account
  // without one cannot be paid from chat.
  if (!recipient || !recipient.username || recipient.status !== "ACTIVE") {
    return { text: `No active CheqPay user called @${username}.` };
  }
  if (recipient.id === userId) return { text: "That's you." };
  const payee = recipient.username;

  // The gate: only someone this user has already paid from the app. A chat
  // channel is not where a brand-new payee should be introduced — that is
  // exactly the step a social-engineering attack needs, and it belongs in the
  // app where the user can see who they are paying.
  const paidBefore = await prisma.transaction.findFirst({
    where: {
      userId,
      type: TransactionType.TRANSFER_OUT,
      status: "COMPLETED",
      metadata: { path: ["counterparty"], equals: payee },
    },
    select: { id: true },
  });
  if (!paidBefore) {
    return {
      text: [
        `You haven't paid @${payee} from CheqPay before.`,
        "",
        "For your safety, the first payment to someone new has to happen in the app. After that you can send to them from here.",
      ].join("\n"),
    };
  }

  const blocked = await arrearsBlock(userId);
  if (blocked) return { text: blocked };

  return offer(
    userId,
    { kind: "transfer", username: payee, amountMinor: amountMinor.toString() },
    `*${formatNairaMinor(amountMinor)}* to @${payee}`,
  );
}

/** `withdraw <amount>` — to the user's own saved bank account. */
export async function composeWithdraw(userId: string, amountRaw: string): Promise<ComposeResult> {
  try {
    await assertFeatureEnabled("ngn_withdrawals");
  } catch {
    return { text: "Bank withdrawals are turned off right now." };
  }
  const amountMinor = parseAmountMinor(amountRaw);
  if (!amountMinor) return { text: `I couldn't read "${amountRaw}" as an amount.\n\n${GRAMMAR}` };

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, bankCode: true, bankName: true, accountNumber: true, accountName: true },
  });
  if (!beneficiaries.length) {
    return { text: "You haven't saved a bank account yet. Add one in the app under Withdraw, then you can do this from here." };
  }
  if (beneficiaries.length > 1) {
    // Rather than guess which account, name them and ask for the app. Picking
    // one for the user is the kind of helpfulness that moves money to the
    // wrong place.
    const list = beneficiaries.map((b) => `• ${b.bankName} ••••${b.accountNumber.slice(-4)}`).join("\n");
    return {
      text: [`You have ${beneficiaries.length} saved accounts:`, "", list, "", "Open the app to pick one — I won't guess."].join("\n"),
    };
  }

  const blocked = await arrearsBlock(userId);
  if (blocked) return { text: blocked };

  const b = beneficiaries[0];
  return offer(
    userId,
    {
      kind: "withdraw",
      beneficiaryId: b.id,
      bankCode: b.bankCode,
      bankName: b.bankName,
      accountNumber: b.accountNumber,
      accountName: b.accountName,
      amountMinor: amountMinor.toString(),
    },
    `*${formatNairaMinor(amountMinor)}* to your ${b.bankName} account ••••${b.accountNumber.slice(-4)}`,
  );
}

/** `pay <nickname>` or `pay <nickname> <amount>` — one of the user's saved bills. */
export async function composeBill(userId: string, nickname: string, amountRaw?: string): Promise<ComposeResult> {
  try {
    await assertFeatureEnabled("bill_payments");
  } catch {
    return { text: "Bill payments are turned off right now." };
  }
  const rows = await prisma.$queryRawUnsafe<
    { id: string; nickname: string; service: string; biller_id: string; customer: string; plan_id: string | null; amount_minor: bigint | null }[]
  >(
    `SELECT id, nickname, service, biller_id, customer, plan_id, amount_minor
       FROM saved_bills WHERE user_id = $1::uuid AND lower(nickname) = lower($2) LIMIT 1`,
    userId,
    nickname,
  ).catch(() => []);

  const bill = rows[0];
  if (!bill) {
    const all = await prisma.$queryRawUnsafe<{ nickname: string }[]>(
      `SELECT nickname FROM saved_bills WHERE user_id = $1::uuid ORDER BY nickname LIMIT 10`,
      userId,
    ).catch(() => []);
    if (!all.length) return { text: "You haven't saved any bills yet. Save one in the app under Pay bills, then you can pay it from here." };
    return { text: [`No saved bill called "${nickname}".`, "", "You have:", ...all.map((r) => `• ${r.nickname}`)].join("\n") };
  }

  const amountMinor = amountRaw ? parseAmountMinor(amountRaw) : bill.amount_minor ? BigInt(bill.amount_minor) : null;
  if (!amountMinor) {
    return { text: `How much for ${bill.nickname}? Send *pay ${bill.nickname} 5000*.` };
  }

  const blocked = await arrearsBlock(userId);
  if (blocked) return { text: blocked };

  return offer(
    userId,
    {
      kind: "bill",
      service: bill.service,
      billerId: bill.biller_id,
      billerName: bill.nickname,
      customer: bill.customer,
      ...(bill.plan_id && !amountRaw ? { planId: bill.plan_id } : {}),
      amountMinor: amountMinor.toString(),
    },
    `*${formatNairaMinor(amountMinor)}* for ${bill.nickname}`,
  );
}
