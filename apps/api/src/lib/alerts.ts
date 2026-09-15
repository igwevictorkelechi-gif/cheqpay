import { prisma } from "@cheqpay/db";
import { sendPush } from "./push";
import { isEmailConfigured, sendEmail } from "./email";
import { resolvePrefs, type NotificationCategory } from "./notifications";
import {
  kindForCategory,
  renderEmail,
  subjectFor,
  type EmailContent,
} from "./emailTemplates";

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
  /**
   * The figure to lead with, already formatted ("₦12,500.00"). Email only —
   * push already carries it in the body. Omitted for anything with no amount,
   * so a security notice never renders as though it had one.
   */
  amount?: string;
  /**
   * A value the user must copy — an electricity token, a reference. Given its
   * own block rather than buried in the detail table.
   */
  copyable?: { label: string; value: string };
  /** Overrides the template chosen from the category. */
  emailKind?: EmailContent["kind"];
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

    // The template is chosen by what the message IS, so a deposit, a payout,
    // a bill receipt and a security notice are visibly different things in an
    // inbox rather than one layout with different words in it.
    const content: EmailContent = {
      kind: msg.emailKind ?? kindForCategory(msg.category),
      title: msg.title,
      body: msg.body,
      amount: msg.amount,
      details: msg.details,
      copyable: msg.copyable,
    };
    await sendEmail({
      to: user.email,
      subject: subjectFor(content),
      html: renderEmail(content),
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
