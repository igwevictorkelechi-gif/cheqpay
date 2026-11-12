// apps/api/src/lib/whatsapp/router.ts
//
// Turning an inbound message into a reply.
//
// What this file may and may not do is the architectural invariant of the whole
// feature: it READS, and it COMPOSES. It never moves money. Anything that would
// spend becomes a pending action plus a one-time link, confirmed with the PIN on
// the website by the existing routes. See whatsapp.guard.test.ts, which fails
// the build if a money helper is ever imported under lib/whatsapp/.
//
// Replies are plain text, deliberately short, and never echo an account number,
// a BVN, a card number or a one-time code.

import { prisma } from "@cheqpay/db";
import { ajoArrearsKobo, ajoCommitments } from "../ajo/lien";
import { formatNairaMinor } from "../money";
import { enforceRateLimit } from "../ratelimit";
import { ApiError } from "../http";
import { maskNumber, normaliseWaId, redeemLinkCode, resolveLink, unlinkByWaId, LINK_CODE } from "./session";

export interface InboundMessage {
  waId: string;
  text: string;
  messageId: string;
}

export interface Reply {
  text: string;
  /** Set when this turn linked or unlinked, so the caller can raise a security alert. */
  securityEvent?: { kind: "linked" | "unlinked"; userId: string };
}

const HELP = [
  "Here's what I can do:",
  "",
  "• *balance* — what's in your wallet",
  "• *recent* — your last few transactions",
  "• *ajo* — your plans, circles and anything owed",
  "• *stop* — disconnect WhatsApp from your account",
  "",
  "To send money, open the CheqPay app — I'll never ask for your PIN here.",
].join("\n");

const NOT_LINKED = [
  "This number isn't connected to a CheqPay account yet.",
  "",
  "Open CheqPay → Settings → Security → Connect WhatsApp, and send me the 6-character code it shows you.",
].join("\n");

/**
 * CheqPay will never ask for a PIN in chat, so say so wherever someone seems to
 * be offering one. Phishers imitate this channel; the habit we want to build is
 * "CheqPay never asks here".
 */
const PIN_WARNING = [
  "⚠️ Never type your transaction PIN into WhatsApp — not to me, not to anyone claiming to be CheqPay support.",
  "",
  "I'll always send you a link to confirm payments on our website instead.",
].join("\n");

const looksLikeAPin = (text: string) => /^\s*\d{4,6}\s*$/.test(text);

export async function handleMessage(msg: InboundMessage): Promise<Reply | null> {
  const waId = normaliseWaId(msg.waId);
  if (!waId) return null;
  const text = msg.text.trim();
  if (!text) return null;

  // Per-number budget first: this runs before we know who they are, so it is
  // the only thing standing between an unlinked number and unbounded work.
  try {
    await enforceRateLimit(`wa:in:${waId}`, 20, 60_000);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { text: "You're going a bit fast for me — give me a minute and try again." };
    }
    throw err;
  }

  const word = text.toLowerCase();

  // LINK <code> is the only thing an unlinked number may do.
  const linkMatch = /^link\s+([a-z0-9]{6})$/i.exec(text);
  if (linkMatch) return handleLink(waId, linkMatch[1].toUpperCase());

  if (looksLikeAPin(text)) return { text: PIN_WARNING };

  const link = await resolveLink(waId);
  if (!link) {
    return { text: word === "help" || word === "hi" || word === "hello" ? NOT_LINKED : NOT_LINKED };
  }

  // Per-account budget, so a linked user with several numbers still can't
  // hammer the database.
  await enforceRateLimit(`wa:user:${link.userId}`, 40, 60_000);

  switch (word) {
    case "help":
    case "hi":
    case "hello":
    case "menu":
      return { text: HELP };
    case "stop":
    case "unlink":
    case "disconnect":
      return handleUnlink(waId);
    case "balance":
    case "bal":
      return { text: await balanceReply(link.userId) };
    case "recent":
    case "history":
    case "transactions":
      return { text: await recentReply(link.userId) };
    case "ajo":
    case "savings":
      return { text: await ajoReply(link.userId) };
    default:
      return { text: `I didn't catch that.\n\n${HELP}` };
  }
}

