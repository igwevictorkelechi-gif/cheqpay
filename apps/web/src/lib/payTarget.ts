/**
 * What did the user type into Pay's "To" field? The v2 Pay screen is one input
 * that works out where the money goes, and says so underneath as they type.
 *
 * The rules mirror what the backend will actually do — notably, a bank payout
 * is name-matched to the account holder (apps/api lib/ngnPayout.ts), so a
 * 10-digit account number can only ever be the user's OWN account. The hint
 * says that up front rather than letting someone type a friend's number and
 * be refused at the end.
 *
 * Kept identical to apps/mobile/lib/payTarget.ts.
 */
export type PayTarget =
  | { kind: "empty" }
  | { kind: "user"; username: string }
  | { kind: "account"; accountNumber: string }
  | { kind: "phone"; phone: string }
  | { kind: "meter"; number: string }
  | { kind: "unknown" };

/** Nigerian mobile numbers: 0 + 70x/80x/81x/90x/91x + 8 digits. */
const NG_MOBILE = /^0[789][01]\d{8}$/;

export function detectPayTarget(raw: string): PayTarget {
  const text = raw.trim();
  if (!text) return { kind: "empty" };

  const handle = text.replace(/^@+/, "");
  if (/^[a-z][a-z0-9_]{2,29}$/i.test(handle) && (text.startsWith("@") || /[a-z]/i.test(handle))) {
    return { kind: "user", username: handle.toLowerCase() };
  }

  const digits = text.replace(/[\s-]/g, "");
  if (/^\+?234\d{10}$/.test(digits)) return { kind: "phone", phone: `0${digits.slice(-10)}` };
  if (!/^\d+$/.test(digits)) return { kind: "unknown" };
  if (digits.length === 10) return { kind: "account", accountNumber: digits };
  if (NG_MOBILE.test(digits)) return { kind: "phone", phone: digits };
  if (digits.length >= 11 && digits.length <= 13) return { kind: "meter", number: digits };
  return { kind: "unknown" };
}

/** The line under the input. */
export function payTargetHint(t: PayTarget): string {
  switch (t.kind) {
    case "empty":
      return "An @username, your bank account number, or a phone or meter number";
    case "user":
      return `@${t.username} · CheqPay user, arrives instantly`;
    case "account":
      return "A 10-digit account — withdrawals go to your own account, and we check the name";
    case "phone":
      return "A phone number — buy airtime or data for it";
    case "meter":
      return "A meter or smartcard number — pick the bill below";
    case "unknown":
      return "That doesn't look like a username, account, phone or meter number";
  }
}
