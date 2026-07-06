/**
 * Verify that a resolved bank-account name belongs to the CheqPay user, so
 * withdrawals can only go to the user's own accounts (a Flutterwave-payout /
 * anti-fraud requirement — the bank's account name reflects the holder's BVN).
 *
 * Nigerian bank names are returned in varied order and may include middle
 * names or abbreviations, so we compare on a normalized token-set basis rather
 * than string equality: the user's known name tokens must sufficiently appear
 * in the account name.
 */

function tokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ") // drop punctuation, keep letters
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2); // ignore initials/noise
}

/**
 * Returns true when `accountName` (from the bank) matches the user's legal
 * name. Requires that at least `min(2, userTokenCount)` of the user's name
 * tokens are present in the account name — tolerant of ordering and extra
 * (middle) names, but rejects unrelated accounts.
 */
export function accountNameMatchesUser(
  accountName: string,
  userName: string
): boolean {
  const acct = new Set(tokens(accountName));
  const userTokens = tokens(userName);
  if (acct.size === 0 || userTokens.length === 0) return false;

  const overlap = userTokens.filter((t) => acct.has(t)).length;
  const required = Math.min(2, userTokens.length);
  return overlap >= required;
}
