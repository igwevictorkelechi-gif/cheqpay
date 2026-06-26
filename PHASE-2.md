# Phase 2 — Wallets & balances (custody + ledger)

Custodial wallet provisioning, an internal minor-unit ledger, and deposit
crediting via a verified custody webhook. Built **mock-first**: every path runs
with no live key; the Tatum adapter is wired and ready behind a provider
interface.

## Custody abstraction (`src/custody`)
- `CustodyProvider` interface — `createDepositAddress`, `verifyWebhookSignature`,
  `parseDepositEvent`. Keys never leave the provider; we persist only
  `custodyRef` + the public address.
- `MockCustodyProvider` — deterministic addresses + real HMAC-SHA512 webhook
  verification, so the deposit pipeline is fully exercisable offline.
- `TatumCustodyProvider` — virtual-account/ledger model (create VA → generate
  address), HMAC-SHA512 webhook verification, Tatum payload parsing.
  ⚠️ Shipped but **not yet exercised against the live Tatum API** — validate
  endpoints/signing against current Tatum docs before enabling.
- `getCustodyProvider()` factory — selects via `CUSTODY_PROVIDER` (default `mock`;
  `tatum` requires `TATUM_API_KEY` + `TATUM_WEBHOOK_SECRET`).

## Money & ledger
- `src/lib/money.ts` — `toMinorUnits` / `fromMinorUnits`: **pure string math**,
  no floats. Per-asset decimals (BTC 8, USDT 6, NGN 2); rejects excess precision
  and malformed input.
- `src/lib/ledger.ts` —
  - `creditBalance(...)`: atomic balance increment + ledger `Transaction` in one
    DB transaction; **idempotent** on `idempotencyKey` (no double-credit on replay).
  - `debitBalance(...)`: conditional decrement that **refuses to go negative**.
- `src/lib/wallets.ts` — `provisionWallets(userId)`: idempotent provisioning of
  the launch set (**BTC + USDT-TRC20**); tolerates concurrent creates (P2002).

## Endpoints
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/wallets` | `POST` | Provision launch wallets (idempotent) |
| `/api/wallets` | `GET` | List the user's deposit wallets |
| `/api/balances` | `GET` | Ledger balances per asset (minor units + formatted) |
| `/api/webhooks/tatum` | `POST` | Deposit webhook → credit |

### Deposit webhook order of operations (money-safe)
1. **Verify signature on the raw body** — reject before any state change.
2. Parse + normalize the event.
3. **Idempotency gate**: `WebhookEvent(source, eventId)` unique → replays
   short-circuit with `duplicate`.
4. Match `(network, address)` → wallet → user; unmatched events are ack'd
   (`unmatched`) without crediting.
5. `creditBalance` atomically (second idempotency layer via `idempotencyKey`)
   + append audit log.

## Tested (`vitest`, 36 passing total; +12 this phase)
- Money conversion: BTC/USDT/NGN, large values, excess precision, malformed,
  round-trip.
- Mock custody: deterministic addresses, per-user/asset derivation, HMAC verify
  (valid/tampered/missing), event parsing (valid/junk/unknown asset).

## Assumptions / notes
- DB-touching paths (provisioning, ledger, webhook) are built and unit-tested at
  the pure-logic layer; full integration tests need a live DB + the migration
  (`prisma migrate dev` with `DATABASE_URL`/`DIRECT_URL`).
- Deposits are credited on the first webhook. **Confirmation thresholds** (e.g.
  N confirmations before COMPLETED) are a Phase 5/6 refinement — today a deposit
  event credits immediately.

## ⏳ Carried forward — legacy NGN table reconciliation
Still outstanding (flagged since Phase 0): the legacy Supabase `wallets`
(decimal NGN) vs the new minor-unit `Balance(asset=NGN)`. **Recommendation:**
treat the new ledger as system-of-record and run a one-time backfill
(decimal → kobo `BigInt`) into `Balance`, then point the consumer apps at the
new balances and retire the old column. Best scheduled alongside Phase 3 (Naira
rails), where NGN credits start flowing into the new ledger. Not done in this
phase to avoid touching live consumer data without an explicit go-ahead.

## Next: Phase 3 — Naira rails
Flutterwave deposit (init + verify + webhook → credit NGN ledger) and bank
payout, reusing the existing webhook Edge Functions where they fit. **Awaiting
go-ahead.**
