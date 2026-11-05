# Auto cash-out

Users can choose to have each **USDT, USDC or BTC** deposit sold for naira and
sent to **one of their own saved bank accounts**, without tapping anything.

It ships **off**. Turn it on in the admin dashboard → Features → **Auto cash-out**.

## What the user does
- App: Profile → **Auto cash-out**. Web: `/auto-cashout`.
- Picks the coins and one saved bank account, then turns it on.
- Turning it on, adding a coin or changing the account needs the **transaction
  PIN**. Turning it off doesn't.

## What happens on a deposit
1. The deposit is credited as usual (Tatum, Maplerad or custody webhook).
2. If the user has auto cash-out on for that coin, a row is queued in
   `auto_cashouts` (one per deposit, unique, so it never runs twice).
3. Right after the webhook replies, the deposited amount is **sold** with the
   same quote and swap code as the Sell screen. The sell spread and the
   ₦15 minimum profit apply. Off-ramped stablecoins, which are held as dollars,
   are converted USD→NGN.
4. The naira is **paid out** with the same code as the Withdraw screen
   (`lib/ngnPayout.ts`). That means:
   - the account name must match the user's KYC name;
   - tier and daily limits apply;
   - the withdrawal fee comes out of the payout;
   - an unclear answer from the provider is held for reconciliation.
5. The user gets a push: "₦X is on its way to GTBank ••1234".

Before selling, it checks that the naira could actually be paid out. If not,
nothing is sold and the coins stay in the wallet. That covers:
- below the minimum payout;
- over a limit;
- KYC not done;
- the feature or withdrawals switched off;
- the user turned it off since the deposit.

## When something fails
| Situation | Result |
|---|---|
| Exchange or bank unreachable, or refused without moving money | Retried after 2 min, 10 min, 1 h and 6 h |
| Retries run out before the sale | `skipped`: the coins stay in the wallet and the user is told |
| Retries run out after the sale | `kept_ngn`: the naira stays in the wallet and the user is told |
| Sold, but the balance update failed (`fx_credit_failed`) | `failed`: never retried, and admins with the Transactions section are alerted |

Before a payout is retried, it looks for an earlier payout for the same
cash-out that is still in flight or done. That way a payout is never sent twice.

**Retries run:**
- every minute, from the database scheduler (`pg_cron` calls
  `/api/cron/auto-cashout` with `DB_CRON_SECRET`; see `docs/SOCIAL_SCHEDULER.md`);
- whenever any new deposit arrives;
- in Vercel's daily `/api/cron/auto-cashout` run, as a backstop.

## Money behind it
- **BTC** sells settle on the ledger (treasury).
- **USDT/USDC** sells settle on Maplerad's FX rail (USD→NGN), so the Maplerad
  **USD wallet** must hold the dollars.
- Every payout comes from the Maplerad **NGN wallet**, so keep it funded.

If either wallet is short, cash-outs retry and then leave the money in the
user's wallet. Nothing is lost.

## Where the code is
| Piece | File |
|---|---|
| Engine (queue, sell, pay out, retries) | `apps/api/src/lib/autoCashout/index.ts` |
| Rules (which deposits qualify, error classes) | `apps/api/src/lib/autoCashout/rules.ts` |
| Tables (created lazily) | `apps/api/src/lib/autoCashout/schema.ts` |
| Shared bank payout | `apps/api/src/lib/ngnPayout.ts` |
| User API | `apps/api/src/app/api/auto-cashout/route.ts` |
| Retry sweep | `apps/api/src/app/api/cron/auto-cashout/route.ts` |
| Screens | `apps/mobile/app/(app)/auto-cashout.tsx`, `apps/web/src/app/auto-cashout/page.tsx` |
