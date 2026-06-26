# Phase 3 — Naira rails + NGN ledger backfill

Flutterwave deposit/payout on the unified minor-unit ledger, plus the one-time
backfill that brings legacy NGN balances into the new ledger. Mock-first: every
path runs and is tested with no live PSP key.

## Payment abstraction (`src/payments`)
- `PaymentProvider` interface — `verifyWebhookSignature`, `parseChargeEvent`,
  `parseTransferEvent`, `initiateTransfer`. Flutterwave is primary; Paystack
  slots in behind the same interface later.
- `MockPaymentProvider` — secret-equality webhook verify + normalized event
  parsing + deterministic transfer refs (offline-testable).
- `FlutterwaveProvider` — `verif-hash` webhook verification, `charge.completed`
  / `transfer.completed` parsing, `/v3/transfers` payout.
  ⚠️ Shipped but **not exercised against the live API** — validate before prod.
- `getPaymentProvider()` factory — `PAYMENT_PROVIDER` (default `mock`).

## Endpoints
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/deposits/flutterwave` | `POST` | Start a deposit → PENDING tx + `txRef` for checkout (idempotent) |
| `/api/withdrawals/ngn` | `POST` | Bank payout: debit + initiate transfer (idempotent) |
| `/api/webhooks/flutterwave` | `POST` | Credit deposits / finalize payouts |

### Deposit flow (money-safe)
`init` creates a **PENDING** NGN transaction with a unique `txRef` (no balance
change). The verified webhook matches `txRef`, then **atomically** credits the
NGN balance (kobo) and marks the tx COMPLETED — idempotent on both the
`WebhookEvent` gate and the transaction state.

### Withdrawal flow (money-safe)
1. Enforce tier **single-tx + remaining daily** limits (`assertWithdrawalAllowed`).
2. **Atomically** debit available balance (conditional update refuses overdraw)
   + record a PROCESSING transaction.
3. Initiate the PSP transfer (reference = our tx id). **On PSP failure: refund
   + mark FAILED.**
4. The transfer webhook finalizes: SUCCESSFUL → COMPLETED; FAILED → **refund +
   REVERSED**. Idempotent throughout.

## Legacy NGN backfill (your approved step)
`packages/db/scripts/`:
- `backfill_ngn_ledger.sql` — mirrors `users` → `app_users` and converts
  `wallets.balance` (decimal) → `balances` (kobo BigInt). **Transactional,
  idempotent, and aborts if legacy vs new NGN totals don't reconcile.**
- `rollback_ngn_ledger.sql` — best-effort revert (snapshot is the real net).
- `README.md` — run order (`prisma migrate deploy` → snapshot → run), plus the
  separate consumer-app **cutover** step (point apps at `/api/balances`, then
  retire the legacy column). Legacy `wallets` is left intact so nothing breaks.

Runs against the live Supabase DB (no creds here), so it's provided for you to
execute; SQL is written defensively and self-verifies.

## Tested (`vitest`, 46 passing total; +10 this phase)
- Mock PSP: webhook verify, charge/transfer parsing, malformed rejection,
  deterministic transfers.
- Withdrawal limits: per-tx + daily caps, tier gating, positive-amount guard.
- `next build` clean (new routes typecheck).

## Assumptions / notes
- DB-touching handlers built + unit-tested at the pure-logic layer; full
  integration tests need a live DB.
- Deposit init enforces the single-tx limit; richer daily-deposit + AML velocity
  checks land in Phase 6.
- Withdrawals debit `available` immediately (can't double-spend) and refund on
  failure; a `locked`-reservation refinement is optional later.

## Next: Phase 4 — Swap engine
Binance crypto price + the admin-set business USDT→NGN rate & spread → server
quotes with TTL → buy/sell against treasury inventory, full transaction records.
**Awaiting go-ahead.**
