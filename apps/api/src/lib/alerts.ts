import { prisma } from "@cheqpay/db";
import { sendPush } from "./push";
import { isEmailConfigured, sendEmail } from "./email";
import { resolvePrefs, type NotificationCategory } from "./notifications";

/**
 * Fan a money event out to every channel the user is opted into: push to their
 * devices and an email alert to the address on the account.
 *
 * Both channels honour the SAME per-category preference the notifications
 * screen already exposes, so turning "Bills" off silences both rather than
 * leaving email as a channel the user cannot switch off.
 *
 * Never throws. The caller has already moved money; an alert failure must not
 * unwind or fail that.
 */

export interface AlertMessage {
  title: string;
  body: string;
  category: NotificationCategory;
  data?: Record<string, unknown>;
  /** Optional extra lines rendered under the body in the email only. */
  details?: { label: string; value: string }[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function renderHtml(msg: AlertMessage): string {
  const rows = (msg.details ?? [])
    .map(
      (d) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#6b6880;font-size:13px">${escapeHtml(
          d.label
        )}</td><td style="padding:6px 0;color:#1F1B29;font-size:13px;font-weight:600">${escapeHtml(
          d.value
        )}</td></tr>`
    )
    .join("");
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1F1B29;max-width:520px">
      <p style="font-size:18px;font-weight:700;margin:0 0 8px">${escapeHtml(msg.title)}</p>
      <p style="margin:0 0 16px;line-height:1.5">${escapeHtml(msg.body)}</p>
      ${rows ? `<table style="border-collapse:collapse;margin-bottom:16px">${rows}</table>` : ""}
      <p style="color:#6b6880;font-size:12px;line-height:1.5;margin:0">
        You're receiving this because transaction alerts are on for your CheqPay account.
        You can change which alerts you get under Settings &rsaquo; Notifications.
      </p>
      <p style="color:#6b6880;font-size:12px;margin:12px 0 0">— CheqPay</p>
    </div>`;
}

/** Email half of the fanout. Silent when unconfigured or opted out. */
async function sendEmailAlert(userId: string, msg: AlertMessage): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, notificationPrefs: true },
    });
    if (!user?.email) return false;
    if (!resolvePrefs(user.notificationPrefs)[msg.category]) return false;

    await sendEmail({
      to: user.email,
      subject: `CheqPay — ${msg.title}`,
      html: renderHtml(msg),
    });
    return true;
  } catch (err) {
    console.error("[alerts] email failed", {
      userId,
      category: msg.category,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Notify a user about a money event on every enabled channel.
 * Returns which channels actually went out (useful in tests/logs).
 */
export async function notifyUser(
  userId: string,
  msg: AlertMessage
): Promise<{ devices: number; email: boolean }> {
  const [devices, email] = await Promise.all([
    sendPush(userId, {
      title: msg.title,
      body: msg.body,
      category: msg.category,
      data: msg.data,
    }).catch(() => 0),
    sendEmailAlert(userId, msg),
  ]);
  return { devices, email };
}
