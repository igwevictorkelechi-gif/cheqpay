# Moving the CheqPay API to Render

## Why

Maplerad requires the IP addresses that call their API to be whitelisted in
their dashboard. Vercel's serverless functions have no static egress IP — the
address changes per invocation — so a whitelist can never be satisfied there.
Render gives every service in a region a fixed set of outbound IPs.

**Only `apps/api` moves.** The web app (`cheqpy`) and the admin dashboard
(`cheqpay-admin`) stay on Vercel; neither talks to Maplerad directly. The admin
dashboard reaches Maplerad *through* the API, so it inherits the static IP.

## What's in the repo

| File | Purpose |
|---|---|
| `apps/api/Dockerfile` | Multi-stage bun image. Build context is the **repo root**. |
| `.dockerignore` | Keeps host build artefacts out of the image. |
| `render.yaml` | Blueprint: the web service + the daily price-alert cron. |
| `apps/api/scripts/trigger-cron.ts` | The cron job's command (replaces Vercel Cron). |

Nothing here changes the live Vercel deployment. The cutover is Steps 5–7.

---

## Step 1 — Create the Blueprint

Render Dashboard → **New → Blueprint** → connect this repo → pick the branch
(`main`). Render reads `render.yaml` and proposes two services:

- `cheqpay-api` — the web service (Frankfurt, Starter plan)
- `cheqpay-price-alerts` — the daily cron

**Region matters.** Frankfurt is Render's closest region to Nigeria. The static
outbound IPs are per-region, so changing region later means re-whitelisting at
Maplerad. Pick it now and leave it.

**Plan matters.** Starter, not Free: free instances sleep after inactivity, and
a cold start in the middle of a payout is not acceptable on a money service.

## Step 2 — Set the secrets

Every var marked `sync: false` in `render.yaml` is prompted for at blueprint
creation (and editable later under Service → Environment). Copy the values from
the Vercel project **cheqpay-admin453** → Settings → Environment Variables so
nothing drifts.

The must-haves for the service to function at all:

| Key | Where it comes from |
|---|---|
| `DATABASE_URL` | Supabase pooled URL (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase direct URL (port 5432) |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API |
| `ADMIN_API_SECRET` | Must match the value on the admin Vercel project |
| `ADMIN_EMAILS` | Comma-separated admin allowlist |
| `API_PUBLIC_URL` | The Render URL — see Step 3, it doesn't exist yet |

Anything the code reads but the blueprint doesn't list (`KYC_PROVIDER`,
`DOJAH_*`, `RELAX_WITHDRAWAL_GUARDS`, `PRICE_ALERT_THRESHOLD_PCT`, …) has a safe
default in `apps/api/src/lib/env.ts`; add it in the dashboard if you need it.

`RELAX_WITHDRAWAL_GUARDS` must stay unset in production — it disables the MFA
and KYC-tier gates on crypto withdrawals.

## Step 3 — First deploy, then close the `API_PUBLIC_URL` loop

The first build takes a while (full `bun install` + Prisma generate + Next
build). When it goes green, Render assigns a URL like
`https://cheqpay-api.onrender.com`.

```bash
curl https://cheqpay-api.onrender.com/api/health
# -> {"status":"ok","service":"cheqpay-api",...}
```

Now set `API_PUBLIC_URL` to that URL (no trailing slash) on **both** services
and redeploy. It's used to build the webhook callback URLs shown in the admin
dashboard, and the cron job uses it to reach the API.

## Step 4 — Whitelist the static IPs at Maplerad

Render service → **Connect** tab → *Outbound IP addresses*. There are three.
Add **all three** to the Maplerad dashboard's IP whitelist — Render rotates
between them, so whitelisting one produces intermittent, confusing failures.

Then point Maplerad's webhook at the new host:

```
https://cheqpay-api.onrender.com/api/webhooks/maplerad
```

`MAPLERAD_WEBHOOK_SECRET` is the Svix `whsec_…` signing secret from that same
webhook configuration screen. The admin dashboard's Payment Settings page shows
the URL to copy once `API_PUBLIC_URL` is set.

## Step 5 — Point the clients at the new API

