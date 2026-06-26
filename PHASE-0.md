# Phase 0 — Scaffold

Foundation for the NGN ⇄ crypto custodial wallet, built **into the existing
CheqPay monorepo** (Supabase stays for Auth + Postgres + the existing PSP
webhook Edge Functions; the new backend uses Prisma + Next.js route handlers
against the same Postgres).

## Confirmed decisions (brief §12)
| Topic | Decision |
|-------|----------|
| Architecture | Prisma + Next.js route handlers on the existing Supabase Postgres |
| Custody | Tatum (behind a provider interface) |
| Execution | Treasury / inventory (v1) |
| Assets at launch | BTC + USDT (TRC-20); asset/network modeled as enums, extensible |
| Spread/fee | `SWAP_SPREAD_BPS`, default 150 bps (1.5%), server-side only — *assumed default, confirm business margin* |
| Treasury float / rebalancing | Client ops — out of code scope |
| Mobile | Expo (existing app) |

## What was built

### `packages/db` — Prisma data layer
- `prisma/schema.prisma`: full §7 model — `User`, `Wallet`, `Balance`,
  `Quote`, `Transaction`, `KycRecord`, `WebhookEvent`, `AuditLog` + enums
  (`Asset`, `Network`, `TransactionType`, `TransactionStatus`, `UserStatus`,
  `KycStatus`).
- **Money rule enforced:** all amounts are `BigInt` (integer minor units —
  kobo / satoshi / USDT-6dp). Rates use `Decimal`. No floats in money state.
- **No keys ever:** `Wallet` stores only `custodyRef` (provider virtual-account
  id) + the public address.
- Idempotency built in: `Transaction.idempotencyKey` unique;
  `WebhookEvent (source, eventId)` unique.
- `src/index.ts`: singleton `PrismaClient` + re-exported types/enums.
- Generated client verified (`prisma generate`), schema validates 🚀.

### `apps/api` — backend service (Next.js, port 4000)
- `GET /api/health` — dependency-free liveness check.
- `src/lib/env.ts` — zod-validated env access; integration secrets are
  optional in Phase 0 and become required in the phase that introduces them.
- Isolated from the consumer `apps/web` so financial endpoints don't share a
  surface with the user app.

### Repo wiring
- Root `workspaces` now include `apps/api` + `packages/db`.
- `COMPLIANCE.md` added (KYC tiers, AML hooks, audit/retention; licensing is
  the client's responsibility, out of code scope).
- `.env.example` for both new packages documents every secret by phase.

## How to run
```bash
# install (uses bun, matching the rest of the repo)
bun install

# generate the Prisma client
cd packages/db && bunx prisma generate

# backend dev server -> http://localhost:4000/api/health
cd apps/api && bun run dev
curl localhost:4000/api/health
```

To apply the schema to a real database, set `DATABASE_URL` + `DIRECT_URL`
(Supabase Postgres) in `packages/db/.env`, then:
```bash
cd packages/db && bunx prisma migrate dev --name init
```

## Tested
- `apps/api` `vitest` — `GET /api/health` returns 200 / `status: ok` ✅
- `apps/api` `next build` — compiles + typechecks clean (health route, `/`) ✅
- `packages/db` — `prisma validate` passes, `prisma generate` succeeds ✅

## Assumptions / notes
- No live DB/migration run here (no Supabase credentials in this environment);
  schema is validated and the client is generated. Migration is a one-liner
  once `DATABASE_URL`/`DIRECT_URL` are provided.
- The existing Supabase tables (`users`, `wallets`, `transactions`, …) are
  **NGN-only and store money as `DECIMAL`**. The new Prisma models use
  **distinct table names** (`app_users`, `balances`, `ledger_transactions`, …)
  so nothing is clobbered. **Phase 2's first task** is the reconciliation:
  migrate/retire the old NGN-only tables into the minor-unit ledger, or bridge
  them. Flagging now so it's a deliberate step, not a surprise.
- Prisma engine binaries download over the network; in CI/this environment set
  `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` for the proxy.

## Next: Phase 1 — Auth & KYC tier 1
Signup, email/phone OTP, login, session/JWT, basic KYC capture + tier-1 limits.
Will reuse Supabase Auth where it fits and back it with the `User`/`KycRecord`
models. **Awaiting go-ahead.**
