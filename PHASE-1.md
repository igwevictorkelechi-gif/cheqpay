# Phase 1 — Auth, KYC tier 1, and admin-configurable spread

## Auth approach
Supabase Auth is the identity authority (email/phone **OTP**, login, sessions,
JWT issuance) — consistent with the existing web/mobile apps. The new backend
(`apps/api`) **verifies the Supabase JWT** (HS256, `SUPABASE_JWT_SECRET`) on
every request and owns the app-side profile, KYC, and tier limits via Prisma.

> Phone OTP requires an SMS provider configured in the Supabase dashboard
> (Twilio/MessageBird/etc.) — a client config item, not code.

## What was built (`apps/api`)

### Auth (`src/lib/auth.ts`)
- `verifySupabaseJwt(token)` — verifies signature/expiry, returns `{ id, email, phone, role }`.
- `requireUser(req)` — Bearer-token guard for user endpoints.
- `requireAdmin(req)` — interim shared-secret guard (`x-admin-secret`, constant-time compare) until full admin auth.

### Endpoints
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/me` | `POST` | Provision/refresh profile from token (idempotent) |
| `/api/me` | `GET` | Profile + current tier limits |
| `/api/kyc` | `POST` | Submit tier-1 KYC → `PENDING` record + audit log |
| `/api/kyc` | `GET` | KYC records + tier/limits |
| `/api/admin/settings` | `GET`/`PUT` | Read/update spread + USDT→NGN rate (admin) |

### KYC tiers & limits (`src/lib/kyc.ts`)
- Server-enforced limits per tier, all in **kobo (BigInt)** — no floats.
- Tier 0 = blocked; Tier 1 = small limits, no crypto withdrawal; Tier 2/3 lift
  ceilings and enable crypto withdrawals (require ID/BVN — Phase 5 review).
- Tier elevation only happens on approval; the API never self-approves.

## Admin-configurable spread/margin (your request)
The swap spread is **no longer a hardcoded value** — it's a DB-backed
`PlatformSetting` you control from the admin dashboard:

- **Model:** `PlatformSetting (key, value, updatedBy, updatedAt)`.
- **Backend:** `getSwapSpreadBps()` / `getUsdtNgnRate()` read the DB value and
  fall back to the env seed only if unset; `setSwapSpreadBps()` /
  `setUsdtNgnRate()` upsert with an `updatedBy` audit stamp.
- **Admin UI:** new **Trading Settings** page (`apps/admin/trading-settings`)
  to set the spread (in bps, with a live % readout) and the USDT→NGN rate.
  It posts through a server-side proxy (`/api/platform-settings`) so the admin
  secret never reaches the browser.
- This is the server-side source of truth the Phase 4 swap engine will read.

## Tested (`vitest`, 24 passing)
- JWT verify: valid / wrong-secret / expired / no-subject / unconfigured.
- KYC limits: tier gating, single-tx bounds, daily-allowance math, fallbacks.
- Settings parsers: spread bps + rate range/format validation.
- Request validation (zod): KYC tier-1 + platform-settings update.
- `next build` clean for `apps/api` and `apps/admin`.

## Assumptions / notes
- DB-touching handlers (`/me`, `/kyc`, `/admin/settings`) are unit-tested at the
  pure-logic layer; full integration tests need a live DB (run the migration
  with `DATABASE_URL`/`DIRECT_URL`, same as Phase 0).
- `requireAdmin` is an **interim** shared-secret guard. Replacing it with real
  admin authn/authz is a Phase 6 hardening item (tracked).
- Reconciling the legacy Supabase NGN tables into the minor-unit ledger remains
  the first task of **Phase 2** (flagged in PHASE-0.md).

## Next: Phase 2 — Wallets & balances
Integrate Tatum custody, provision BTC + USDT(TRC-20) virtual accounts +
addresses on signup, internal ledger in minor units, deposit webhooks → credit.
**Awaiting go-ahead.**