async function handleLink(waId: string, code: string): Promise<Reply> {
  // Codes are six characters from a 31-letter alphabet. Rate limiting is what
  // keeps that from being guessable, so it is tighter than everything else.
  try {
    await enforceRateLimit(`wa:link:${waId}`, 5, 10 * 60_000);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { text: "Too many attempts. Wait ten minutes, then get a fresh code from the app." };
    }
    throw err;
  }
  if (!LINK_CODE.test(code)) {
    return { text: "That code doesn't look right. Get a fresh one from CheqPay → Settings → Security → Connect WhatsApp." };
  }
  const outcome = await redeemLinkCode(waId, code);
  if (!outcome) {
    // Deliberately one message for unknown, expired and already-used: saying
    // which would turn this into an oracle for guessing codes.
    return { text: "That code has expired or was already used. Get a fresh one from the app and send it within 10 minutes." };
  }
  if (outcome.alreadyLinked) {
    return { text: `This number is already connected.\n\n${HELP}` };
  }
  return {
    text: [`✅ Connected. This number can now check your CheqPay account.`, "", HELP].join("\n"),
    securityEvent: { kind: "linked", userId: outcome.userId },
  };
}

async function handleUnlink(waId: string): Promise<Reply> {
  const userId = await unlinkByWaId(waId);
  if (!userId) return { text: "This number wasn't connected to a CheqPay account." };
  return {
    text: `Disconnected. ${maskNumber(waId)} can no longer see your account.\n\nReconnect any time from CheqPay → Settings → Security.`,
    securityEvent: { kind: "unlinked", userId },
  };
}

async function balanceReply(userId: string): Promise<string> {
  const balances = await prisma.balance.findMany({
    where: { userId },
    select: { asset: true, available: true },
  });
  const ngn = balances.find((b) => b.asset === "NGN")?.available ?? 0n;
  const lines = [`*${formatNairaMinor(ngn)}* available`];

  const others = balances.filter((b) => b.asset !== "NGN" && b.available > 0n);
  if (others.length) {
    lines.push("");
    for (const b of others) lines.push(`${b.asset}: ${b.available.toString()}`);
  }

  // If they owe an Ajo circle, say so here: it is the reason money-out will be
  // refused, and finding that out at the moment of paying is worse.
  const arrears = await ajoArrearsKobo(userId).catch(() => 0n);
  if (arrears > 0n) {
    lines.push("", `⚠️ You owe ${formatNairaMinor(arrears)} to your Ajo circle. Money going out is paused until that clears — top up and it settles itself.`);
  }
  return lines.join("\n");
}

async function recentReply(userId: string): Promise<string> {
  const txns = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { type: true, asset: true, amount: true, status: true, createdAt: true },
  });
  if (!txns.length) return "No transactions yet.";
  const lines = ["*Last 5 transactions*", ""];
  for (const t of txns) {
    const amount = t.asset === "NGN" ? formatNairaMinor(t.amount) : `${t.amount.toString()} ${t.asset}`;
    const when = t.createdAt.toISOString().slice(0, 10);
    const status = t.status === "COMPLETED" ? "" : ` · ${t.status.toLowerCase()}`;
    lines.push(`${when} · ${t.type.replace(/_/g, " ").toLowerCase()} · ${amount}${status}`);
  }
  return lines.join("\n");
}

async function ajoReply(userId: string): Promise<string> {
  const commitments = await ajoCommitments(userId).catch(() => null);
  if (!commitments) return "Ajo isn't available right now.";
  const { savedKobo, activePlans, openGroups, owedKobo } = commitments;
  const lines = ["*Your Ajo*", ""];
  lines.push(`Saved: ${formatNairaMinor(savedKobo)}`);
  lines.push(`Plans: ${activePlans}`);
  lines.push(`Circles: ${openGroups}`);
  if (owedKobo > 0n) {
    lines.push("", `⚠️ Owed: ${formatNairaMinor(owedKobo)}`);
    lines.push("Money going out is paused until this clears. Top up your wallet and it settles by itself.");
  }
  return lines.join("\n");
}
