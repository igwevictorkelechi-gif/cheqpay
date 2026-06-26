# Deploying the CheqPay backend (`apps/api`) to Vercel

This deploys the Phase 0–4 backend so it can be tested live. It's a separate
Vercel project from the web app, pointed at the same Supabase Postgres.

## What you need (one-time)
- Your Supabase project's **connection strings** (Dashboard → Project Settings →
  Database): the pooled URL (port 6543) and the direct URL (port 5432).
- Your Supabase **JWT secret** (Settings → API → JWT Secret) — lets the API
  verify logins issued by Supabase Auth.
- A strong **ADMIN_API_SECRET** you choose (16+ chars).

## Step 1 — Apply the database migration (creates the new tables)
The new tables are distinctly named (`app_users`, `crypto_wallets`, `balances`,
`quotes`, `ledger_transactions`, …) and **do not touch your existing tables**.

```bash
cd packages/db
export DATABASE_URL="<your Supabase POOLED url>"
export DIRECT_URL="<your Supabase DIRECT url>"
bunx prisma migrate deploy
```
(You can also paste `prisma/migrations/0001_init/migration.sql` into the
Supabase SQL editor.)

Optional: run the NGN backfill afterwards — see
`packages/db/scripts/README.md`.

## Step 2 — Create the Vercel project
Vercel Dashboard → **Add New… → Project** → import this repo, then:
- **Root Directory:** `apps/api`
- Framework preset: **Next.js** (auto-detected)
- Build & install come from `apps/api/vercel.json` (runs `prisma generate`).

## Step 3 — Set environment variables (Project → Settings → Environment Variables)
| Key | Value |
|-----|-------|
| `DATABASE_URL` | Supabase pooled URL (6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase direct URL (5432) |
| `SUPABASE_JWT_SECRET` | from Supabase → Settings → API |
| `ADMIN_API_SECRET` | a strong secret you choose |
| `PRICE_FEED` | `live` |
| `CUSTODY_PROVIDER` | `mock` (until Tatum is wired) |
| `PAYMENT_PROVIDER` | `mock` (until Flutterwave keys are added) |

(Leave Tatum/Flutterwave keys unset while on `mock`.)

## Step 4 — Deploy & smoke-test
Deploy from the dashboard. Then:
```bash
curl https://<your-api>.vercel.app/api/health        # -> {"status":"ok",...}
```
Authenticated calls need a Supabase access token:
```bash
curl https://<your-api>.vercel.app/api/me -X POST \
  -H "Authorization: Bearer <supabase access_token>"
curl https://<your-api>.vercel.app/api/market/BTC/price \
  -H "Authorization: Bearer <token>"
```
Admin (spread/rate) uses the header `x-admin-secret: <ADMIN_API_SECRET>` — and
the admin dashboard's Trading Settings page once you set `CHEQPAY_API_URL` +
`ADMIN_API_SECRET` on the admin project.

## Notes
- `/api/health` works with no DB/secrets; everything else needs Steps 1+3.
- Custody/PSP are on `mock`, so deposits/swaps are testable end-to-end without
  live Tatum/Flutterwave keys.
