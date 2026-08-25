import { provisionWalletsDetailed } from "./wallets";

/**
 * Mint a user's crypto deposit addresses ahead of time.
 *
 * Addresses used to be created the first time someone opened Receive, which
 * meant a provider round-trip while they waited and an empty screen if it was
 * slow. Enrolment is the natural moment instead: the Maplerad customer the
 * address hangs off has just been created, and nobody is watching a spinner.
 *
 * Fire-and-forget by design. Minting must never fail or delay the flow that
 * triggered it — a KYC submission that succeeded must not report failure
 * because a crypto address could not be minted. Failures are logged with their
 * provider message, and the address is retried on the next Receive visit or by
 * the admin tool.
 */
export function pregenerateCryptoWallets(userId: string, reason: string): void {
  void provisionWalletsDetailed(userId)
    .then((report) => {
      const created = report.outcomes.filter((o) => o.status === "created");
      const failed = report.outcomes.filter((o) => o.status === "failed");
      if (created.length) {
        console.info("[wallets] pre-generated crypto addresses", {
          userId,
          reason,
          created: created.map((o) => `${o.asset}/${o.network}`),
        });
      }
      if (report.blocked) {
        console.warn("[wallets] pre-generation blocked", { userId, reason, blocked: report.blocked });
      }
      for (const f of failed) {
        console.error("[wallets] pre-generation failed", {
          userId,
          reason,
          pair: `${f.asset}/${f.network}`,
          error: f.error,
        });
      }
    })
    .catch((err) => {
      console.error("[wallets] pre-generation threw", { userId, reason, err });
    });
}
