# Phase 6 — Hardening

Production-safety pass over Phases 0–5: real admin auth, rate limiting, AML
screening + a review queue, and withdrawal finalization. Mock-first, fully tested.

## Real admin auth (replaces the interim shared secret)
`requireAdmin` now accepts **either**:
1. an authenticated **admin user** — Supabase `app_metadata.role === "admin"` or
   an email in `ADMIN_EMAILS`, or
2. the **service secret** (`x-admin-secret`) for trusted backends (the admin
   dashboard proxy).

`verifySupabaseJwt` now surfaces `aal` (MFA level) and `isAdmin`.

## Rate limiting
In-memory fixed-window limiter (`ratelimit.ts`) on the money endpoints:
crypto/NGN withdrawals (5/min), quotes (30/min), deposit init (10/min). Returns
HTTP 429 with a retry hint.
> Best-effort per instance — back it with Vercel KV / Upstash in multi-instance
> production (noted in code).

## AML screening + review queue
- `aml.ts` (pure, env-configured): **sanctioned-address block**, **large-amount**,
  and **velocity** (count + cumulative NGN sum) checks.
- Crypto withdrawals are screened: sanctioned destination → **blocked** (no
  debit); large/velocity/over-threshold → funds **reserved (PENDING)** and
  **held for manual review** instead of broadcasting. Every decision writes an
  `AuditLog` entry.
- **Admin review queue**: `GET /api/admin/withdrawals` (list held) and
  `POST /api/admin/withdrawals` (`approve` → broadcast/transfer, `reject` →
  refund + REVERSED).

## Withdrawal finalization
- Custody gains `parseWithdrawalEvent`; the custody webhook now finalizes crypto
  withdrawals: **COMPLETED** on chain success, or **refund + REVERSED** on chain
  failure (idempotent, only acts on PROCESSING). NGN payout finalization already
  existed (Phase 3).

## Idempotency / webhook posture (reaffirmed)
- Every money mutation is keyed by `idempotencyKey` (deposits, swaps, both
  withdrawals); webhooks verify signatures on the raw body before any state
  change; the deposit webhook upserts events and credits once at the
  confirmation threshold.

## Tested (`vitest`, 80 passing total; +12 this phase)
- Rate limiter: window allow/block/reset, key isolation.
- AML: clean pass, sanctioned block, large/velocity-count/velocity-sum holds.
- Admin auth: role-claim + allowlist; `isAdmin` derivation.
- Custody: withdrawal-event parsing.
- `next build` clean — 15 API routes.

## Known follow-ups (beyond hardening / go-live)
- Swap the rate limiter to a shared store (KV/Redis) for multi-instance.
- A dedicated `AmlFlag` table + richer case management (currently AuditLog +
  PENDING review status).
- **Go-live**: flip `CUSTODY_PROVIDER`/`PAYMENT_PROVIDER` off `mock` and validate
  the Tatum/Flutterwave adapters against their live/sandbox APIs (separate from
  this hardening code).
- Legal/regulatory **licensing** remains the client's responsibility
  (`COMPLIANCE.md`).

## Status
Phases 0–6 of the brief are implemented, committed, and CI-green. The remaining
work is operational: deploy `apps/api` (see `apps/api/DEPLOY.md`), apply the
migration, and run live-provider validation.
