# Phase 5 — Crypto withdrawals, limits, 2FA, confirmations

Provider-signed crypto withdrawals with MFA, NGN-valued limits, and deposit
confirmation thresholds. Mock-first and fully tested.

## 2FA — Supabase MFA (AAL2)
Rather than rolling our own TOTP, we use Supabase's native MFA. The API reads
the `aal` claim from the verified JWT; `requireMfa()` enforces **aal2** on
sensitive actions. Users enroll TOTP via Supabase's MFA APIs on the client;
crypto withdrawals require an aal2 access token.

## Custody withdrawals
- `CustodyProvider.createWithdrawal(...)` added — the provider signs +
  broadcasts; we never touch a private key.
- `MockCustodyProvider` returns a deterministic tx hash (offline-testable);
  `TatumCustodyProvider` calls `/offchain/withdrawal` (shipped, not yet
  exercised live).

## Endpoint — `POST /api/withdrawals/crypto`
Money-safe order:
1. **MFA required** (aal2) + **tier gate** (crypto withdrawals need tier ≥ 2).
2. Validate asset/network (BTC/BITCOIN, USDT/TRON) + amount.
3. **Value the withdrawal in NGN** (price × business rate) and enforce the tier
   **single-tx + daily** limits — the daily cap is now **unified across NGN and
   crypto** (crypto valued in NGN at request time).
4. **Atomic debit** (refuses overdraw) + PROCESSING record (stores `ngnValueKobo`).
5. Provider signs/broadcasts; **on failure, refund + mark FAILED**.
6. Idempotent on `Idempotency-Key`.

## Deposit confirmation thresholds
- `MIN_CONFIRMATIONS` per network (BTC 2, TRON 20, BSC 15, ETH 12).
- The deposit webhook now **upserts** the event (confirmation re-deliveries
  share an eventId) and **credits only once `confirmations ≥ threshold`**; the
  credit stays idempotent so it happens at most once. If a provider omits the
  count (subscription configured to fire only at the threshold), it's treated
  as confirmed.

## Tested (`vitest`, 68 passing total; +9 this phase)
- MFA: `aal` claim capture + `requireMfa` (aal2 pass / aal1 / missing).
- Confirmations: per-network thresholds, missing-count behavior.
- Crypto valuation: `cryptoToNgnKobo` for BTC + USDT.
- Custody: mock withdrawal signing, confirmation parsing.
- `next build` clean — 14 API routes.

## Notes / carried forward
- Crypto withdrawals are marked PROCESSING after broadcast; a
  withdrawal-confirmation webhook to flip them COMPLETED (and an admin review
  queue for large payouts) is a Phase 6 hardening item.
- `requireAdmin` is still the interim shared-secret guard (Phase 6).

## Next: Phase 6 — Hardening
Idempotency audit across all paths, webhook signature coverage, rate limiting,
AML velocity/large-amount flags, withdrawal-confirmation finalization, real
admin auth, and test coverage review on every money path.