Three clients, three env vars. **This is the actual cutover** — up to here
nothing has changed for users.

| Client | Where | Variable | Value |
|---|---|---|---|
| Admin (`cheqpay-admin`) | Vercel env vars | `CHEQPAY_API_URL` | the Render URL |
| Web (`cheqpy`) | Vercel env vars | `NEXT_PUBLIC_API_URL` | the Render URL |
| Mobile | `apps/mobile/.env` → new EAS build | `EXPO_PUBLIC_API_URL` | the Render URL |

Each falls back to the old `https://cheqpay-admin453.vercel.app` when its
variable is unset, so the order is: set the variable, redeploy, verify — the
fallback is a safety net, not a plan.

The mobile app is the slow one: `EXPO_PUBLIC_*` is inlined at build time, so
already-installed apps keep calling the old host until users update. **Leave the
Vercel API deployment running** until the new build has rolled out. That's the
main reason this migration is staged rather than a switch flip.

## Step 6 — Verify before decommissioning

```bash
API=https://cheqpay-api.onrender.com
curl $API/api/health
curl $API/api/market/BTC/price -H "Authorization: Bearer <supabase access_token>"
curl $API/api/admin/settings -H "x-admin-secret: <ADMIN_API_SECRET>"
```

Then, in the apps: log in on web, load the admin dashboard (every page proxies
through `CHEQPAY_API_URL` — a blank page means it's wrong), and run one real
Maplerad call (name enquiry on Payment Settings) to confirm the IP whitelist
took effect.

## Step 7 — Decommission the Vercel API

Only once Step 6 passes **and** the mobile build has rolled out:

1. Delete the `deploy-api` job from `.github/workflows/deploy-vercel.yml`
   (leave `deploy-web`).
2. Delete or pause the `cheqpay-admin453` Vercel project.

Keeping it running in the meantime costs nothing and is the rollback.

## Rollback

Unset `CHEQPAY_API_URL` / `NEXT_PUBLIC_API_URL` on the Vercel projects and
redeploy. Both fall back to `cheqpay-admin453.vercel.app`. As long as Step 7
hasn't run, that deployment is still live and still current — the GitHub
workflow keeps deploying to it on every push to `main`.

---

## Notes and gotchas

**Vercel Cron does not follow the API.** `apps/api/vercel.json` schedules
`/api/cron/price-alerts` daily at 08:00 UTC. That scheduler is a Vercel feature;
it stops the moment the project stops. `render.yaml` re-declares it as a Render
cron service running `bun run cron:price-alerts`, which calls the same endpoint
over HTTP with the `Authorization: Bearer $CRON_SECRET` header. `CRON_SECRET`
must be **the same value on both services** or every run 401s.

**SSO protection.** Vercel's SSO protection was returning login pages to API
clients. Render has no equivalent, so the API is publicly reachable — as it must
be, since mobile clients and Maplerad webhooks call it. Authorization is bearer
tokens and `x-admin-secret`, unchanged.

**Database migrations.** Nothing about this changes how schema is applied. The
API creates its newer tables with idempotent lazy DDL at first use
(`ensureCardsTable`, `ensureBeneficiariesTable`, `ensureCashbackEnum`,
`ensureTransferEnums`), and the migration files under
`packages/db/prisma/migrations` remain the record. No migration step runs on
deploy — there was never one on Vercel either.

**Why Docker and not a native runtime.** The build has three hard ordering
constraints — `prisma generate`, then build `@cheqpay/shared` (its `main` points
at `dist/`), then `next build` — plus a bun workspace whose frozen lockfile
needs *every* workspace manifest present, including apps this image never
builds. The Dockerfile states all of that explicitly instead of relying on a
host's monorepo conventions.

**Verification status.** The image was not built end-to-end in the development
sandbox: Docker Hub's blob CDN (`production.cloudfront.docker.com`) is blocked
by the sandbox egress policy, so `FROM oven/bun:1` cannot resolve there. What
*was* verified locally: the deps stage (`bun install --frozen-lockfile` against
only the six workspace manifests + `bun.lock`) succeeds, and `bun run build` in
`apps/api` succeeds. The first Render build is the real test of the image.
