import { z } from "zod";
import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { enforceRateLimit } from "@/lib/ratelimit";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import {
  buildStatementCsv,
  buildStatementPdf,
  statementFilename,
  type StatementMeta,
} from "@/lib/statement";

export const dynamic = "force-dynamic";

/** Longest period a user can pull in one go. */
const MAX_RANGE_DAYS = 366;

const requestSchema = z.object({
  // Plain calendar dates (YYYY-MM-DD); interpreted as UTC day boundaries.
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  format: z.enum(["pdf", "csv"]),
});

/** Whether statement delivery is available (used to hide the UI entry point). */
export async function GET(req: Request) {
  try {
    await requireUser(req);
    return jsonOk({ available: isEmailConfigured(), maxRangeDays: MAX_RANGE_DAYS });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Generate the caller's statement for a date range and email it to their
 * account address. The document is never returned in the response — it only
 * ever goes to the address on the account, so a stolen token cannot be used to
 * exfiltrate history to somewhere else.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    // Generating a PDF and sending mail is expensive; keep it to a trickle.
    enforceRateLimit(`statement:${auth.id}`, 5, 10 * 60_000);

    const body = requestSchema.parse(await req.json());
    const from = new Date(`${body.from}T00:00:00.000Z`);
    // Inclusive end date — the whole "to" day counts.
    const to = new Date(`${body.to}T23:59:59.999Z`);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError(422, "Invalid date range", "bad_range");
    }
    if (from > to) {
      throw new ApiError(422, "The start date must come before the end date", "bad_range");
    }
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > MAX_RANGE_DAYS) {
      throw new ApiError(
        422,
        `Statements cover at most ${MAX_RANGE_DAYS} days. Please choose a shorter period.`,
        "range_too_long"
      );
    }

    const email = auth.email?.trim();
    if (!email) {
      throw new ApiError(422, "Your account has no email address", "no_email");
    }
    // Fail before doing the work if delivery isn't configured.
    if (!isEmailConfigured()) {
      throw new ApiError(
        503,
        "Statement delivery isn’t set up yet. Please try again later.",
        "email_not_configured"
      );
    }

    const txns = await prisma.transaction.findMany({
      where: { userId: auth.id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
    });

    const meta: StatementMeta = {
      name: (auth.fullName ?? "").trim() || "CheqPay customer",
      email,
      from,
      to,
    };
    const filename = statementFilename(meta, body.format);
    const content =
      body.format === "csv"
        ? buildStatementCsv(txns, meta)
        : await buildStatementPdf(txns, meta);

    const period = `${body.from} to ${body.to}`;
    await sendEmail({
      to: email,
      subject: `Your CheqPay statement (${period})`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1F1B29">
          <p>Hi ${escapeHtml(meta.name)},</p>
          <p>Your CheqPay account statement for <strong>${escapeHtml(period)}</strong>
             is attached as ${body.format.toUpperCase()}.</p>
          <p>It covers ${txns.length} transaction${txns.length === 1 ? "" : "s"}.</p>
          <p style="color:#6b6880;font-size:13px">
            If you didn’t request this statement, please contact support straight away.
          </p>
          <p style="color:#6b6880;font-size:13px">— CheqPay</p>
        </div>`,
      attachments: [{ filename, content }],
    });

    await prisma.auditLog.create({
      data: {
        userId: auth.id,
        action: "statement.requested",
        resourceType: "Transaction",
        resourceId: auth.id,
        details: { from: body.from, to: body.to, format: body.format, count: txns.length },
      },
    });

    return jsonOk({ sent: true, email: maskEmail(email), count: txns.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

/** "vic***@gmail.com" — confirms the destination without echoing it in full. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "your email";
  const head = user.slice(0, Math.min(3, user.length));
  return `${head}${"*".repeat(Math.max(1, user.length - head.length))}@${domain}`;
}
