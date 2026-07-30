import { ApiError } from "@/lib/http";

/**
 * Transactional email via Resend.
 *
 * Ships DARK: with no RESEND_API_KEY the feature reports itself as
 * unconfigured and every send throws a clean 503 rather than silently
 * pretending a message went out. Callers should check isEmailConfigured()
 * to hide the entry point in the UI.
 *
 * Resend's REST API is called directly — the SDK would only wrap this one
 * request, and the attachment payload is a plain base64 string.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const API_KEY = process.env.RESEND_API_KEY ?? "";
/** Verified sender, e.g. "CheqPay <statements@cheqpay.com>". */
const MAIL_FROM = process.env.MAIL_FROM ?? "";

export function isEmailConfigured(): boolean {
  return API_KEY.length > 0 && MAIL_FROM.length > 0;
}

export function assertEmailConfigured(): void {
  if (!isEmailConfigured()) {
    throw new ApiError(
      503,
      "Email delivery isn’t set up yet. Please try again later.",
      "email_not_configured"
    );
  }
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  assertEmailConfigured();

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
        })),
      }),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(502, "Could not reach the email service", "email_unreachable");
  }

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    // Resend echoes the reason (unverified domain, invalid recipient, quota).
    console.error("[email] send failed", { status: res.status, message: body.message });
    throw new ApiError(502, body.message ?? "Could not send the email", "email_send_failed");
  }
  return { id: body.id ?? "" };
}
